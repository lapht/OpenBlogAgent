import { z } from "zod";

import type { ILogger } from "@openblog/logger";
import type { ICategoryProvider, ITagProvider } from "../taxonomy/types";
import type {
  ExistingPost,
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
  /**
   * What to do when a post with the same slug already exists: `update` it in place (default) or
   * fail with a `conflict` result.
   */
  onExisting?: "update" | "conflict";
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
      const headers = {
        "Content-Type": "application/json",
        Authorization: basicAuthHeader(
          this.config.username ?? "",
          this.config.applicationPassword ?? ""
        )
      };

      // Look the slug up before every write, so a retry after a timeout finds the earlier post.
      const existing = await this.findBySlug(postEndpoint, article.slug, headers);

      if (existing && (this.config.onExisting ?? "update") === "conflict") {
        this.logger.warn("WordPress post with this slug already exists", {
          slug: article.slug,
          id: existing.id
        });
        return {
          success: false,
          publisherId: this.id,
          publisherName: this.name,
          error: {
            code: "conflict",
            message: `A WordPress post with slug "${article.slug}" already exists (id ${existing.id})`,
            details: { slug: article.slug, id: existing.id, link: existing.link }
          }
        };
      }

      // An update never changes the status of a post that is already live unless asked to publish.
      const updatePayload: Partial<typeof payload> = { ...payload };
      if (this.config.status !== "publish") {
        delete updatePayload.status;
      }

      const response = await wordpressFetch(
        existing ? `${postEndpoint}/${existing.id}` : postEndpoint,
        {
          method: existing ? "PUT" : "POST",
          headers,
          body: JSON.stringify(existing ? updatePayload : payload)
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
          endpoint: postEndpoint,
          action: existing ? "updated" : "created"
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

  /** Read-only lookup used by the duplicate policy; failures are thrown to the caller. */
  async findExisting(article: Pick<PublishArticle, "slug">): Promise<ExistingPost | null> {
    const found = await this.findBySlug(
      `${normalizeWordPressEndpoint(this.config.endpoint)}/posts`,
      article.slug,
      {
        "Content-Type": "application/json",
        Authorization: basicAuthHeader(
          this.config.username ?? "",
          this.config.applicationPassword ?? ""
        )
      }
    );
    return found ? { id: String(found.id), url: found.link } : null;
  }

  /** The post with exactly this slug in any status, or undefined. Lookup failures abort the publish. */
  private async findBySlug(
    postEndpoint: string,
    slug: string,
    headers: Record<string, string>
  ): Promise<z.infer<typeof postResponseSchema> | undefined> {
    const query = new URLSearchParams({ slug, status: "any" });
    const response = await wordpressFetch(
      `${postEndpoint}?${query.toString()}`,
      { method: "GET", headers },
      this.config.timeoutMs
    );
    const parsed = z
      .array(postResponseSchema)
      .safeParse(await response.json().catch(() => undefined));

    if (!parsed.success) {
      throw new WordPressRequestError(
        "unexpected_response",
        "WordPress returned an invalid response when looking up the post by slug",
        response.status
      );
    }

    return parsed.data.find((post) => post.slug === slug);
  }
}
