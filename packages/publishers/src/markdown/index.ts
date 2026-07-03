import type { IPublisher } from "@openblog/core";

export interface MarkdownPublisherConfig {
  outputDir: string;
}

export interface IMarkdownPublisher extends IPublisher {
  config: MarkdownPublisherConfig;
}
