import type { ContentFetcher } from "../types";

export type TopicSourceType = "feed" | "sitemap";

/** A configured place topics come from (one entry of the sources file). */
export interface TopicSourceConfig {
  name: string;
  type: TopicSourceType;
  url: string;
  /** How much the source counts when candidates are ranked later. */
  weight: number;
  /** Keep only entries mentioning at least one of these (title, summary, URL); empty: keep all. */
  include: string[];
  /** Drop entries mentioning any of these. */
  exclude: string[];
}

/** A possible article topic found in a source. */
export interface TopicCandidate {
  title: string;
  /** Canonical URL of the page the candidate comes from. */
  url: string;
  /** Name of the source it came from; the heaviest one when several listed it. */
  source: string;
  weight: number;
  /** ISO 8601; the entry's published date, or the sitemap's lastmod. */
  publishedAt?: string;
  summary?: string;
}

/** What a source produced: entries, plus non-fatal problems (a child sitemap that failed). */
export interface TopicSourceResult {
  entries: Omit<TopicCandidate, "source" | "weight">[];
  warnings: string[];
}

/** Reads one configured source through the fetcher and returns its entries. */
export interface TopicSource {
  readonly config: TopicSourceConfig;
  collect(fetcher: ContentFetcher): Promise<TopicSourceResult>;
}

/** Result of one source in a collection; a failing source is reported here, never thrown. */
export interface SourceReport {
  name: string;
  type: TopicSourceType;
  url: string;
  status: "ok" | "failed";
  /** Entries kept from this source (after include/exclude), before the merge across sources. */
  count: number;
  /** Stable code (`fetch_blocked`, `invalid_feed`...) and message when the source failed. */
  error?: { code: string; message: string };
  warnings: string[];
}

export interface TopicCollection {
  candidates: TopicCandidate[];
  sources: SourceReport[];
}

/** The source cannot be read as what its configuration says (not XML, not a feed, not a sitemap). */
export class SourceFormatError extends Error {
  public readonly code = "invalid_feed";

  constructor(message: string) {
    super(message);
    this.name = "SourceFormatError";
  }
}

export type ResearchErrorCode = "sources_not_configured" | "backlog_unavailable";

/** The research feature cannot run with the current setup. */
export class ResearchError extends Error {
  readonly code: ResearchErrorCode;

  constructor(code: ResearchErrorCode, message: string) {
    super(message);
    this.name = "ResearchError";
    this.code = code;
  }
}
