import type { IPublisher } from "@openblog/core";

export interface GhostPublisherConfig {
  endpoint: string;
}

export interface IGhostPublisher extends IPublisher {
  config: GhostPublisherConfig;
}
