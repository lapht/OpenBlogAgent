import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";

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

  it("slugifies hostile slugs and never writes outside the output directory", async () => {
    const outputDir = path.join(tempDir, "articles");
    const publisher = new MarkdownPublisher({ outputDir }, logger);

    const result = await publisher.publish({ ...baseArticle, slug: "../../etc/x" });

    expect(result.success).toBe(true);
    expect(result.outputPath).toBe(path.join(outputDir, "etc-x.md"));
    expect(readdirSync(outputDir)).toEqual(["etc-x.md"]);
    expect(readdirSync(tempDir)).toEqual(["articles"]);
  });

  it("rejects a slug with no usable characters", async () => {
    const publisher = new MarkdownPublisher({ outputDir: tempDir }, logger);

    const result = await publisher.publish({ ...baseArticle, slug: "../.." });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("invalid_slug");
    expect(readdirSync(tempDir)).toEqual([]);
  });

  it("writes front matter that round-trips through a YAML parser", async () => {
    const publisher = new MarkdownPublisher({ outputDir: tempDir }, logger);
    const article: PublishArticle = {
      ...baseArticle,
      title: 'Rust: "safe" # systems\nprogramming — è tutto qui 🚀',
      summary: "Line one: here\nline two",
      tags: ["a: b", "c, d", "ünï"]
    };

    const result = await publisher.publish(article);
    const raw = readFileSync(result.outputPath as string, "utf8");
    const [, frontMatter, body] = raw.split(/^---$/m);
    const data = parse(frontMatter) as Record<string, unknown>;

    expect(data.title).toBe(article.title);
    expect(data.description).toBe(article.summary);
    expect(data.tags).toEqual(article.tags);
    expect(data.slug).toBe("test-article");
    expect(data.updatedAt).toBe(article.updatedAt);
    expect(body).toContain("# Test Article");
  });

  it("refuses to overwrite an existing article unless overwrite is enabled", async () => {
    const first = await new MarkdownPublisher({ outputDir: tempDir }, logger).publish(baseArticle);
    expect(first.success).toBe(true);

    const second = await new MarkdownPublisher({ outputDir: tempDir }, logger).publish({
      ...baseArticle,
      content: "# Replaced"
    });

    expect(second.success).toBe(false);
    expect(second.error?.code).toBe("already_exists");
    expect(readFileSync(first.outputPath as string, "utf8")).toContain("Body");

    const third = await new MarkdownPublisher(
      { outputDir: tempDir, overwrite: true },
      logger
    ).publish({
      ...baseArticle,
      content: "# Replaced"
    });

    expect(third.success).toBe(true);
    expect(existsSync(first.outputPath as string)).toBe(true);
    expect(readFileSync(first.outputPath as string, "utf8")).toContain("# Replaced");
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

  it("reports a failed result when the WordPress API rejects the request", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ code: "rest_forbidden" })
    }));
    vi.stubGlobal("fetch", fetchMock);

    const publisher = new WordPressPublisher(
      {
        endpoint: "https://example.com/wp-json/wp/v2",
        username: "user",
        applicationPassword: "pass"
      },
      logger,
      { list: async () => [], resolve: async () => ({ id: 1, name: "Engineering" }) },
      { list: async () => [], resolveMany: async () => [] }
    );

    const result = await publisher.publish(baseArticle);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("auth_failed");
    expect(result.error?.message).toContain("401");

    vi.unstubAllGlobals();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });
});
