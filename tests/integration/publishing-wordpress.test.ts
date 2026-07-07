import { describe, expect, it, vi } from "vitest";

import { logger } from "../../packages/logger/src";
import { WordPressPublisher } from "../../packages/publishers/src";

describe("WordPress publisher integration test", () => {
  it("creates a draft article payload for a configured WordPress endpoint", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 201,
      text: async () => JSON.stringify({ id: 123, status: "draft" })
    }));

    vi.stubGlobal("fetch", fetchMock);

    const publisher = new WordPressPublisher(
      {
        endpoint: "https://example.com/wp-json/wp/v2/posts",
        username: "demo_user",
        password: "dummy_password",
        applicationPassword: "dummy_app_password",
        status: "draft"
      },
      logger
    );

    const article = {
      title: "Integration Test Draft",
      slug: "integration-test-draft",
      summary: "Draft created by the integration test",
      content: "# Integration Test Draft\n\nThis is a draft article created by the integration test.",
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

    const [, options] = fetchMock.mock.calls[0];
    expect(options?.method).toBe("POST");
    expect(options?.headers).toBeDefined();

    const body = JSON.parse(String(options?.body));
    expect(body.title).toBe(article.title);
    expect(body.status).toBe("draft");
    expect(body.categories).toEqual([article.category]);
    expect(body.tags).toEqual(article.tags);

    vi.unstubAllGlobals();
  });
});
