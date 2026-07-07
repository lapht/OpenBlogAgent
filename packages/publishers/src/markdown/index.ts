import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { ILogger } from "@openblog/logger";

import type {
  IPublisher,
  PublishArticle,
  PublishResult,
  PublisherValidationIssue,
  PublisherValidationResult
} from "../types";

export interface MarkdownPublisherConfig {
  outputDir: string;
}

export class MarkdownPublisher implements IPublisher {
  readonly id = "markdown";
  readonly name = "Markdown Publisher";

  constructor(
    public readonly config: MarkdownPublisherConfig,
    private readonly logger: ILogger
  ) {}

  async validate(article: PublishArticle): Promise<PublisherValidationResult> {
    const issues: PublisherValidationIssue[] = [];

    if (!article.title?.trim()) {
      issues.push({ field: "title", message: "Title is required" });
    }

    if (!article.slug?.trim()) {
      issues.push({ field: "slug", message: "Slug is required" });
    }

    if (!article.content?.trim()) {
      issues.push({ field: "content", message: "Content is required" });
    }

    return { valid: issues.length === 0, issues };
  }

  supports(article: PublishArticle): boolean {
    return article.target === undefined || article.target === "markdown";
  }

  async publish(article: PublishArticle): Promise<PublishResult> {
    const validation = await this.validate(article);

    if (!validation.valid) {
      this.logger.error("Markdown publisher validation failed", {
        slug: article.slug,
        issues: validation.issues
      });

      return {
        success: false,
        publisherId: this.id,
        publisherName: this.name,
        error: {
          code: "validation_failed",
          message: "Markdown publisher validation failed",
          details: { issues: validation.issues }
        }
      };
    }

    const outputDir = this.config.outputDir;
    mkdirSync(outputDir, { recursive: true });

    const outputPath = path.join(outputDir, `${article.slug}.md`);
    const contents = this.buildFrontMatter(article);

    writeFileSync(outputPath, contents, "utf8");

    this.logger.info("Markdown publisher wrote article", {
      outputPath,
      slug: article.slug
    });

    return {
      success: true,
      publisherId: this.id,
      publisherName: this.name,
      outputPath,
      metadata: {
        slug: article.slug,
        format: "markdown"
      }
    };
  }

  private buildFrontMatter(article: PublishArticle): string {
    return [
      "---",
      `title: ${article.title}`,
      `slug: ${article.slug}`,
      `category: ${article.category}`,
      `tags: ${article.tags.join(", ")}`,
      `createdAt: ${article.createdAt}`,
      `author: ${article.author}`,
      "---",
      "",
      article.content,
      ""
    ].join("\n");
  }
}
