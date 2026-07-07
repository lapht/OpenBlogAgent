import type { ILogger } from "@openblog/logger";

import type {
  IPublisher,
  PublishArticle,
  PublishResult,
  PublisherValidationIssue,
  PublisherValidationResult
} from "../types";

function normalizeWordPressCategories(category: string | undefined): number[] {
  if (!category) {
    return [];
  }

  const parsed = Number(category);
  return Number.isFinite(parsed) ? [parsed] : [];
}

export interface WordPressPublisherConfig {
  endpoint: string;
  username?: string;
  password?: string;
  applicationPassword?: string;
  status?: "draft" | "publish";
}

export class WordPressPublisher implements IPublisher {
  readonly id = "wordpress";
  readonly name = "WordPress Publisher";

  constructor(
    public readonly config: WordPressPublisherConfig,
    private readonly logger: ILogger
  ) {}

  async validate(article: PublishArticle): Promise<PublisherValidationResult> {
    const issues: PublisherValidationIssue[] = [];

    if (!this.config.endpoint?.trim()) {
      issues.push({ field: "endpoint", message: "WordPress endpoint is required" });
    }

    if (!this.config.username?.trim() && !this.config.applicationPassword?.trim()) {
      issues.push({ field: "authentication", message: "WordPress authentication is required" });
    }

    if (!article.title?.trim()) {
      issues.push({ field: "title", message: "Title is required" });
    }

    return { valid: issues.length === 0, issues };
  }

  supports(article: PublishArticle): boolean {
    return article.target === "wordpress";
  }

  async publish(article: PublishArticle): Promise<PublishResult> {
    const validation = await this.validate(article);

    if (!validation.valid) {
      this.logger.error("WordPress publisher validation failed", {
        slug: article.slug,
        issues: validation.issues
      });

      return {
        success: false,
        publisherId: this.id,
        publisherName: this.name,
        error: {
          code: "validation_failed",
          message: "WordPress publisher validation failed",
          details: { issues: validation.issues }
        }
      };
    }

    const payload = {
      title: article.title,
      content: article.content,
      excerpt: article.summary,
      status: this.config.status ?? "draft",
      categories: normalizeWordPressCategories(article.category),
      tags: article.tags ?? []
    };

    this.logger.info("WordPress publisher payload prepared", {
      slug: article.slug,
      status: payload.status
    });

    try {
      const response = await fetch(this.config.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${Buffer.from(`${this.config.username ?? ""}:${this.config.applicationPassword ?? this.config.password ?? ""}`).toString("base64")}`
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`WordPress request failed with ${response.status}: ${text}`);
      }

      return {
        success: true,
        publisherId: this.id,
        publisherName: this.name,
        metadata: {
          slug: article.slug,
          status: payload.status,
          endpoint: this.config.endpoint
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown WordPress publish error";
      this.logger.error("WordPress publisher error", {
        slug: article.slug,
        error: message
      });

      return {
        success: false,
        publisherId: this.id,
        publisherName: this.name,
        error: {
          code: "publish_failed",
          message,
          details: { slug: article.slug }
        }
      };
    }
  }
}
