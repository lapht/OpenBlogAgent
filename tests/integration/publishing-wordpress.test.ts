import { describe, expect, it, vi } from "vitest";

import { logger } from "../../packages/logger/src";
import {
  WordPressPublisher,
  type ICategoryProvider,
  type ITagProvider
} from "../../packages/publishers/src";

describe("WordPress publisher integration test", () => {
  it("creates a draft article payload for a configured WordPress endpoint", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({
      ok: true,
      status: init?.method === "GET" ? 200 : 201,
      json: async () =>
        init?.method === "GET"
          ? []
          : {
              id: 123,
              status: "draft",
              slug: "integration-test-draft",
              link: "https://example.com/?p=123"
            }
    }));

    vi.stubGlobal("fetch", fetchMock);

    const categoryProvider: ICategoryProvider = {
      list: async () => [{ id: 42, name: "Testing" }],
      resolve: async (name) => ({ id: 42, name })
    };
    const tagProvider: ITagProvider = {
      list: async () => [],
      resolveMany: async (names) => names.map((name, index) => ({ id: 100 + index, name }))
    };

    const publisher = new WordPressPublisher(
      {
        endpoint: "https://example.com/wp-json/wp/v2",
        username: "demo_user",
        applicationPassword: "dummy_app_password",
        status: "draft"
      },
      logger,
      categoryProvider,
      tagProvider
    );

    const article = {
      title: "Integration Test Draft",
      slug: "integration-test-draft",
      summary: "Draft created by the integration test",
      content:
        "# Integration Test Draft\n\nThis is a draft article created by the integration test.",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      tags: ["test", "integration"],
      category: "Testing",
      author: "OpenBlogAgent",
      language: "en",
      target: "wordpress"
    };

    const result = await publisher.publish(article);

    expect(result.success).toBe(true);
    expect(result.publisherId).toBe("wordpress");
    expect(result.metadata).toMatchObject({ id: 123, link: "https://example.com/?p=123" });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [url, options] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe("https://example.com/wp-json/wp/v2/posts");
    expect(options.method).toBe("POST");
    expect(options.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from("demo_user:dummy_app_password").toString("base64")}`
    });

    const body = JSON.parse(String(options?.body));
    expect(body.title).toBe(article.title);
    expect(body.status).toBe("draft");
    expect(body.slug).toBe(article.slug);
    expect(body.content).toContain("<h1>Integration Test Draft</h1>");
    expect(body.content).not.toMatch(/^#/);
    expect(body.excerpt).toBe(article.summary);
    expect(body.categories).toEqual([42]);
    expect(body.tags).toEqual([100, 101]);

    vi.unstubAllGlobals();
  });
});
