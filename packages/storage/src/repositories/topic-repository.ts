import type { Database } from "better-sqlite3";
import type { Identifier } from "@openblog/types";

import type { IRepositoryContract } from "./index";
import type { TopicRecord } from "./models";

interface TopicRow {
  id: string;
  normalized_topic: string;
  first_topic: string;
  first_workflow_id: string;
  hit_count: number;
  created_at: string;
  last_seen_at: string;
}

export class TopicRepository implements IRepositoryContract<TopicRecord> {
  constructor(private readonly db: Database) {}

  getById(id: Identifier): TopicRecord | null {
    const row = this.db
      .prepare(
        `SELECT
          id,
          normalized_topic,
          first_topic,
          first_workflow_id,
          hit_count,
          created_at,
          last_seen_at
         FROM topics
         WHERE id = ?`
      )
      .get(id) as TopicRow | undefined;

    return row ? this.mapRow(row) : null;
  }

  save(model: TopicRecord): void {
    this.db
      .prepare(
        `INSERT INTO topics (
          id,
          normalized_topic,
          first_topic,
          first_workflow_id,
          hit_count,
          created_at,
          last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(normalized_topic) DO UPDATE SET
          hit_count = excluded.hit_count,
          last_seen_at = excluded.last_seen_at`
      )
      .run(
        model.id,
        model.normalizedTopic,
        model.firstTopic,
        model.firstWorkflowId,
        model.hitCount,
        model.createdAt,
        model.lastSeenAt
      );
  }

  getByNormalizedTopic(normalizedTopic: string): TopicRecord | null {
    const row = this.db
      .prepare(
        `SELECT
          id,
          normalized_topic,
          first_topic,
          first_workflow_id,
          hit_count,
          created_at,
          last_seen_at
         FROM topics
         WHERE normalized_topic = ?`
      )
      .get(normalizedTopic) as TopicRow | undefined;

    return row ? this.mapRow(row) : null;
  }

  private mapRow(row: TopicRow): TopicRecord {
    return {
      id: row.id,
      normalizedTopic: row.normalized_topic,
      firstTopic: row.first_topic,
      firstWorkflowId: row.first_workflow_id,
      hitCount: row.hit_count,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at
    };
  }
}
