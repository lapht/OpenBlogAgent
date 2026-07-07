import type { ILogger } from "@openblog/logger";

import { GhostPublisher, type GhostPublisherConfig } from "./ghost";
import { MarkdownPublisher, type MarkdownPublisherConfig } from "./markdown";
import { WordPressPublisher, type WordPressPublisherConfig } from "./wordpress";
import type { IPublisher } from "./types";

export interface PublisherFactoryConfig {
  markdown?: MarkdownPublisherConfig;
  wordpress?: WordPressPublisherConfig;
  ghost?: GhostPublisherConfig;
  defaultPublisherId?: string;
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
    publishers.push(new WordPressPublisher(config.wordpress, logger));
  }

  if (config.ghost) {
    publishers.push(new GhostPublisher(config.ghost, logger));
  }

  return publishers;
}
