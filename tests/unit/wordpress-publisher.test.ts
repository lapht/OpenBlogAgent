import { afterEach, describe, expect, it, vi } from "vitest";

import { logger } from "../../packages/logger/src";
import {
  WordPressPublisher,
  normalizeWordPressEndpoint,
  type PublishArticle,
  type WordPressPublisherConfig
} from "../../packages/publishers/src";

const ENDPOINT = "https://example.com/wp-json/wp/v2";

const article: PublishArticle = {
  title: "Hello",
  slug: "hello",
  summary: "Summary",
  content: "# Hello\n\nBody <script>alert(1)</script> [x](javascript:alert(1))",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  tags: ["a"],
  category: "News",
  author: "OpenBlogAgent",
  language: "en"
};

function makePublisher(overrides: Partial<WordPressPublisherConfig> = {}) {
  return new WordPressPublisher(
    { endpoint: ENDPOINT, username: "user", applicationPassword: "app pass", ...overrides },
    logger,
    { list: async () => [], resolve: async () => ({ id: 7, name: "News" }) },
    { list: async () => [], resolveMany: async () => [{ id: 9, name: "a" }] }
  );
}

const okBody = { id: 5, link: "https://example.com/hello", status: "draft", slug: "hello" };

/** Answers the slug lookup with no match and every write with `status`/`body`. */
function stubFetch(status: number, body: unknown) {
  const mock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "GET") {
      return { ok: true, status: 200, json: async () => [] };
    }
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

/** A minimal stateful WordPress: posts by id, lookup by slug, create and update. */
function stubFakeWordPress(options: { failFirstWrite?: boolean } = {}) {
  const posts = new Map<number, { id: number; link: string; status: string; slug: string }>();
  const calls: string[] = [];
  let nextId = 1;
  let failNext = options.failFirstWrite ?? false;

  const mock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const parsed = new URL(url);
    calls.push(`${method} ${parsed.pathname.replace("/wp-json/wp/v2", "")}`);

    if (method === "GET") {
      const slug = parsed.searchParams.get("slug");
      return {
        ok: true,
        status: 200,
        json: async () => [...posts.values()].filter((post) => post.slug === slug)
      };
    }

    const body = JSON.parse(String(init?.body));
    const id = method === "PUT" ? Number(parsed.pathname.split("/").pop()) : nextId++;
    const previous = posts.get(id);
    const post = {
      id,
      link: `https://example.com/${body.slug ?? previous?.slug}`,
      status: body.status ?? previous?.status ?? "draft",
      slug: body.slug ?? previous?.slug ?? ""
    };
    posts.set(id, post);

    if (failNext) {
      // The write reached WordPress but the response was lost.
      failNext = false;
      throw new DOMException("timed out", "TimeoutError");
    }
    return { ok: true, status: 201, json: async () => post };
  });
  vi.stubGlobal("fetch", mock);
  return { calls, posts };
}

describe("WordPressPublisher", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends slug, sanitized HTML, numeric term ids, excerpt and draft status", async () => {
    const fetchMock = stubFetch(201, okBody);
    const result = await makePublisher().publish(article);

    expect(result.success).toBe(true);
    const [url, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe(`${ENDPOINT}/posts`);
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      slug: "hello",
      excerpt: "Summary",
      status: "draft",
      categories: [7],
      tags: [9]
    });
    expect(body.content).toContain("<h1>Hello</h1>");
    expect(body.content).not.toMatch(/^#/);
    expect(body.content).not.toContain("<script");
    expect(body.content).not.toContain("javascript:");
  });

  it("creates once and updates on the second publish of the same article", async () => {
    const wp = stubFakeWordPress();
    const publisher = makePublisher();

    const first = await publisher.publish(article);
    const second = await publisher.publish({ ...article, content: "# Hello\n\nEdited" });

    expect(first.metadata).toMatchObject({ id: 1, action: "created" });
    expect(second.metadata).toMatchObject({ id: 1, action: "updated" });
    expect(wp.calls).toEqual(["GET /posts", "POST /posts", "GET /posts", "PUT /posts/1"]);
    expect(wp.posts.size).toBe(1);
  });

  it("does not unpublish a live post when updating a draft-configured article", async () => {
    const wp = stubFakeWordPress();
    await makePublisher({ status: "publish" }).publish(article);
    const result = await makePublisher({ status: "draft" }).publish(article);

    expect(result.success).toBe(true);
    expect(wp.posts.get(1)?.status).toBe("publish");
  });

  it("returns a conflict without writing when onExisting is conflict", async () => {
    const wp = stubFakeWordPress();
    await makePublisher().publish(article);
    wp.calls.length = 0;

    const result = await makePublisher({ onExisting: "conflict" }).publish(article);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("conflict");
    expect(result.error?.details).toMatchObject({ id: 1 });
    expect(wp.calls).toEqual(["GET /posts"]);
  });

  it("finds the post created before a timeout and updates it instead of duplicating", async () => {
    const wp = stubFakeWordPress({ failFirstWrite: true });
    const publisher = makePublisher();

    const first = await publisher.publish(article);
    const retry = await publisher.publish(article);

    expect(first.success).toBe(false);
    expect(first.error?.code).toBe("timeout");
    expect(retry.success).toBe(true);
    expect(retry.metadata).toMatchObject({ id: 1, action: "updated" });
    expect(wp.posts.size).toBe(1);
  });

  it("does not write when the slug lookup fails", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await makePublisher().publish(article);

    expect(result.error?.code).toBe("server_error");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns id, link, status and slug from the response", async () => {
    stubFetch(201, okBody);
    const result = await makePublisher().publish(article);
    expect(result.metadata).toMatchObject(okBody);
  });

  it("fails when the response has no post id or link", async () => {
    stubFetch(201, { status: "draft" });
    const result = await makePublisher().publish(article);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("unexpected_response");
  });

  it.each([
    [401, "auth_failed"],
    [403, "forbidden"],
    [400, "invalid_request"],
    [500, "server_error"],
    [503, "server_error"]
  ])("maps HTTP %i to %s", async (status, code) => {
    stubFetch(status, { message: "nope" });
    const result = await makePublisher().publish(article);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(code);
  });

  it("classifies network failures and timeouts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );
    expect((await makePublisher().publish(article)).error?.code).toBe("network_error");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("timed out", "TimeoutError");
      })
    );
    expect((await makePublisher().publish(article)).error?.code).toBe("timeout");
  });

  it("normalizes trailing slashes and a trailing /posts", async () => {
    expect(normalizeWordPressEndpoint(`${ENDPOINT}/`)).toBe(ENDPOINT);
    expect(normalizeWordPressEndpoint(`${ENDPOINT}/posts/`)).toBe(ENDPOINT);

    const fetchMock = stubFetch(201, okBody);
    await makePublisher({ endpoint: `${ENDPOINT}/posts` }).publish(article);
    expect((fetchMock.mock.calls[1] as unknown as [string])[0]).toBe(`${ENDPOINT}/posts`);
  });

  it("rejects endpoints that do not end at /wp-json/wp/v2", async () => {
    const fetchMock = stubFetch(201, okBody);
    const result = await makePublisher({ endpoint: "https://example.com" }).publish(article);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("validation_failed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [{ username: undefined }, "username"],
    [{ applicationPassword: undefined }, "applicationPassword"],
    [{ applicationPassword: " " }, "applicationPassword"]
  ])("fails validation for missing credentials %j", async (override, field) => {
    const validation = await makePublisher(override).validate(article);
    expect(validation.valid).toBe(false);
    expect(validation.issues.map((i) => i.field)).toContain(field);
  });
});
