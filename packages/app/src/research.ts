import fs from "node:fs";
import path from "node:path";

import { createResearchAgent } from "@openblog/agents";
import type { EnvSchema } from "@openblog/config";
import type { LlmPort } from "@openblog/graph";
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
  type CandidateEnrichment,
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
  /** Present when `OPENBLOG_RESEARCH_ENRICH` is on: what asking the model for angles did. */
  enrichment?: EnrichOutcome;
}

/** What one round of enrichment did. */
export interface EnrichOutcome {
  enriched: CandidateRecord[];
  /** Candidates whose reply stayed invalid after the retries, or whose call failed. */
  failed: Array<{ id: string; title: string; error: string }>;
  /** Provider-reported cost of the round (USD) and its tokens. */
  costUsd: number;
  totalTokens: number;
  /** The round stopped before the end because `OPENBLOG_RESEARCH_MAX_COST` was reached. */
  stoppedByBudget: boolean;
}

/** The topic backlog: collect, score, store, and the human decisions on candidates. */
export interface ResearchService {
  collect(): Promise<CollectOutcome>;
  list(filter?: { status?: CandidateStatus; limit?: number }): CandidateRecord[];
  /** By id or unique prefix; throws `BacklogError` when unknown or ambiguous. */
  get(id: string): CandidateRecord;
  /**
   * Accepts a candidate, with the brief fields (all but the topic) its run should use. With
   * `useEnrichment` the proposed keyword and angle become brief fields (explicit ones win).
   */
  accept(
    id: string,
    decision: { by: string; brief?: unknown; useEnrichment?: boolean }
  ): CandidateRecord;
  /** Asks the model for an angle, working title, keyword and motivation. Replaces an earlier proposal. */
  enrich(id: string): Promise<CandidateRecord>;
  /** Enriches the best `new` candidates that have no proposal yet, within `OPENBLOG_RESEARCH_MAX_COST`. */
  enrichTop(limit: number): Promise<EnrichOutcome>;
  drop(id: string, decision: { by: string; reason?: string }): CandidateRecord;
  /** Records the run started from the candidate. */
  markUsed(id: string, workflowId: string): CandidateRecord;
}

export interface ResearchServiceOptions {
  config: EnvSchema;
  backlog: TopicBacklogStore;
  /** Replaces the safe fetcher built from `OPENBLOG_FETCH_*` (tests). */
  fetcher?: ContentFetcher;
  /** The model, for enrichment only. Without it `enrich` is refused. */
  llm?: LlmPort;
  /** The clock for scoring and decisions (tests). */
  clock?: () => Date;
}

/** The proposal as the brief fields it stands for: the keyword and, as notes, the working title and angle. */
function briefFromEnrichment(enrichment: CandidateEnrichment): Record<string, unknown> {
  return {
    targetKeyword: enrichment.targetKeyword,
    notes: `Working title: ${enrichment.workingTitle}. Angle: ${enrichment.angle}`
  };
}

export function createResearchService(options: ResearchServiceOptions): ResearchService {
  const { config, backlog } = options;
  const clock = options.clock ?? (() => new Date());

  /** One proposal for one candidate, with the usage its calls reported. */
  async function propose(candidate: CandidateRecord): Promise<CandidateRecord> {
    if (!options.llm) {
      throw new ResearchError("llm_unavailable", "Enrichment needs a text generation provider");
    }
    const usage = { calls: 0, totalTokens: 0, costUsd: 0 };
    let model: string | null = null;
    const llm = options.llm;
    const metered: LlmPort = {
      id: llm.id,
      async generate(request) {
        const result = await llm.generate({
          ...request,
          ...(config.OPENBLOG_MODEL_RESEARCH ? { model: config.OPENBLOG_MODEL_RESEARCH } : {})
        });
        usage.calls += 1;
        usage.totalTokens += result.usage?.totalTokens ?? 0;
        usage.costUsd += result.usage?.cost ?? 0;
        model = result.model;
        return result;
      }
    };
    const idea = await createResearchAgent(metered).run({
      title: candidate.title,
      summary: candidate.summary ?? undefined,
      source: candidate.source,
      language: config.OPENBLOG_CONTENT_LANGUAGE
    });
    return backlog.setEnrichment(candidate.id, {
      ...idea,
      model,
      generatedAt: clock().toISOString(),
      usage
    });
  }

  async function enrichRound(candidates: CandidateRecord[]): Promise<EnrichOutcome> {
    const outcome: EnrichOutcome = {
      enriched: [],
      failed: [],
      costUsd: 0,
      totalTokens: 0,
      stoppedByBudget: false
    };
    const max = config.OPENBLOG_RESEARCH_MAX_COST;
    for (const candidate of candidates) {
      if (max !== undefined && outcome.costUsd >= max) {
        outcome.stoppedByBudget = true;
        break;
      }
      try {
        const record = await propose(candidate);
        outcome.enriched.push(record);
        outcome.costUsd += record.enrichment?.usage.costUsd ?? 0;
        outcome.totalTokens += record.enrichment?.usage.totalTokens ?? 0;
      } catch (error) {
        outcome.failed.push({
          id: candidate.id,
          title: candidate.title,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    return outcome;
  }

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

      let enrichment: EnrichOutcome | undefined;
      if (config.OPENBLOG_RESEARCH_ENRICH && options.llm) {
        // Only the candidates this collection added, best first: older ones are enriched on demand.
        const fresh = stored.created
          .filter((record) => record.status === "new")
          .sort((a, b) => b.score - a.score)
          .slice(0, config.OPENBLOG_RESEARCH_ENRICH_LIMIT);
        enrichment = await enrichRound(fresh);
        for (const record of enrichment.enriched) {
          const at = candidates.findIndex((entry) => entry.id === record.id);
          if (at >= 0) candidates[at] = { ...record, outcome: candidates[at]!.outcome };
        }
      }

      return {
        sources: collection.sources,
        candidates,
        ...(enrichment ? { enrichment } : {}),
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

    async enrich(id) {
      return propose(backlog.get(id));
    },

    async enrichTop(limit) {
      const waiting = backlog
        .list({ status: "new", limit: 500 })
        .filter((record) => record.enrichment === null)
        .slice(0, limit);
      return enrichRound(waiting);
    },

    accept(id, decision) {
      let brief: Record<string, unknown> | undefined;
      if (decision.useEnrichment) {
        const { enrichment } = backlog.get(id);
        if (!enrichment) {
          throw new BacklogError(
            "invalid_input",
            "This candidate has no proposal yet; run enrich first"
          );
        }
        decision = {
          ...decision,
          brief: { ...briefFromEnrichment(enrichment), ...(decision.brief as object) }
        };
      }
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
