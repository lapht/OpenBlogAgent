import { z } from "zod";

import type { ILogger } from "@openblog/logger";
import type { ICategoryProvider, ITagProvider } from "../taxonomy/types";
import type {
  IPublisher,
  PublishArticle,
  PublishResult,
  PublisherValidationIssue,
  PublisherValidationResult
} from "../types";
import {
  WordPressRequestError,
  basicAuthHeader,
  isWordPressRestBase,
  normalizeWordPressEndpoint,
  wordpressFetch
} from "./http";
import { markdownToSafeHtml } from "./markdown";

export * from "./http";

const postResponseSchema = z.object({
  id: z.number().int(),
  link: z.string().url(),
  status: z.string(),
  slug: z.string()
});

/** Only WordPress Application Passwords authenticate against the core REST API. */
export interface WordPressPublisherConfig {
  endpoint: string;
  username?: string;
  applicationPassword?: string;
  status?: "draft" | "publish";
  timeoutMs?: number;
}

export class WordPressPublisher implements IPublisher {
  readonly id = "wordpress";
  readonly name = "WordPress Publisher";

  constructor(
    public readonly config: WordPressPublisherConfig,
    private readonly logger: ILogger,
    private readonly categoryProvider: ICategoryProvider,
    private readonly tagProvider: ITagProvider
  ) {}

  async validate(article: PublishArticle): Promise<PublisherValidationResult> {
    const issues: PublisherValidationIssue[] = [];
    if (!this.config.endpoint?.trim()) {
      issues.push({ field: "endpoint", message: "WordPress endpoint is required" });
    } else if (!isWordPressRestBase(normalizeWordPressEndpoint(this.config.endpoint))) {
      issues.push({
        field: "endpoint",
        message: "WordPress endpoint must be an http(s) URL ending in /wp-json/wp/v2"
      });
    }
    if (!this.config.username?.trim()) {
      issues.push({ field: "username", message: "WordPress username is required" });
    }
    if (!this.config.applicationPassword?.trim()) {
      issues.push({
        field: "applicationPassword",
        message: "WordPress application password is required"
      });
    }
    if (!article.title?.trim()) issues.push({ field: "title", message: "Title is required" });
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

    try {
      const categoryEntry = await this.categoryProvider.resolve(article.category);
      const tagEntries = await this.tagProvider.resolveMany(article.tags ?? []);

      const payload = {
        title: article.title,
        slug: article.slug,
        content: markdownToSafeHtml(article.content),
        excerpt: article.summary,
        status: this.config.status ?? "draft",
        categories: [categoryEntry.id],
        tags: tagEntries.map((t) => t.id)
      };

      this.logger.info("WordPress publisher payload prepared", {
        slug: article.slug,
        status: payload.status
      });

      const postEndpoint = `${normalizeWordPressEndpoint(this.config.endpoint)}/posts`;

      const response = await wordpressFetch(
        postEndpoint,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: basicAuthHeader(
              this.config.username ?? "",
              this.config.applicationPassword ?? ""
            )
          },
          body: JSON.stringify(payload)
        },
        this.config.timeoutMs
      );

      const parsed = postResponseSchema.safeParse(await response.json().catch(() => undefined));
      if (!parsed.success) {
        throw new WordPressRequestError(
          "unexpected_response",
          "WordPress returned a response without a valid post id, link, status and slug",
          response.status
        );
      }

      return {
        success: true,
        publisherId: this.id,
        publisherName: this.name,
        metadata: {
          id: parsed.data.id,
          link: parsed.data.link,
          status: parsed.data.status,
          slug: parsed.data.slug,
          endpoint: postEndpoint
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown WordPress publish error";
      const code = error instanceof WordPressRequestError ? error.code : "publish_failed";
      this.logger.error("WordPress publisher error", { slug: article.slug, code, error: message });
      return {
        success: false,
        publisherId: this.id,
        publisherName: this.name,
        error: {
          code,
          message,
          details: {
            slug: article.slug,
            ...(error instanceof WordPressRequestError && error.status
              ? { status: error.status }
              : {})
          }
        }
      };
    }
  }
}
