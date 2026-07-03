import type { IPublisher } from "@openblog/core";

export interface WordPressPublisherConfig {
  endpoint: string;
}

export interface IWordPressPublisher extends IPublisher {
  config: WordPressPublisherConfig;
}
