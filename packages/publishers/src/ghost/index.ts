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

  /** Never reports success: no Ghost Admin API call exists yet (tracked in the Post-MVP milestone). */
  async publish(article: PublishArticle): Promise<PublishResult> {
    this.logger.error("Ghost publisher is not implemented", { slug: article.slug });

    return {
      success: false,
      publisherId: this.id,
      publisherName: this.name,
      error: {
        code: "not_implemented",
        message: "The Ghost publisher is not implemented; nothing was published",
        details: { slug: article.slug }
      }
    };
  }
}
