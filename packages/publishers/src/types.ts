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

export interface IPublisher {
  id: Identifier;
  name: string;
  validate(article: PublishArticle): Promise<PublisherValidationResult>;
  supports(article: PublishArticle): boolean;
  publish(article: PublishArticle): Promise<PublishResult>;
}

export interface PublisherManagerConfig {
  defaultPublisherId?: string;
}

export interface IPublisherManager {
  register(publisher: IPublisher): void;
  publish(article: PublishArticle, options?: { publisherId?: string }): Promise<PublishResult>;
}
