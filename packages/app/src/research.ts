import fs from "node:fs";
import path from "node:path";

import type { EnvSchema } from "@openblog/config";
import {
  collectTopicCandidates,
  parseSourcesFile,
  ResearchError,
  scoreCandidate,
  SourcesConfigError,
  urlKey,
  type ContentFetcher,
  type SourceReport,
  type TopicSourceConfig
} from "@openblog/research";
import {
  BacklogError,
  type CandidateRecord,
  type CandidateStatus,
  type TopicBacklogStore
} from "@openblog/storage";
import { candidateBriefSchema, formatBriefIssues } from "@openblog/types";

import { createContentFetcherFromConfig } from "./fetcher";

/** Reads and validates the sources file; throws with the file name and every problem. */
export function loadResearchSources(file: string): TopicSourceConfig[] {
  const resolved = path.resolve(file);
  let content: string;
  try {
    content = fs.readFileSync(resolved, "utf8");
  } catch (error) {
    throw new SourcesConfigError(
      `Cannot read OPENBLOG_RESEARCH_SOURCES_FILE ${resolved}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  return parseSourcesFile(content, `OPENBLOG_RESEARCH_SOURCES_FILE ${resolved}`);
}

/** A candidate of one collection and what storing it did. */
export type CollectedCandidate = CandidateRecord & {
  outcome: "created" | "refreshed" | "unchanged";
};

export interface CollectOutcome {
  sources: SourceReport[];
  /** Every candidate of this collection that is in the backlog, best score first. */
  candidates: CollectedCandidate[];
  /** Candidates that repeat an article already published or parked: not stored. */
  skipped: Array<{ title: string; url: string; coveredBy: string }>;
  counts: {
    created: number;
    refreshed: number;
    unchanged: number;
    skipped: number;
    /** Of the created or refreshed ones, how many `OPENBLOG_RESEARCH_AUTO_ACCEPT_MIN_SCORE` accepted. */
    autoAccepted: number;
  };
}

/** The topic backlog: collect, score, store, and the human decisions on candidates. */
export interface ResearchService {
  collect(): Promise<CollectOutcome>;
  list(filter?: { status?: CandidateStatus; limit?: number }): CandidateRecord[];
  /** By id or unique prefix; throws `BacklogError` when unknown or ambiguous. */
  get(id: string): CandidateRecord;
  /** Accepts a candidate, with the brief fields (all but the topic) its run should use. */
  accept(id: string, decision: { by: string; brief?: unknown }): CandidateRecord;
  drop(id: string, decision: { by: string; reason?: string }): CandidateRecord;
  /** Records the run started from the candidate. */
  markUsed(id: string, workflowId: string): CandidateRecord;
}

export interface ResearchServiceOptions {
  config: EnvSchema;
  backlog: TopicBacklogStore;
  /** Replaces the safe fetcher built from `OPENBLOG_FETCH_*` (tests). */
  fetcher?: ContentFetcher;
  /** The clock for scoring and decisions (tests). */
  clock?: () => Date;
}

export function createResearchService(options: ResearchServiceOptions): ResearchService {
  const { config, backlog } = options;
  const clock = options.clock ?? (() => new Date());

  return {
    async collect(): Promise<CollectOutcome> {
      if (!config.OPENBLOG_RESEARCH_SOURCES_FILE) {
        throw new ResearchError(
          "sources_not_configured",
          "OPENBLOG_RESEARCH_SOURCES_FILE is not set; it lists the feeds and sitemaps"
        );
      }
      const sources = loadResearchSources(config.OPENBLOG_RESEARCH_SOURCES_FILE);
      const fetcher = options.fetcher ?? createContentFetcherFromConfig(config);
      const collection = await collectTopicCandidates(sources, fetcher);

      const now = clock();
      const covered = backlog.listCovered();
      const skipped: CollectOutcome["skipped"] = [];
      const scored = [];
      for (const candidate of collection.candidates) {
        const settings = sources.find((source) => source.name === candidate.source);
        const result = scoreCandidate(candidate, {
          now,
          covered,
          include: settings?.include,
          exclude: settings?.exclude
        });
        const key = urlKey(candidate.url);
        if (result.covered) {
          skipped.push({
            title: candidate.title,
            url: candidate.url,
            coveredBy: result.covered.by
          });
        } else if (key) {
          scored.push({
            title: candidate.title,
            url: candidate.url,
            urlKey: key,
            source: candidate.source,
            summary: candidate.summary,
            publishedAt: candidate.publishedAt,
            score: result.score,
            breakdown: result.breakdown,
            motivation: result.motivation
          });
        }
      }

      const stored = backlog.upsertCollected(scored, {
        now,
        autoAcceptMinScore: config.OPENBLOG_RESEARCH_AUTO_ACCEPT_MIN_SCORE
      });
      const candidates: CollectedCandidate[] = [
        ...stored.created.map((record) => ({ ...record, outcome: "created" as const })),
        ...stored.refreshed.map((record) => ({ ...record, outcome: "refreshed" as const })),
        ...stored.unchanged.map((record) => ({ ...record, outcome: "unchanged" as const }))
      ].sort((a, b) => b.score - a.score);

      return {
        sources: collection.sources,
        candidates,
        skipped,
        counts: {
          created: stored.created.length,
          refreshed: stored.refreshed.length,
          unchanged: stored.unchanged.length,
          skipped: skipped.length,
          autoAccepted: [...stored.created, ...stored.refreshed].filter(
            (record) => record.status === "accepted" && record.decidedBy === "auto"
          ).length
        }
      };
    },

    list: (filter) => backlog.list(filter),
    get: (id) => backlog.get(id),

    accept(id, decision) {
      let brief: Record<string, unknown> | undefined;
      if (decision.brief !== undefined) {
        const parsed = candidateBriefSchema.safeParse(decision.brief);
        if (!parsed.success) {
          throw new BacklogError(
            "invalid_input",
            `Invalid brief: ${formatBriefIssues(parsed.error)}`
          );
        }
        brief = parsed.data;
      }
      return backlog.accept(id, { by: decision.by, brief, now: clock() });
    },

    drop: (id, decision) => backlog.drop(id, { ...decision, now: clock() }),
    markUsed: (id, workflowId) => backlog.markUsed(id, workflowId, clock())
  };
}
