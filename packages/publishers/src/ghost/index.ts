import type { ILogger } from "@openblog/logger";

import type {
  IPublisher,
  PublishArticle,
  PublishResult,
  PublisherValidationIssue,
  PublisherValidationResult
} from "../types";

export interface GhostPublisherConfig {
  endpoint: string;
  apiKey?: string;
  status?: "draft" | "publish";
}

export class GhostPublisher implements IPublisher {
  readonly id = "ghost";
  readonly name = "Ghost Publisher";

  constructor(
    public readonly config: GhostPublisherConfig,
    private readonly logger: ILogger
  ) {}

  async validate(article: PublishArticle): Promise<PublisherValidationResult> {
    const issues: PublisherValidationIssue[] = [];

    if (!this.config.endpoint?.trim()) {
      issues.push({ field: "endpoint", message: "Ghost endpoint is required" });
    }

    if (!this.config.apiKey?.trim()) {
      issues.push({ field: "apiKey", message: "Ghost API key is required" });
    }

    if (!article.title?.trim()) {
      issues.push({ field: "title", message: "Title is required" });
    }

    return { valid: issues.length === 0, issues };
  }

  supports(article: PublishArticle): boolean {
    return article.target === "ghost";
  }

  async publish(article: PublishArticle): Promise<PublishResult> {
    const validation = await this.validate(article);

    if (!validation.valid) {
      this.logger.error("Ghost publisher validation failed", {
        slug: article.slug,
        issues: validation.issues
      });

      return {
        success: false,
        publisherId: this.id,
        publisherName: this.name,
        error: {
          code: "validation_failed",
          message: "Ghost publisher validation failed",
          details: { issues: validation.issues }
        }
      };
    }

    this.logger.info("Ghost publisher payload prepared", {
      slug: article.slug,
      status: this.config.status ?? "draft"
    });

    return {
      success: true,
      publisherId: this.id,
      publisherName: this.name,
      metadata: {
        slug: article.slug,
        status: this.config.status ?? "draft",
        endpoint: this.config.endpoint
      }
    };
  }
}
