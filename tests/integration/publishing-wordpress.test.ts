import { describe, expect, it, vi } from "vitest";

import { logger } from "../../packages/logger/src";
import {
  WordPressPublisher,
  type ICategoryProvider,
  type ITagProvider
} from "../../packages/publishers/src";

describe("WordPress publisher integration test", () => {
  it("creates a draft article payload for a configured WordPress endpoint", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 201,
      text: async () => JSON.stringify({ id: 123, status: "draft" })
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
        password: "dummy_password",
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
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://example.com/wp-json/wp/v2/posts");
    expect(options.method).toBe("POST");
    expect(options.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from("demo_user:dummy_app_password").toString("base64")}`
    });

    const body = JSON.parse(String(options?.body));
    expect(body.title).toBe(article.title);
    expect(body.status).toBe("draft");
    expect(body.content).toBe(article.content);
    expect(body.excerpt).toBe(article.summary);
    expect(body.categories).toEqual([42]);
    expect(body.tags).toEqual([100, 101]);

    vi.unstubAllGlobals();
  });
});
