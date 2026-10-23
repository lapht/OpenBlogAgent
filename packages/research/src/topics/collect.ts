import { logger } from "@openblog/logger";
import { normalizeTopic } from "@openblog/types";

import { FetchError, type ContentFetcher } from "../types";

import { FeedTopicSource } from "./feed";
import { SitemapTopicSource } from "./sitemap";
import { urlKey } from "./text";
import type {
  SourceReport,
  TopicCandidate,
  TopicCollection,
  TopicSource,
  TopicSourceConfig
} from "./types";

export function createTopicSource(config: TopicSourceConfig): TopicSource {
  return config.type === "sitemap" ? new SitemapTopicSource(config) : new FeedTopicSource(config);
}

function matches(candidate: { title: string; url: string; summary?: string }, words: string[]) {
  const text = `${candidate.title} ${candidate.summary ?? ""} ${candidate.url}`.toLowerCase();
  return words.some((word) => text.includes(word.toLowerCase()));
}

function describeError(error: unknown): { code: string; message: string } {
  if (error instanceof FetchError) {
    return { code: error.code, message: error.message };
  }
  const code =
    error instanceof Error && "code" in error && typeof error.code === "string"
      ? error.code
      : "source_error";
  return { code, message: error instanceof Error ? error.message : String(error) };
}

/**
 * Candidates from every source, deterministically: no model is involved. A source that fails is
 * reported in `sources` and never aborts the others. Entries that share a URL (canonicalized) or a
 * normalized title collapse into one, kept from the heaviest source, newest first.
 */
export async function collectTopicCandidates(
  configs: TopicSourceConfig[],
  fetcher: ContentFetcher
): Promise<TopicCollection> {
  const results = await Promise.all(
    configs.map(async (config) => {
      const report: SourceReport = {
        name: config.name,
        type: config.type,
        url: config.url,
        status: "ok",
        count: 0,
        warnings: []
      };
      let kept: TopicCandidate[] = [];
      try {
        const result = await createTopicSource(config).collect(fetcher);
        kept = result.entries
          .filter(
            (entry) =>
              (config.include.length === 0 || matches(entry, config.include)) &&
              !matches(entry, config.exclude)
          )
          .map((entry) => ({ ...entry, source: config.name, weight: config.weight }));
        report.count = kept.length;
        report.warnings = result.warnings;
        logger.info("Topic source collected", { source: config.name, count: kept.length });
      } catch (error) {
        report.status = "failed";
        report.error = describeError(error);
        logger.warn("Topic source failed", {
          source: config.name,
          code: report.error.code,
          error: report.error.message
        });
      }
      return { report, kept };
    })
  );

  const merged: TopicCandidate[] = [];
  const byUrl = new Map<string, TopicCandidate>();
  const byTitle = new Map<string, TopicCandidate>();

  for (const candidate of results.flatMap((result) => result.kept)) {
    const key = urlKey(candidate.url);
    const titleKey = normalizeTopic(candidate.title);
    const existing = (key ? byUrl.get(key) : undefined) ?? byTitle.get(titleKey);

    if (!existing) {
      merged.push(candidate);
      if (key) byUrl.set(key, candidate);
      byTitle.set(titleKey, candidate);
      continue;
    }

    // Keep the heavier source's entry (the first on a tie) and fill what it lacks from the other.
    const winner = candidate.weight > existing.weight ? candidate : existing;
    const loser = winner === existing ? candidate : existing;
    winner.publishedAt ??= loser.publishedAt;
    winner.summary ??= loser.summary;
    if (winner !== existing) {
      merged[merged.indexOf(existing)] = winner;
    }
    for (const alias of [key, urlKey(existing.url)]) {
      if (alias) byUrl.set(alias, winner);
    }
    byTitle.set(titleKey, winner);
    byTitle.set(normalizeTopic(existing.title), winner);
  }

  merged.sort((a, b) => {
    if (a.publishedAt === b.publishedAt) return b.weight - a.weight;
    if (!a.publishedAt) return 1;
    if (!b.publishedAt) return -1;
    return a.publishedAt < b.publishedAt ? 1 : -1;
  });

  return { candidates: merged, sources: results.map((result) => result.report) };
}
