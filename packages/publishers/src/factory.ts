import type { ILogger } from "@openblog/logger";

import { GhostPublisher, type GhostPublisherConfig } from "./ghost";
import { MarkdownPublisher, type MarkdownPublisherConfig } from "./markdown";
import { WordPressPublisher, type WordPressPublisherConfig } from "./wordpress";
import type { IPublisher } from "./types";

import { WordPressCategoryProvider, WordPressTagProvider } from "./taxonomy/providers/wordpress-taxonomy-provider";
//import { StaticCategoryProvider, StaticTagProvider } from "./taxonomy/providers/static-taxonomy-provider";
import type { TaxonomyProviderConfig } from "./taxonomy/types";

export interface PublisherFactoryConfig {
  markdown?: MarkdownPublisherConfig;
  wordpress?: WordPressPublisherConfig;
  ghost?: GhostPublisherConfig;
  defaultPublisherId?: string;
  taxonomy?: TaxonomyProviderConfig;
}

export function createPublishersFromConfig(
  config: PublisherFactoryConfig,
  logger: ILogger
): IPublisher[] {
  const publishers: IPublisher[] = [];

  if (config.markdown) {
    publishers.push(new MarkdownPublisher(config.markdown, logger));
  }

  if (config.wordpress) {
    const taxonomyConfig: TaxonomyProviderConfig = {
      allowCreate: config.taxonomy?.allowCreate || false,
      defaultCategory: config.taxonomy?.defaultCategory || "Uncategorized",
      maxTags: config.taxonomy?.maxTags || 5,
      cacheTtlSeconds: config.taxonomy?.cacheTtlSeconds || 300
    };

    const categoryProvider = new WordPressCategoryProvider({
      endpoint: config.wordpress.endpoint,
      username: config.wordpress.username,
      applicationPassword: config.wordpress.applicationPassword,
      password: config.wordpress.password,
      logger,
      config: taxonomyConfig
    });

    const tagProvider = new WordPressTagProvider({
      endpoint: config.wordpress.endpoint,
      username: config.wordpress.username,
      applicationPassword: config.wordpress.applicationPassword,
      password: config.wordpress.password,
      logger,
      config: taxonomyConfig
    });

    publishers.push(new WordPressPublisher(config.wordpress, logger, categoryProvider, tagProvider));
  }

  if (config.ghost) {
    publishers.push(new GhostPublisher(config.ghost, logger));
  }

  return publishers;
}
