import { z } from "zod";

import type { ILogger } from "@openblog/logger";

import type {
  ExistingPost,
  IPublisher,
  PublishArticle,
  PublishResult,
  PublisherValidationIssue,
  PublisherValidationResult
} from "../types";
import { markdownToSafeHtml } from "../wordpress/markdown";
import {
  GHOST_ACCEPT_VERSION,
  GhostRequestError,
  createGhostToken,
  ghostAdminBase,
  ghostFetch,
  isGhostEndpoint,
  parseGhostAdminKey
} from "./http";

export * from "./http";

const postSchema = z.object({
  id: z.string().min(1),
  url: z.string().url(),
  status: z.string(),
  slug: z.string(),
  updated_at: z.string().optional()
});

const postsResponseSchema = z.object({ posts: z.array(postSchema).min(1) });

/** Ghost caps the custom excerpt at 300 characters. */
const MAX_EXCERPT_LENGTH = 300;

export interface GhostPublisherConfig {
  /** The site URL, e.g. `https://blog.example.com` (the Admin API path is added). */
  endpoint: string;
  /** Admin API key, `<id>:<secret>`, from a custom integration in Ghost. */
  apiKey?: string;
  status?: "draft" | "publish";
  timeoutMs?: number;
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
    } else if (!isGhostEndpoint(this.config.endpoint.trim())) {
      issues.push({ field: "endpoint", message: "Ghost endpoint must be an http(s) URL" });
    }

    if (!this.config.apiKey?.trim()) {
      issues.push({ field: "apiKey", message: "Ghost Admin API key is required" });
    } else if (!parseGhostAdminKey(this.config.apiKey)) {
      issues.push({ field: "apiKey", message: "Ghost Admin API key must look like <id>:<secret>" });
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
      return this.failure(article, "validation_failed", "Ghost publisher validation failed", {
        issues: validation.issues
      });
    }

    try {
      const base = ghostAdminBase(this.config.endpoint);
      const status = article.status ?? this.config.status ?? "draft";

      // Ghost has no categories: the category becomes the first (primary) tag.
      const tagNames = [...new Set([article.category, ...(article.tags ?? [])].filter(Boolean))];
      const post = {
        title: article.title,
        slug: article.slug,
        html: markdownToSafeHtml(article.content),
        custom_excerpt: article.summary.slice(0, MAX_EXCERPT_LENGTH),
        tags: tagNames.map((name) => ({ name })),
        status: status === "publish" ? "published" : "draft"
      };

      this.logger.info("Ghost publisher payload prepared", { slug: article.slug, status });

      // Look the slug up before every write, so a retry after a timeout finds the earlier post.
      const existing = await this.findBySlug(base, article.slug);

      // An update never takes a live post offline unless asked to publish.
      const update: Partial<typeof post> = { ...post };
      if (status !== "publish") {
        delete update.status;
      }
      const body = existing ? { ...update, updated_at: existing.updated_at } : post;

      const response = await ghostFetch(
        existing ? `${base}/posts/${existing.id}/?source=html` : `${base}/posts/?source=html`,
        {
          method: existing ? "PUT" : "POST",
          headers: this.headers(),
          body: JSON.stringify({ posts: [body] })
        },
        { timeoutMs: this.config.timeoutMs }
      );

      const parsed = postsResponseSchema.safeParse(await response.json().catch(() => undefined));
      if (!parsed.success) {
        throw new GhostRequestError(
          "unexpected_response",
          "Ghost returned a response without a valid post id, url, status and slug",
          response.status
        );
      }
      const saved = parsed.data.posts[0]!;

      return {
        success: true,
        publisherId: this.id,
        publisherName: this.name,
        metadata: {
          id: saved.id,
          link: saved.url,
          status: saved.status,
          slug: saved.slug,
          endpoint: base,
          action: existing ? "updated" : "created"
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Ghost publish error";
      const code = error instanceof GhostRequestError ? error.code : "publish_failed";
      this.logger.error("Ghost publisher error", { slug: article.slug, code, error: message });
      return this.failure(article, code, message, {
        slug: article.slug,
        ...(error instanceof GhostRequestError && error.status ? { status: error.status } : {})
      });
    }
  }

  /** Read-only lookup used by the duplicate policy; failures are thrown to the caller. */
  async findExisting(article: Pick<PublishArticle, "slug">): Promise<ExistingPost | null> {
    const found = await this.findBySlug(ghostAdminBase(this.config.endpoint), article.slug);
    return found ? { id: found.id, url: found.url } : null;
  }

  /** A fresh token per request: they last five minutes, and a run can take longer than that. */
  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "Accept-Version": GHOST_ACCEPT_VERSION,
      Authorization: `Ghost ${createGhostToken(this.config.apiKey ?? "")}`
    };
  }

  /** The post with exactly this slug in any status, or undefined (Ghost answers 404). */
  private async findBySlug(
    base: string,
    slug: string
  ): Promise<z.infer<typeof postSchema> | undefined> {
    const response = await ghostFetch(
      `${base}/posts/slug/${encodeURIComponent(slug)}/`,
      { method: "GET", headers: this.headers() },
      { timeoutMs: this.config.timeoutMs, allow: [404] }
    );
    if (response.status === 404) {
      return undefined;
    }

    const parsed = postsResponseSchema.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) {
      throw new GhostRequestError(
        "unexpected_response",
        "Ghost returned an invalid response when looking up the post by slug",
        response.status
      );
    }
    return parsed.data.posts.find((post) => post.slug === slug);
  }

  private failure(
    article: PublishArticle,
    code: string,
    message: string,
    details: Record<string, unknown>
  ): PublishResult {
    return {
      success: false,
      publisherId: this.id,
      publisherName: this.name,
      error: { code, message, details: { slug: article.slug, ...details } }
    };
  }
}
