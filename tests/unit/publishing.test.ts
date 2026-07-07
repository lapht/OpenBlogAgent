import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logger } from "../../packages/logger/src";
import {
  DefaultPublisherManager,
  MarkdownPublisher,
  WordPressPublisher,
  type IPublisher,
  type PublishArticle,
  type PublishResult,
  type PublisherValidationResult
} from "../../packages/publishers/src";

describe("Publishing Engine", () => {
  const baseArticle: PublishArticle = {
    title: "Test Article",
    slug: "test-article",
    summary: "A short summary",
    content: "# Test Article\n\nBody",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    tags: ["testing"],
    category: "Engineering",
    author: "OpenBlogAgent",
    language: "en"
  };

  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "openblog-publisher-"));
  });

  it("allows a mock publisher implementation to be registered and used", async () => {
    const calls: string[] = [];

    class MockPublisher implements IPublisher {
      id = "mock";
      name = "Mock Publisher";

      async validate(article: PublishArticle): Promise<PublisherValidationResult> {
        return { valid: Boolean(article.title), issues: [] };
      }

      supports(article: PublishArticle): boolean {
        return article.title.length > 0;
      }

      async publish(article: PublishArticle): Promise<PublishResult> {
        calls.push(article.slug);

        return {
          success: true,
          publisherId: this.id,
          publisherName: this.name,
          metadata: { slug: article.slug }
        };
      }
    }

    const manager = new DefaultPublisherManager(logger, [], { defaultPublisherId: "mock" });
    manager.register(new MockPublisher());

    const result = await manager.publish(baseArticle);

    expect(result.success).toBe(true);
    expect(result.publisherId).toBe("mock");
    expect(calls).toEqual(["test-article"]);
  });

  it("publishes markdown content to a file with YAML front matter", async () => {
    const publisher = new MarkdownPublisher({ outputDir: tempDir }, logger);

    const result = await publisher.publish(baseArticle);

    const outputPath = path.join(tempDir, "test-article.md");
    const fileContents = readFileSync(outputPath, "utf8");

    expect(result.success).toBe(true);
    expect(result.outputPath).toBe(outputPath);
    expect(fileContents).toContain("---");
    expect(fileContents).toContain("title: Test Article");
    expect(fileContents).toContain("slug: test-article");
    expect(fileContents).toContain("# Test Article");
  });

  it("uses the default publisher when no explicit target is supplied", async () => {
    const mockPublisher = {
      id: "default-mock",
      name: "Default Mock",
      validate: vi.fn(async () => ({ valid: true, issues: [] })),
      supports: vi.fn(() => true),
      publish: vi.fn(async (article: PublishArticle) => ({
        success: true,
        publisherId: "default-mock",
        publisherName: "Default Mock",
        metadata: { slug: article.slug }
      }))
    } satisfies IPublisher;

    const manager = new DefaultPublisherManager(logger, [mockPublisher], {
      defaultPublisherId: "default-mock"
    });

    const result = await manager.publish(baseArticle);

    expect(result.success).toBe(true);
    expect(mockPublisher.publish).toHaveBeenCalledTimes(1);
  });

  it("sends WordPress categories as integers instead of strings", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => ""
    }));

    vi.stubGlobal("fetch", fetchMock);

    const publisher = new WordPressPublisher(
      {
        endpoint: "https://example.com/wp-json/wp/v2/posts",
        username: "user",
        applicationPassword: "pass"
      },
      logger
    );

    await publisher.publish({
      ...baseArticle,
      category: "42"
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0];
    expect(JSON.parse(options.body as string).categories).toEqual([42]);

    vi.unstubAllGlobals();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });
});
