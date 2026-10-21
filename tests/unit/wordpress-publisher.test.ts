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

function stubFetch(status: number, body: unknown) {
  const mock = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  }));
  vi.stubGlobal("fetch", mock);
  return mock;
}

describe("WordPressPublisher", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends slug, sanitized HTML, numeric term ids, excerpt and draft status", async () => {
    const fetchMock = stubFetch(201, okBody);
    const result = await makePublisher().publish(article);

    expect(result.success).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
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
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(`${ENDPOINT}/posts`);
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
