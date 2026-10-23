import { normalizeTopic } from "@openblog/types";

import type { TopicCandidate } from "./types";

/** An article already published or parked; a candidate must not repeat it. */
export interface CoveredTopic {
  topic: string;
  title?: string | null;
}

export interface ScoreContext {
  /** The clock; scoring never reads the real time. */
  now: Date;
  covered: CoveredTopic[];
  /** The source's own `include` keywords: each one found adds points. */
  include?: string[];
  /** The source's `exclude` keywords: each one found takes points away. */
  exclude?: string[];
}

export interface ScoreBreakdown extends Record<string, number> {
  recency: number;
  source: number;
  keywords: number;
  /** Zero or negative: how much a similar article already covered takes off. */
  overlap: number;
}

export interface CandidateScore {
  /** 0 to 100: the sum of the breakdown, clamped. */
  score: number;
  breakdown: ScoreBreakdown;
  /** The factors in words, stored next to the score. */
  motivation: string;
  /** Set when the candidate repeats an article that already exists: it is not worth storing. */
  covered?: { by: string; reason: "same_title" };
}

/** Points for a candidate published today, falling to zero at `RECENCY_DAYS` days. */
export const RECENCY_MAX = 40;
export const RECENCY_DAYS = 30;
/** Points for an entry without a date. */
export const UNDATED_RECENCY = 10;
/** Points for a source of weight 2 or more; the default weight 1 earns half. */
export const SOURCE_MAX = 30;
export const KEYWORD_POINTS = 10;
export const KEYWORD_MAX = 20;
export const EXCLUDE_POINTS = 20;
export const EXCLUDE_MAX = 40;
/** Token overlap (Jaccard) from which a similar article takes points off. */
export const OVERLAP_THRESHOLD = 0.4;
export const OVERLAP_PENALTY = 60;

const DAY_MS = 86_400_000;

const STOPWORDS = new Set(
  (
    "the and for with from that this these those your you our are was were will can how what why when " +
    "who which into over about than then also not but all any more most per via vs " +
    "il lo la le gli un una uno dei del della delle degli per con come che cosa perche nel nella " +
    "sono non piu"
  ).split(" ")
);

/** The significant words of a title: lowercase letters and digits, no short or filler words. */
export function titleTokens(title: string): Set<string> {
  const tokens = normalizeTopic(title)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
  return new Set(tokens);
}

/** Share of words two titles have in common (Jaccard); 0 when either has fewer than two. */
export function tokenOverlap(a: string, b: string): number {
  const left = titleTokens(a);
  const right = titleTokens(b);
  if (left.size < 2 || right.size < 2) {
    return 0;
  }
  let shared = 0;
  for (const token of left) {
    if (right.has(token)) shared += 1;
  }
  return shared / (left.size + right.size - shared);
}

const keywordHits = (text: string, keywords: string[]): string[] =>
  keywords.filter((keyword) => text.includes(keyword.toLowerCase()));

/**
 * Scores a candidate from facts alone, so the same inputs always give the same score: how recent
 * it is, how much its source counts, which of the source's keywords it matches, and how much it
 * overlaps with what is already published or parked. A title identical to an existing article is
 * flagged as `covered` instead of scored.
 */
export function scoreCandidate(candidate: TopicCandidate, context: ScoreContext): CandidateScore {
  const titleKey = normalizeTopic(candidate.title);
  const known = context.covered.flatMap((entry) => [entry.topic, entry.title ?? ""]);

  const identical = known.find((title) => title && normalizeTopic(title) === titleKey);
  if (identical) {
    return {
      score: 0,
      breakdown: { recency: 0, source: 0, keywords: 0, overlap: 0 },
      motivation: `already covered by "${identical}"`,
      covered: { by: identical, reason: "same_title" }
    };
  }

  const reasons: string[] = [];

  let recency = UNDATED_RECENCY;
  if (candidate.publishedAt) {
    const ageDays = Math.max(
      0,
      (context.now.getTime() - Date.parse(candidate.publishedAt)) / DAY_MS
    );
    recency = Math.round(RECENCY_MAX * Math.max(0, 1 - ageDays / RECENCY_DAYS));
    reasons.push(ageDays < 1 ? "published today" : `published ${Math.floor(ageDays)} days ago`);
  } else {
    reasons.push("undated");
  }

  const source = Math.round((SOURCE_MAX * Math.min(Math.max(candidate.weight, 0), 2)) / 2);
  reasons.push(`source weight ${candidate.weight}`);

  const haystack = `${candidate.title} ${candidate.summary ?? ""} ${candidate.url}`.toLowerCase();
  const included = keywordHits(haystack, context.include ?? []);
  const excluded = keywordHits(haystack, context.exclude ?? []);
  const keywords =
    Math.min(included.length * KEYWORD_POINTS, KEYWORD_MAX) -
    Math.min(excluded.length * EXCLUDE_POINTS, EXCLUDE_MAX);
  if (included.length > 0) reasons.push(`matches ${included.map((k) => `"${k}"`).join(", ")}`);
  if (excluded.length > 0)
    reasons.push(`mentions excluded ${excluded.map((k) => `"${k}"`).join(", ")}`);

  let overlap = 0;
  let closest: { title: string; ratio: number } | undefined;
  for (const title of known) {
    if (!title) continue;
    const ratio = tokenOverlap(candidate.title, title);
    if (!closest || ratio > closest.ratio) closest = { title, ratio };
  }
  if (closest && closest.ratio >= OVERLAP_THRESHOLD) {
    overlap = -Math.round(OVERLAP_PENALTY * closest.ratio);
    reasons.push(`similar to "${closest.title}" (${closest.ratio.toFixed(2)})`);
  }

  const score = Math.max(0, Math.min(100, recency + source + keywords + overlap));
  return {
    score,
    breakdown: { recency, source, keywords, overlap },
    motivation: reasons.join("; ")
  };
}
