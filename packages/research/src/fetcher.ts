import { lookup } from "node:dns/promises";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

import { logger } from "@openblog/logger";

import { isPrivateAddress } from "./ip";
import {
  FetchError,
  type ContentFetcher,
  type FetchedContent,
  type FetchErrorCode,
  type FetchRequest
} from "./types";

export const DEFAULT_FETCH_TIMEOUT_MS = 15_000;
export const DEFAULT_FETCH_MAX_BYTES = 2_000_000;
export const DEFAULT_FETCH_MAX_REDIRECTS = 5;
export const DEFAULT_FETCH_USER_AGENT =
  "OpenBlogAgent/0.2 (+https://github.com/lapht/OpenBlogAgent)";

/** Media types the fetcher returns: HTML, XML, RSS/Atom and plain text. */
const ALLOWED_TYPES = new Set([
  "text/html",
  "application/xhtml+xml",
  "text/xml",
  "application/xml",
  "application/rss+xml",
  "application/atom+xml",
  "text/plain"
]);

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

/** Resolves a hostname to all its addresses. Injected in tests so they need no DNS. */
export type HostResolver = (hostname: string) => Promise<ResolvedAddress[]>;

export interface TransportRequest {
  url: URL;
  /** The already validated address to connect to; the hostname is not resolved again. */
  address: ResolvedAddress;
  headers: Record<string, string>;
  signal: AbortSignal;
}

export interface TransportResponse {
  status: number;
  /** Header names in lowercase. */
  headers: Record<string, string | undefined>;
  body: AsyncIterable<Uint8Array>;
  /** Drops the connection without reading the rest of the body. */
  destroy(): void;
}

/** Performs one HTTP request without following redirects. Injected in tests. */
export type Transport = (request: TransportRequest) => Promise<TransportResponse>;

export interface ContentFetcherOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  userAgent?: string;
  /** Allow loopback, private, link-local and metadata addresses (local development only). */
  allowPrivate?: boolean;
  /** Hostnames (exact, case-insensitive) that may be fetched; empty or unset: any public host. */
  allowedHosts?: string[];
  resolver?: HostResolver;
  transport?: Transport;
}

/** Strips credentials, query string and fragment, which may carry tokens, from a URL for logs and errors. */
export function redactUrl(value: string | URL): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return "[invalid url]";
  }
}

function fail(code: FetchErrorCode, message: string, url: string, status?: number): FetchError {
  return new FetchError({ code, message, url: redactUrl(url), status });
}

const defaultResolver: HostResolver = async (hostname) => {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => ({ address: record.address, family: record.family as 4 | 6 }));
};

export const nodeTransport: Transport = ({ url, address, headers, signal }) =>
  new Promise((resolve, reject) => {
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const req = send(
      {
        host: hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: { ...headers, host: url.host },
        signal,
        // TLS must validate the certificate against the name asked for, not the pinned address.
        servername: isIP(hostname) ? undefined : hostname,
        // Connect to the address that passed the check; a second lookup could answer differently.
        lookup: (_host, options, callback) => {
          if (options.all) {
            (callback as unknown as (e: null, a: ResolvedAddress[]) => void)(null, [address]);
          } else {
            callback(null, address.address, address.family);
          }
        }
      },
      (res) => {
        resolve({
          status: res.statusCode ?? 0,
          headers: normalizeHeaders(res.headers),
          body: res,
          destroy: () => res.destroy()
        });
      }
    );
    req.on("error", reject);
    req.end();
  });

function normalizeHeaders(headers: IncomingHttpHeaders): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(headers)) {
    result[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
  }
  return result;
}

function decode(bytes: Buffer, contentTypeHeader: string): string {
  const charset = /charset\s*=\s*"?([^";\s]+)/i.exec(contentTypeHeader)?.[1];
  try {
    return new TextDecoder(charset ?? "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

export class SafeContentFetcher implements ContentFetcher {
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly maxRedirects: number;
  private readonly userAgent: string;
  private readonly allowPrivate: boolean;
  private readonly allowedHosts: Set<string>;
  private readonly resolver: HostResolver;
  private readonly transport: Transport;

  constructor(options: ContentFetcherOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
    this.maxBytes = options.maxBytes ?? DEFAULT_FETCH_MAX_BYTES;
    this.maxRedirects = options.maxRedirects ?? DEFAULT_FETCH_MAX_REDIRECTS;
    this.userAgent = options.userAgent ?? DEFAULT_FETCH_USER_AGENT;
    this.allowPrivate = options.allowPrivate ?? false;
    this.allowedHosts = new Set(
      (options.allowedHosts ?? []).map((host) => host.trim().toLowerCase()).filter(Boolean)
    );
    this.resolver = options.resolver ?? defaultResolver;
    this.transport = options.transport ?? nodeTransport;
  }

  async fetch(request: FetchRequest): Promise<FetchedContent> {
    const controller = new AbortController();
    let timedOut = false;
    // One deadline for the whole fetch: every redirect and the body read count against it.
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    const onAbort = (): void => controller.abort();
    request.signal?.addEventListener("abort", onAbort, { once: true });
    if (request.signal?.aborted) {
      controller.abort();
    }

    try {
      return await this.follow(request.url, controller.signal);
    } catch (error) {
      const failure = this.toFetchError(error, request.url, timedOut, controller.signal);
      logger.warn("Fetch failed", { url: failure.url, code: failure.code, status: failure.status });
      throw failure;
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", onAbort);
    }
  }

  private toFetchError(
    error: unknown,
    url: string,
    timedOut: boolean,
    signal: AbortSignal
  ): FetchError {
    if (error instanceof FetchError) {
      return error;
    }
    if (timedOut) {
      return fail("fetch_timeout", `Fetching timed out after ${this.timeoutMs}ms`, url);
    }
    if (signal.aborted) {
      return fail("fetch_network", "Fetching was aborted by the caller", url);
    }
    const reason = error instanceof Error ? error.message : String(error);
    return fail("fetch_network", `Fetching failed: ${reason}`, url);
  }

  private async follow(startUrl: string, signal: AbortSignal): Promise<FetchedContent> {
    let current = this.parse(startUrl, startUrl);

    for (let hop = 0; ; hop++) {
      const address = await this.check(current, startUrl);
      const response = await this.transport({
        url: current,
        address,
        signal,
        headers: {
          "user-agent": this.userAgent,
          accept:
            "text/html, application/xhtml+xml, application/xml, application/rss+xml, application/atom+xml, text/xml, text/plain;q=0.9",
          "accept-encoding": "identity"
        }
      });

      try {
        if (REDIRECT_STATUSES.has(response.status)) {
          const location = response.headers.location;
          response.destroy();
          if (!location) {
            throw fail(
              "fetch_http_error",
              `Redirect ${response.status} without a Location`,
              startUrl,
              response.status
            );
          }
          if (hop >= this.maxRedirects) {
            throw fail(
              "fetch_http_error",
              `More than ${this.maxRedirects} redirects`,
              startUrl,
              response.status
            );
          }
          // Re-validated by the next iteration: scheme, host allowlist and DNS of every hop.
          current = this.parse(new URL(location, current).toString(), startUrl);
          continue;
        }

        if (response.status < 200 || response.status >= 300) {
          response.destroy();
          throw fail(
            "fetch_http_error",
            `Server answered ${response.status}`,
            startUrl,
            response.status
          );
        }

        const contentTypeHeader = response.headers["content-type"] ?? "";
        const contentType = contentTypeHeader.split(";")[0].trim().toLowerCase();
        if (!ALLOWED_TYPES.has(contentType)) {
          response.destroy();
          throw fail(
            "fetch_unsupported_type",
            `Content type "${contentType || "unknown"}" is not supported`,
            startUrl,
            response.status
          );
        }
        const encoding = response.headers["content-encoding"]?.trim().toLowerCase();
        if (encoding && encoding !== "identity") {
          response.destroy();
          throw fail(
            "fetch_unsupported_type",
            `Content encoding "${encoding}" is not supported`,
            startUrl,
            response.status
          );
        }
        const declared = Number(response.headers["content-length"]);
        if (Number.isFinite(declared) && declared > this.maxBytes) {
          response.destroy();
          throw fail(
            "fetch_too_large",
            `Response of ${declared} bytes exceeds ${this.maxBytes}`,
            startUrl,
            response.status
          );
        }

        const body = await this.readBody(response, startUrl);
        return {
          url: startUrl,
          finalUrl: current.toString(),
          status: response.status,
          contentType,
          size: body.length,
          body: decode(body, contentTypeHeader)
        };
      } catch (error) {
        response.destroy();
        throw error;
      }
    }
  }

  private async readBody(response: TransportResponse, url: string): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > this.maxBytes) {
        response.destroy();
        throw fail(
          "fetch_too_large",
          `Response exceeds ${this.maxBytes} bytes`,
          url,
          response.status
        );
      }
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  private parse(value: string, originalUrl: string): URL {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw fail("fetch_blocked", "Not a valid URL", originalUrl);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw fail(
        "fetch_blocked",
        `Scheme "${url.protocol.slice(0, -1)}" is not allowed`,
        originalUrl
      );
    }
    if (url.username || url.password) {
      throw fail("fetch_blocked", "URLs with credentials are not allowed", originalUrl);
    }
    return url;
  }

  /** Enforces the allowlist and the address rules for one hop; returns the address to connect to. */
  private async check(url: URL, originalUrl: string): Promise<ResolvedAddress> {
    const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (this.allowedHosts.size > 0 && !this.allowedHosts.has(hostname)) {
      throw fail(
        "fetch_blocked",
        `Host "${hostname}" is not in OPENBLOG_FETCH_ALLOWED_HOSTS`,
        originalUrl
      );
    }

    let addresses: ResolvedAddress[];
    const literal = isIP(hostname);
    if (literal) {
      addresses = [{ address: hostname, family: literal as 4 | 6 }];
    } else {
      try {
        addresses = await this.resolver(hostname);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw fail("fetch_network", `Could not resolve "${hostname}": ${reason}`, originalUrl);
      }
      if (addresses.length === 0) {
        throw fail("fetch_network", `"${hostname}" did not resolve to any address`, originalUrl);
      }
    }

    // Every answer must be public: a name that also resolves to an internal address is refused.
    if (!this.allowPrivate && addresses.some((entry) => isPrivateAddress(entry.address))) {
      throw fail(
        "fetch_blocked",
        `"${hostname}" points to a private or reserved address`,
        originalUrl
      );
    }
    return addresses[0];
  }
}

export function createContentFetcher(options: ContentFetcherOptions = {}): ContentFetcher {
  return new SafeContentFetcher(options);
}
