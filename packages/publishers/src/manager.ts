import type { ILogger } from "@openblog/logger";

import type { IPublisher, IPublisherManager, PublisherManagerConfig, PublishArticle, PublishResult } from "./types";

export class DefaultPublisherManager implements IPublisherManager {
  private readonly publishers = new Map<string, IPublisher>();

  constructor(
    private readonly logger: ILogger,
    publishers: IPublisher[] = [],
    private readonly config: PublisherManagerConfig = {}
  ) {
    for (const publisher of publishers) {
      this.register(publisher);
    }
  }

  register(publisher: IPublisher): void {
    this.publishers.set(publisher.id, publisher);
  }

  async publish(article: PublishArticle, options?: { publisherId?: string }): Promise<PublishResult> {
    const requestedPublisherId = options?.publisherId ?? article.publisherId ?? this.config.defaultPublisherId;

    const publisher = this.resolvePublisher(article, requestedPublisherId);

    if (!publisher) {
      return this.failure("missing_publisher", "No publisher was selected", {
        requestedPublisherId,
        slug: article.slug
      });
    }

    const publisherId = publisher.id;

    this.logger.info("Publishing article", {
      publisherId,
      slug: article.slug,
      title: article.title
    });

    const validation = await publisher.validate(article);

    if (!validation.valid) {
      this.logger.error("Publisher validation failed", {
        publisherId,
        slug: article.slug,
        issues: validation.issues
      });

      return {
        success: false,
        publisherId,
        publisherName: publisher.name,
        error: {
          code: "validation_failed",
          message: "Publisher validation failed",
          details: { issues: validation.issues }
        }
      };
    }

    try {
      const result = await publisher.publish(article);
      this.logger.info("Publishing completed", {
        publisherId,
        slug: article.slug,
        success: result.success
      });

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown publishing error";
      this.logger.error("Publishing failed", {
        publisherId,
        slug: article.slug,
        error: message
      });

      return {
        success: false,
        publisherId,
        publisherName: publisher.name,
        error: {
          code: "publish_failed",
          message,
          details: { slug: article.slug }
        }
      };
    }
  }

  private resolvePublisher(article: PublishArticle, preferredPublisherId?: string): IPublisher | undefined {
    if (preferredPublisherId) {
      const explicitPublisher = this.publishers.get(preferredPublisherId);
      if (explicitPublisher) {
        return explicitPublisher;
      }
    }

    const candidates = Array.from(this.publishers.values());
    const matchingPublisher = candidates.find((publisher) => publisher.supports(article));

    if (matchingPublisher) {
      return matchingPublisher;
    }

    return preferredPublisherId ? this.publishers.get(preferredPublisherId) : undefined;
  }

  private failure(code: string, message: string, details: Record<string, unknown>): PublishResult {
    return {
      success: false,
      publisherId: this.config.defaultPublisherId ?? "",
      publisherName: "publisher-manager",
      error: {
        code,
        message,
        details
      }
    };
  }
}
