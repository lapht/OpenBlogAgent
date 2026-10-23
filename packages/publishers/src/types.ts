import type { Identifier } from "@openblog/types";

export interface PublishArticle {
  title: string;
  slug: string;
  summary: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  category: string;
  author: string;
  language: string;
  /**
   * Whether the post goes live. Wins over the publisher's own configured status; absent means the
   * publisher's default (a draft for WordPress).
   */
  status?: "draft" | "publish";
  /**
   * The article is a revision of the draft this workflow already sent under this slug, so a target
   * that protects existing files may replace that draft.
   */
  revisesDraft?: boolean;
  target?: string;
  publisherId?: string;
  metadata?: Record<string, unknown>;
}

export interface PublisherValidationIssue {
  field: string;
  message: string;
}

export interface PublisherValidationResult {
  valid: boolean;
  issues: PublisherValidationIssue[];
}

export interface PublisherErrorData {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface PublishResult {
  success: boolean;
  publisherId: string;
  publisherName: string;
  outputPath?: string;
  metadata?: Record<string, unknown>;
  error?: PublisherErrorData;
}

/** A post that already exists on the target, found by slug. */
export interface ExistingPost {
  id?: string;
  url?: string;
}

export interface IPublisher {
  id: Identifier;
  name: string;
  validate(article: PublishArticle): Promise<PublisherValidationResult>;
  supports(article: PublishArticle): boolean;
  publish(article: PublishArticle): Promise<PublishResult>;
  /** Looks the article's slug up on the target without writing. Optional. */
  findExisting?(article: Pick<PublishArticle, "slug">): Promise<ExistingPost | null>;
}

export interface PublisherManagerConfig {
  defaultPublisherId?: string;
}

export interface IPublisherManager {
  register(publisher: IPublisher): void;
  publish(article: PublishArticle, options?: { publisherId?: string }): Promise<PublishResult>;
  /** Asks the selected publisher whether the slug is already published; null if it cannot tell. */
  findExisting?(
    article: Pick<PublishArticle, "slug">,
    options?: { publisherId?: string }
  ): Promise<ExistingPost | null>;
}
