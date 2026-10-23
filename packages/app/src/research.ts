import fs from "node:fs";
import path from "node:path";

import type { EnvSchema } from "@openblog/config";
import {
  collectTopicCandidates,
  parseSourcesFile,
  type ContentFetcher,
  type TopicCollection,
  type TopicSourceConfig
} from "@openblog/research";

import { createContentFetcherFromConfig } from "./fetcher";

/** Reads and validates the sources file; throws with the file name and every problem. */
export function loadResearchSources(file: string): TopicSourceConfig[] {
  const resolved = path.resolve(file);
  let content: string;
  try {
    content = fs.readFileSync(resolved, "utf8");
  } catch (error) {
    throw new Error(
      `Cannot read OPENBLOG_RESEARCH_SOURCES_FILE ${resolved}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  return parseSourcesFile(content, `OPENBLOG_RESEARCH_SOURCES_FILE ${resolved}`);
}

/**
 * Collects topic candidates from the configured sources. Needs no database or model: only the
 * sources file and the safe fetcher. A failing source is reported in the result, not thrown.
 */
export async function collectTopics(
  config: EnvSchema,
  fetcher: ContentFetcher = createContentFetcherFromConfig(config)
): Promise<TopicCollection> {
  if (!config.OPENBLOG_RESEARCH_SOURCES_FILE) {
    throw new Error("OPENBLOG_RESEARCH_SOURCES_FILE is not set; it lists the feeds and sitemaps");
  }
  return collectTopicCandidates(
    loadResearchSources(config.OPENBLOG_RESEARCH_SOURCES_FILE),
    fetcher
  );
}
