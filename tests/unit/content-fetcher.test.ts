import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  createContentFetcher,
  FetchError,
  isPrivateAddress,
  nodeTransport,
  redactUrl,
  type HostResolver,
  type Transport,
  type TransportResponse
} from "../../packages/research/src";

const PUBLIC = [{ address: "93.184.216.34", family: 4 as const }];

function respond(
  status: number,
  headers: Record<string, string>,
  body: string | Uint8Array[] = ""
): TransportResponse {
  const chunks = typeof body === "string" ? [Buffer.from(body)] : body;
  return {
    status,
    headers,
    body: (async function* () {
      yield* chunks;
    })(),
    destroy: vi.fn()
  };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(FetchError);
    return (error as FetchError).code;
  }
  throw new Error("expected the fetch to fail");
}

describe("isPrivateAddress", () => {
  it.each([
    "127.0.0.1",
    "127.255.0.9",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "100.127.255.255",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "fe80::1",
    "fd00:ec2::254",
    "fc00::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:169.254.169.254",
    "64:ff9b::a00:1",
    "2002:7f00:1::1",
    "2001:db8::1",
    "[::1]"
  ])("blocks %s", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each([
    "93.184.216.34",
    "8.8.8.8",
    "172.15.0.1",
    "172.32.0.1",
    "100.63.255.255",
    "100.128.0.1",
    "2606:2800:220:1:248:1893:25c8:1946",
    "::ffff:8.8.8.8"
  ])("allows %s", (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });

  it("treats a non-address as blocked", () => {
    expect(isPrivateAddress("example.com")).toBe(true);
  });
});

describe("SafeContentFetcher with injected resolver and transport", () => {
  const resolver: HostResolver = async () => PUBLIC;

  it("returns status, final URL, content type, size and decoded body", async () => {
    const transport: Transport = async () =>
      respond(200, { "content-type": "Text/HTML; charset=utf-8" }, "<p>héllo</p>");
    const result = await createContentFetcher({ resolver, transport }).fetch({
      url: "https://example.com/post"
    });

    expect(result).toEqual({
      url: "https://example.com/post",
      finalUrl: "https://example.com/post",
      status: 200,
      contentType: "text/html",
      size: Buffer.byteLength("<p>héllo</p>"),
      body: "<p>héllo</p>"
    });
  });

  it("connects to the validated address and sends the identifying User-Agent", async () => {
    const transport = vi.fn<Parameters<Transport>, ReturnType<Transport>>(async () =>
      respond(200, { "content-type": "text/plain" }, "ok")
    );
    await createContentFetcher({ resolver, transport, userAgent: "TestAgent/1" }).fetch({
      url: "https://example.com/"
    });

    const call = transport.mock.calls[0][0];
    expect(call.address).toEqual(PUBLIC[0]);
    expect(call.headers["user-agent"]).toBe("TestAgent/1");
  });

  it.each([
    ["loopback IPv4 literal", "http://127.0.0.1/"],
    ["metadata literal", "http://169.254.169.254/latest/meta-data/"],
    ["IPv6 loopback literal", "http://[::1]/"],
    ["IPv4-mapped IPv6 literal", "http://[::ffff:127.0.0.1]/"],
    ["decimal IPv4 literal", "http://2130706433/"],
    ["hex IPv4 literal", "http://0x7f000001/"],
    ["private literal", "http://10.0.0.5/"]
  ])("refuses %s without connecting", async (_name, url) => {
    const transport = vi.fn<Parameters<Transport>, ReturnType<Transport>>();
    const code = await codeOf(createContentFetcher({ resolver, transport }).fetch({ url }));

    expect(code).toBe("fetch_blocked");
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([
    ["a private IPv4", [{ address: "192.168.0.10", family: 4 as const }]],
    ["loopback", [{ address: "127.0.0.1", family: 4 as const }]],
    ["IPv6 loopback", [{ address: "::1", family: 6 as const }]],
    ["the metadata address", [{ address: "169.254.169.254", family: 4 as const }]],
    ["a unique-local IPv6", [{ address: "fd12:3456::1", family: 6 as const }]],
    [
      "a mix of public and private answers",
      [...PUBLIC, { address: "10.0.0.1", family: 4 as const }]
    ]
  ])("refuses a hostname that resolves to %s", async (_name, answers) => {
    const transport = vi.fn<Parameters<Transport>, ReturnType<Transport>>();
    const code = await codeOf(
      createContentFetcher({ resolver: async () => answers, transport }).fetch({
        url: "https://innocent.example/"
      })
    );

    expect(code).toBe("fetch_blocked");
    expect(transport).not.toHaveBeenCalled();
  });

  it.each(["http://127.0.0.1/admin", "http://169.254.169.254/latest/meta-data/", "http://[::1]/"])(
    "refuses a redirect to %s",
    async (target) => {
      const transport = vi
        .fn<Parameters<Transport>, ReturnType<Transport>>()
        .mockResolvedValueOnce(respond(302, { location: target }));
      const code = await codeOf(
        createContentFetcher({ resolver, transport }).fetch({ url: "https://example.com/go" })
      );

      expect(code).toBe("fetch_blocked");
      expect(transport).toHaveBeenCalledTimes(1);
    }
  );

  it("refuses a redirect to a hostname that resolves to a private address", async () => {
    const dns: HostResolver = async (host) =>
      host === "evil.example" ? [{ address: "10.0.0.7", family: 4 }] : PUBLIC;
    const transport = vi
      .fn<Parameters<Transport>, ReturnType<Transport>>()
      .mockResolvedValueOnce(respond(301, { location: "https://evil.example/x" }));

    const code = await codeOf(
      createContentFetcher({ resolver: dns, transport }).fetch({ url: "https://example.com/" })
    );
    expect(code).toBe("fetch_blocked");
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("follows relative redirects and reports the final URL", async () => {
    const transport = vi
      .fn<Parameters<Transport>, ReturnType<Transport>>()
      .mockResolvedValueOnce(respond(301, { location: "/final?x=1" }))
      .mockResolvedValueOnce(respond(200, { "content-type": "application/rss+xml" }, "<rss/>"));

    const result = await createContentFetcher({ resolver, transport }).fetch({
      url: "https://example.com/start"
    });
    expect(result.finalUrl).toBe("https://example.com/final?x=1");
    expect(result.url).toBe("https://example.com/start");
  });

  it("stops after the maximum number of redirects", async () => {
    const transport: Transport = async () => respond(302, { location: "/again" });
    const code = await codeOf(
      createContentFetcher({ resolver, transport, maxRedirects: 2 }).fetch({
        url: "https://example.com/"
      })
    );
    expect(code).toBe("fetch_http_error");
  });

  it("refuses schemes other than http and https, and credentials in the URL", async () => {
    const transport = vi.fn<Parameters<Transport>, ReturnType<Transport>>();
    const fetcher = createContentFetcher({ resolver, transport });

    for (const url of [
      "file:///etc/passwd",
      "ftp://example.com/",
      "gopher://example.com/",
      "not a url"
    ]) {
      expect(await codeOf(fetcher.fetch({ url }))).toBe("fetch_blocked");
    }
    expect(await codeOf(fetcher.fetch({ url: "https://user:pw@example.com/" }))).toBe(
      "fetch_blocked"
    );
    expect(transport).not.toHaveBeenCalled();
  });

  it("refuses a redirect to another scheme", async () => {
    const transport: Transport = async () => respond(302, { location: "file:///etc/passwd" });
    const code = await codeOf(
      createContentFetcher({ resolver, transport }).fetch({ url: "https://example.com/" })
    );
    expect(code).toBe("fetch_blocked");
  });

  it("enforces the host allowlist, also on redirects", async () => {
    const transport = vi
      .fn<Parameters<Transport>, ReturnType<Transport>>()
      .mockImplementation(async () => respond(302, { location: "https://other.example/" }));
    const fetcher = createContentFetcher({
      resolver,
      transport,
      allowedHosts: ["Example.com", " feeds.example.com "]
    });

    expect(await codeOf(fetcher.fetch({ url: "https://not-listed.example/" }))).toBe(
      "fetch_blocked"
    );
    expect(transport).not.toHaveBeenCalled();
    // allowed host redirecting to a host outside the list
    expect(await codeOf(fetcher.fetch({ url: "https://example.com/" }))).toBe("fetch_blocked");
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("lets an allowed host through", async () => {
    const transport: Transport = async () => respond(200, { "content-type": "text/plain" }, "hi");
    const result = await createContentFetcher({
      resolver,
      transport,
      allowedHosts: ["feeds.example.com"]
    }).fetch({ url: "https://feeds.example.com/rss" });
    expect(result.body).toBe("hi");
  });

  it("does not let the allowlist override the address rules", async () => {
    const code = await codeOf(
      createContentFetcher({
        resolver: async () => [{ address: "10.0.0.1", family: 4 }],
        transport: async () => respond(200, { "content-type": "text/plain" }),
        allowedHosts: ["intranet.example"]
      }).fetch({ url: "https://intranet.example/" })
    );
    expect(code).toBe("fetch_blocked");
  });

  it("allows private addresses only when asked to", async () => {
    const result = await createContentFetcher({
      allowPrivate: true,
      transport: async () => respond(200, { "content-type": "text/plain" }, "local")
    }).fetch({ url: "http://127.0.0.1:8080/" });
    expect(result.body).toBe("local");
  });

  it("cuts a body that grows past the limit and drops the connection", async () => {
    const response = respond(200, { "content-type": "text/html" }, [
      Buffer.alloc(60),
      Buffer.alloc(60)
    ]);
    const code = await codeOf(
      createContentFetcher({ resolver, transport: async () => response, maxBytes: 100 }).fetch({
        url: "https://example.com/"
      })
    );
    expect(code).toBe("fetch_too_large");
    expect(response.destroy).toHaveBeenCalled();
  });

  it("refuses early when Content-Length is over the limit", async () => {
    const response = respond(200, { "content-type": "text/html", "content-length": "5000" }, "x");
    const code = await codeOf(
      createContentFetcher({ resolver, transport: async () => response, maxBytes: 100 }).fetch({
        url: "https://example.com/"
      })
    );
    expect(code).toBe("fetch_too_large");
    expect(response.destroy).toHaveBeenCalled();
  });

  it("times out a response that never finishes", async () => {
    const hanging: Transport = ({ signal }) =>
      Promise.resolve({
        status: 200,
        headers: { "content-type": "text/html" },
        body: (async function* () {
          yield Buffer.from("start");
          await new Promise((_resolve, reject) =>
            signal.addEventListener("abort", () => reject(new Error("aborted")))
          );
        })(),
        destroy: () => undefined
      });
    const code = await codeOf(
      createContentFetcher({ resolver, transport: hanging, timeoutMs: 50 }).fetch({
        url: "https://example.com/"
      })
    );
    expect(code).toBe("fetch_timeout");
  });

  it("times out a request that never answers", async () => {
    const silent: Transport = ({ signal }) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(new Error("aborted")))
      );
    const code = await codeOf(
      createContentFetcher({ resolver, transport: silent, timeoutMs: 50 }).fetch({
        url: "https://example.com/"
      })
    );
    expect(code).toBe("fetch_timeout");
  });

  it("rejects unsupported content types and encodings", async () => {
    const fetcher = (headers: Record<string, string>) =>
      createContentFetcher({ resolver, transport: async () => respond(200, headers, "x") });

    expect(
      await codeOf(
        fetcher({ "content-type": "application/pdf" }).fetch({ url: "https://example.com/" })
      )
    ).toBe("fetch_unsupported_type");
    expect(
      await codeOf(fetcher({ "content-type": "image/png" }).fetch({ url: "https://example.com/" }))
    ).toBe("fetch_unsupported_type");
    expect(await codeOf(fetcher({}).fetch({ url: "https://example.com/" }))).toBe(
      "fetch_unsupported_type"
    );
    expect(
      await codeOf(
        fetcher({ "content-type": "text/html", "content-encoding": "gzip" }).fetch({
          url: "https://example.com/"
        })
      )
    ).toBe("fetch_unsupported_type");
  });

  it.each([
    "application/atom+xml",
    "application/xml",
    "text/xml",
    "application/xhtml+xml",
    "text/plain"
  ])("accepts %s", async (contentType) => {
    const result = await createContentFetcher({
      resolver,
      transport: async () => respond(200, { "content-type": contentType }, "x")
    }).fetch({ url: "https://example.com/" });
    expect(result.contentType).toBe(contentType);
  });

  it("turns error statuses into fetch_http_error with the status", async () => {
    const error = await createContentFetcher({
      resolver,
      transport: async () => respond(503, { "content-type": "text/html" })
    })
      .fetch({ url: "https://example.com/" })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(FetchError);
    expect((error as FetchError).code).toBe("fetch_http_error");
    expect((error as FetchError).status).toBe(503);
  });

  it("reports resolver and transport failures as fetch_network", async () => {
    expect(
      await codeOf(
        createContentFetcher({
          resolver: async () => {
            throw new Error("ENOTFOUND");
          }
        }).fetch({ url: "https://nowhere.example/" })
      )
    ).toBe("fetch_network");
    expect(
      await codeOf(
        createContentFetcher({
          resolver,
          transport: async () => {
            throw new Error("ECONNRESET");
          }
        }).fetch({ url: "https://example.com/" })
      )
    ).toBe("fetch_network");
  });

  it("keeps credentials and query strings out of the error", async () => {
    const error = await createContentFetcher({ resolver })
      .fetch({ url: "https://user:secret@example.com/feed?token=abc123" })
      .catch((e: unknown) => e as FetchError);

    expect((error as FetchError).url).toBe("https://example.com/feed");
    expect(JSON.stringify(error)).not.toContain("secret");
    expect((error as FetchError).message).not.toContain("abc123");
  });

  it("honors the caller's abort signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const code = await codeOf(
      createContentFetcher({
        resolver,
        transport: ({ signal }) =>
          new Promise((_resolve, reject) => {
            if (signal.aborted) reject(new Error("aborted"));
          })
      }).fetch({ url: "https://example.com/", signal: controller.signal })
    );
    expect(code).toBe("fetch_network");
  });
});

describe("redactUrl", () => {
  it("drops credentials, query and fragment", () => {
    expect(redactUrl("https://u:p@example.com:8443/a/b?token=1#x")).toBe(
      "https://example.com:8443/a/b"
    );
    expect(redactUrl("garbage")).toBe("[invalid url]");
  });
});

describe("default transport against a local server", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      switch (req.url) {
        case "/feed":
          res.writeHead(200, { "content-type": "application/rss+xml; charset=utf-8" });
          res.end(`<rss>${req.headers["user-agent"]}</rss>`);
          break;
        case "/redirect":
          res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
          res.end();
          break;
        case "/chunked-big":
          res.writeHead(200, { "content-type": "text/html" });
          res.write(Buffer.alloc(800, 97));
          res.end(Buffer.alloc(800, 97));
          break;
        case "/slow":
          res.writeHead(200, { "content-type": "text/html" });
          res.write("start");
          // never ends
          break;
        default:
          res.writeHead(404, { "content-type": "text/plain" });
          res.end("nope");
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  it("refuses the local server by default", async () => {
    expect(await codeOf(createContentFetcher().fetch({ url: `${base}/feed` }))).toBe(
      "fetch_blocked"
    );
  });

  it("fetches over a real socket when private addresses are allowed", async () => {
    const result = await createContentFetcher({ allowPrivate: true, userAgent: "Probe/9" }).fetch({
      url: `${base}/feed`
    });
    expect(result.body).toBe("<rss>Probe/9</rss>");
    expect(result.contentType).toBe("application/rss+xml");
    expect(result.size).toBe(result.body.length);
  });

  it("blocks a redirect to the metadata address even from an allowed local origin", async () => {
    // allowPrivate lifts the rule for the local fake server, so check the redirect with it off
    // by pinning the transport to the local server and resolving the first hop publicly.
    const fetcher = createContentFetcher({
      resolver: async () => PUBLIC,
      transport: (request) =>
        nodeTransport({
          ...request,
          url: new URL(request.url.pathname, base),
          address: { address: "127.0.0.1", family: 4 }
        })
    });
    expect(await codeOf(fetcher.fetch({ url: "http://example.test/redirect" }))).toBe(
      "fetch_blocked"
    );
  });

  it("cuts a body over the limit", async () => {
    const code = await codeOf(
      createContentFetcher({ allowPrivate: true, maxBytes: 1000 }).fetch({
        url: `${base}/chunked-big`
      })
    );
    expect(code).toBe("fetch_too_large");
  });

  it("cuts a response that stalls", async () => {
    const code = await codeOf(
      createContentFetcher({ allowPrivate: true, timeoutMs: 150 }).fetch({ url: `${base}/slow` })
    );
    expect(code).toBe("fetch_timeout");
  });

  it("reports a 404", async () => {
    expect(
      await codeOf(createContentFetcher({ allowPrivate: true }).fetch({ url: `${base}/missing` }))
    ).toBe("fetch_http_error");
  });
});
