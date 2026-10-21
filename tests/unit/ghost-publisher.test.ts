import { describe, expect, it, vi } from "vitest";

import { logger } from "../../packages/logger/src";
import {
  GhostPublisher,
  createPublishersFromConfig,
  type PublishArticle
} from "../../packages/publishers/src";

const article: PublishArticle = {
  title: "Hello",
  slug: "hello",
  summary: "Summary",
  content: "# Hello",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  tags: [],
  category: "News",
  author: "OpenBlogAgent",
  language: "en",
  target: "ghost"
};

describe("Ghost publisher", () => {
  it("never reports success: publish fails with not_implemented and makes no request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const publisher = new GhostPublisher(
      { endpoint: "https://example.ghost.io", apiKey: "id:secret", status: "draft" },
      logger
    );
    const result = await publisher.publish(article);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("not_implemented");
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("is not registered by the factory, even if Ghost settings are passed", () => {
    const publishers = createPublishersFromConfig(
      {
        markdown: { outputDir: "output" },
        ghost: { endpoint: "https://example.ghost.io", apiKey: "id:secret" }
      } as Parameters<typeof createPublishersFromConfig>[0],
      logger
    );

    expect(publishers.map((p) => p.id)).toEqual(["markdown"]);
  });
});
