import { randomUUID } from "node:crypto";

import type { Database } from "better-sqlite3";
import { normalizeTopic } from "@openblog/types";

/**
 * `new`: collected, waiting for a human. `accepted`: approved for generation (by a person, or by
 * the auto-accept score). `dropped`: rejected, kept so it is not offered again. `used`: a run was
 * started from it.
 */
export type CandidateStatus = "new" | "accepted" | "dropped" | "used";

export const CANDIDATE_STATUSES: readonly CandidateStatus[] = [
  "new",
  "accepted",
  "dropped",
  "used"
];

/** What the model proposed for a candidate, with what producing it used. Informative: the score ignores it. */
export interface CandidateEnrichment {
  angle: string;
  workingTitle: string;
  targetKeyword: string;
  motivation: string;
  model: string | null;
  generatedAt: string;
  usage: { calls: number; totalTokens: number; costUsd: number };
}

export interface CandidateRecord {
  id: string;
  title: string;
  url: string;
  source: string;
  summary: string | null;
  publishedAt: string | null;
  collectedAt: string;
  score: number;
  /** Points each factor contributed; their sum, clamped to 0-100, is the score. */
  breakdown: Record<string, number>;
  motivation: string;
  status: CandidateStatus;
  /** Brief fields (everything but the topic) set when the candidate was accepted. */
  brief: Record<string, unknown> | null;
  /** Who decided: a person, or `auto` for the auto-accept score. */
  decidedBy: string | null;
  decisionNote: string | null;
  decidedAt: string | null;
  workflowId: string | null;
  /** The proposed angle, once enriched; null before. */
  enrichment: CandidateEnrichment | null;
  createdAt: string;
  updatedAt: string;
}

/** A scored candidate ready to be stored. */
export interface CandidateInput {
  title: string;
  url: string;
  /** Canonical identity of the URL; two candidates with the same key are the same article. */
  urlKey: string;
  source: string;
  summary?: string;
  publishedAt?: string;
  score: number;
  breakdown: Record<string, number>;
  motivation: string;
}

export interface UpsertOutcome {
  /** Stored as new rows. */
  created: CandidateRecord[];
  /** Already `new`: score, breakdown and motivation were recomputed. */
  refreshed: CandidateRecord[];
  /** Already decided (accepted, dropped, used): left untouched. */
  unchanged: CandidateRecord[];
}

export type BacklogErrorCode = "not_found" | "ambiguous_id" | "invalid_state" | "invalid_input";

/** Thrown when a decision on a candidate cannot be applied; nothing changes. */
export class BacklogError extends Error {
  readonly code: BacklogErrorCode;

  constructor(code: BacklogErrorCode, message: string) {
    super(message);
    this.name = "BacklogError";
    this.code = code;
  }
}

/** A published or parked article, by the topic it was run for and the title it ended with. */
export interface CoveredArticle {
  workflowId: string;
  topic: string;
  title: string | null;
}

interface CandidateRow {
  id: string;
  title: string;
  url: string;
  source: string;
  summary: string | null;
  published_at: string | null;
  collected_at: string;
  score: number;
  score_breakdown_json: string;
  motivation: string;
  status: CandidateStatus;
  brief_json: string | null;
  decided_by: string | null;
  decision_note: string | null;
  decided_at: string | null;
  workflow_id: string | null;
  enrichment_json: string | null;
  created_at: string;
  updated_at: string;
}

const MIN_ID_PREFIX = 4;

/** The persistent backlog of topic candidates (`topic_candidates`). */
export class TopicBacklogStore {
  constructor(private readonly db: Database) {}

  /**
   * Stores collected candidates. Idempotent: a candidate whose URL or normalized title is already
   * stored is not duplicated. If it is still `new` its score is refreshed; a decided one is left
   * alone. With `autoAcceptMinScore`, new candidates scoring at least that are accepted as `auto`.
   */
  upsertCollected(
    inputs: CandidateInput[],
    options: { now?: Date; autoAcceptMinScore?: number } = {}
  ): UpsertOutcome {
    const now = (options.now ?? new Date()).toISOString();
    const outcome: UpsertOutcome = { created: [], refreshed: [], unchanged: [] };

    this.db
      .transaction(() => {
        for (const input of inputs) {
          const titleKey = normalizeTopic(input.title);
          const existing =
            (this.db
              .prepare("SELECT * FROM topic_candidates WHERE url_key = ?")
              .get(input.urlKey) as CandidateRow | undefined) ??
            (this.db
              .prepare("SELECT * FROM topic_candidates WHERE title_normalized = ?")
              .get(titleKey) as CandidateRow | undefined);
          const auto =
            options.autoAcceptMinScore !== undefined && input.score >= options.autoAcceptMinScore;

          if (!existing) {
            const id = randomUUID();
            this.db
              .prepare(
                `INSERT INTO topic_candidates
                 (id, title, title_normalized, url, url_key, source, summary, published_at,
                  collected_at, score, score_breakdown_json, motivation, status,
                  decided_by, decision_note, decided_at, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              )
              .run(
                id,
                input.title,
                titleKey,
                input.url,
                input.urlKey,
                input.source,
                input.summary ?? null,
                input.publishedAt ?? null,
                now,
                input.score,
                JSON.stringify(input.breakdown),
                input.motivation,
                auto ? "accepted" : "new",
                auto ? "auto" : null,
                auto ? `score ${input.score} reached the auto-accept threshold` : null,
                auto ? now : null,
                now,
                now
              );
            outcome.created.push(this.mustGet(id));
          } else if (existing.status === "new") {
            this.db
              .prepare(
                `UPDATE topic_candidates
               SET score = ?, score_breakdown_json = ?, motivation = ?, summary = COALESCE(?, summary),
                   published_at = COALESCE(?, published_at), collected_at = ?, status = ?,
                   decided_by = ?, decision_note = ?, decided_at = ?, updated_at = ?
               WHERE id = ?`
              )
              .run(
                input.score,
                JSON.stringify(input.breakdown),
                input.motivation,
                input.summary ?? null,
                input.publishedAt ?? null,
                now,
                auto ? "accepted" : "new",
                auto ? "auto" : null,
                auto ? `score ${input.score} reached the auto-accept threshold` : null,
                auto ? now : null,
                now,
                existing.id
              );
            outcome.refreshed.push(this.mustGet(existing.id));
          } else {
            outcome.unchanged.push(this.map(existing));
          }
        }
      })
      .immediate();

    return outcome;
  }

  /** Candidates, best score first (then newest). */
  list(filter: { status?: CandidateStatus; limit?: number } = {}): CandidateRecord[] {
    const rows = (
      filter.status
        ? this.db
            .prepare(
              `SELECT * FROM topic_candidates WHERE status = ?
               ORDER BY score DESC, published_at DESC, created_at DESC LIMIT ?`
            )
            .all(filter.status, filter.limit ?? 100)
        : this.db
            .prepare(
              `SELECT * FROM topic_candidates
               ORDER BY score DESC, published_at DESC, created_at DESC LIMIT ?`
            )
            .all(filter.limit ?? 100)
    ) as CandidateRow[];
    return rows.map((row) => this.map(row));
  }

  /** A candidate by its id or by a unique prefix of it (at least 4 characters). */
  get(idOrPrefix: string): CandidateRecord {
    const exact = this.db.prepare("SELECT * FROM topic_candidates WHERE id = ?").get(idOrPrefix) as
      CandidateRow | undefined;
    if (exact) {
      return this.map(exact);
    }
    if (idOrPrefix.length >= MIN_ID_PREFIX && /^[0-9a-f-]+$/i.test(idOrPrefix)) {
      const rows = this.db
        .prepare("SELECT * FROM topic_candidates WHERE id LIKE ? LIMIT 2")
        .all(`${idOrPrefix.toLowerCase()}%`) as CandidateRow[];
      if (rows.length > 1) {
        throw new BacklogError("ambiguous_id", `"${idOrPrefix}" matches more than one candidate`);
      }
      if (rows.length === 1) {
        return this.map(rows[0]);
      }
    }
    throw new BacklogError("not_found", `No topic candidate "${idOrPrefix}"`);
  }

  /** Accepts a `new` or `dropped` candidate (or updates an accepted one's brief). */
  accept(
    idOrPrefix: string,
    decision: { by: string; brief?: Record<string, unknown>; now?: Date }
  ): CandidateRecord {
    const candidate = this.get(idOrPrefix);
    if (candidate.status === "used") {
      throw new BacklogError("invalid_state", "This candidate already started a run");
    }
    const now = (decision.now ?? new Date()).toISOString();
    this.db
      .prepare(
        `UPDATE topic_candidates
         SET status = 'accepted', brief_json = ?, decided_by = ?, decision_note = NULL,
             decided_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        decision.brief
          ? JSON.stringify(decision.brief)
          : candidate.brief
            ? JSON.stringify(candidate.brief)
            : null,
        decision.by,
        now,
        now,
        candidate.id
      );
    return this.mustGet(candidate.id);
  }

  /** Drops a `new` or `accepted` candidate; a dropped one is never offered as `new` again. */
  drop(idOrPrefix: string, decision: { by: string; reason?: string; now?: Date }): CandidateRecord {
    const candidate = this.get(idOrPrefix);
    if (candidate.status === "used") {
      throw new BacklogError("invalid_state", "This candidate already started a run");
    }
    const now = (decision.now ?? new Date()).toISOString();
    this.db
      .prepare(
        `UPDATE topic_candidates
         SET status = 'dropped', decided_by = ?, decision_note = ?, decided_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(decision.by, decision.reason ?? null, now, now, candidate.id);
    return this.mustGet(candidate.id);
  }

  /** Records the run started from a candidate. */
  markUsed(idOrPrefix: string, workflowId: string, now: Date = new Date()): CandidateRecord {
    const candidate = this.get(idOrPrefix);
    if (candidate.status === "used") {
      throw new BacklogError("invalid_state", "This candidate already started a run");
    }
    if (candidate.status === "dropped") {
      throw new BacklogError("invalid_state", "A dropped candidate must be accepted first");
    }
    const at = now.toISOString();
    this.db
      .prepare(
        "UPDATE topic_candidates SET status = 'used', workflow_id = ?, updated_at = ? WHERE id = ?"
      )
      .run(workflowId, at, candidate.id);
    return this.mustGet(candidate.id);
  }

  /** Stores the model's proposal for a candidate (replacing an earlier one). Status and score are untouched. */
  setEnrichment(idOrPrefix: string, enrichment: CandidateEnrichment): CandidateRecord {
    const candidate = this.get(idOrPrefix);
    this.db
      .prepare("UPDATE topic_candidates SET enrichment_json = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(enrichment), enrichment.generatedAt, candidate.id);
    return this.mustGet(candidate.id);
  }

  /** Topics and titles of published and parked runs, which a candidate must not repeat. */
  listCovered(): CoveredArticle[] {
    const rows = this.db
      .prepare(
        `SELECT w.id AS workflow_id, w.topic AS topic, a.title AS title
         FROM workflows w
         LEFT JOIN articles a ON a.workflow_id = w.id
         WHERE w.status IN ('published', 'awaiting_approval', 'needs_review')
         ORDER BY w.created_at ASC`
      )
      .all() as { workflow_id: string; topic: string; title: string | null }[];
    return rows.map((row) => ({
      workflowId: row.workflow_id,
      topic: row.topic,
      title: row.title
    }));
  }

  private mustGet(id: string): CandidateRecord {
    const row = this.db.prepare("SELECT * FROM topic_candidates WHERE id = ?").get(id) as
      CandidateRow | undefined;
    if (!row) {
      throw new BacklogError("not_found", `No topic candidate "${id}"`);
    }
    return this.map(row);
  }

  private map(row: CandidateRow): CandidateRecord {
    return {
      id: row.id,
      title: row.title,
      url: row.url,
      source: row.source,
      summary: row.summary,
      publishedAt: row.published_at,
      collectedAt: row.collected_at,
      score: row.score,
      breakdown: JSON.parse(row.score_breakdown_json) as Record<string, number>,
      motivation: row.motivation,
      status: row.status,
      brief: row.brief_json ? (JSON.parse(row.brief_json) as Record<string, unknown>) : null,
      decidedBy: row.decided_by,
      decisionNote: row.decision_note,
      decidedAt: row.decided_at,
      workflowId: row.workflow_id,
      enrichment: row.enrichment_json
        ? (JSON.parse(row.enrichment_json) as CandidateEnrichment)
        : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}
