import type { ILogger } from "@openblog/logger";

import { GhostPublisher, type GhostPublisherConfig } from "./ghost";
import { MarkdownPublisher, type MarkdownPublisherConfig } from "./markdown";
import { WordPressPublisher, type WordPressPublisherConfig } from "./wordpress";
import type { IPublisher } from "./types";

import {
  WordPressCategoryProvider,
  WordPressTagProvider
} from "./taxonomy/providers/wordpress-taxonomy-provider";
import type { ICategoryProvider, ITagProvider, TaxonomyProviderConfig } from "./taxonomy/types";

export interface PublisherFactoryConfig {
  markdown?: MarkdownPublisherConfig;
  wordpress?: WordPressPublisherConfig;
  ghost?: GhostPublisherConfig;
  defaultPublisherId?: string;
  taxonomy?: TaxonomyProviderConfig;
  /** Providers the WordPress publisher uses to resolve names to ids. Built from `wordpress` when omitted. */
  wordpressTaxonomy?: { categoryProvider: ICategoryProvider; tagProvider: ITagProvider };
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
    const { categoryProvider, tagProvider } =
      config.wordpressTaxonomy ?? createWordPressTaxonomyProviders(config, logger);

    publishers.push(
      new WordPressPublisher(config.wordpress, logger, categoryProvider, tagProvider)
    );
  }

  if (config.ghost) {
    publishers.push(new GhostPublisher(config.ghost, logger));
  }

  return publishers;
}

function createWordPressTaxonomyProviders(
  config: PublisherFactoryConfig & { wordpress?: WordPressPublisherConfig },
  logger: ILogger
): { categoryProvider: ICategoryProvider; tagProvider: ITagProvider } {
  const wordpress = config.wordpress as WordPressPublisherConfig;
  const taxonomyConfig: TaxonomyProviderConfig = {
    allowCreate: config.taxonomy?.allowCreate || false,
    defaultCategory: config.taxonomy?.defaultCategory || "Uncategorized",
    maxTags: config.taxonomy?.maxTags || 5,
    cacheTtlSeconds: config.taxonomy?.cacheTtlSeconds || 300
  };
  const options = {
    endpoint: wordpress.endpoint,
    username: wordpress.username,
    applicationPassword: wordpress.applicationPassword,
    logger,
    config: taxonomyConfig
  };

  return {
    categoryProvider: new WordPressCategoryProvider(options),
    tagProvider: new WordPressTagProvider(options)
  };
}
