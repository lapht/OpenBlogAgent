import type { Database } from "better-sqlite3";
import type { Identifier } from "@openblog/types";

import type { IRepositoryContract } from "./index";
import type { WorkflowRecord, WorkflowStatus } from "./models";

interface WorkflowRow {
  id: string;
  name: string;
  topic: string;
  topic_normalized: string;
  status: WorkflowStatus;
  is_duplicate: number;
  duplicate_of_workflow_id: string | null;
  metadata_json: string | null;
  error_message: string | null;
  error_code: string | null;
  failed_step: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export class WorkflowRepository implements IRepositoryContract<WorkflowRecord> {
  constructor(private readonly db: Database) {}

  getById(id: Identifier): WorkflowRecord | null {
    const row = this.db
      .prepare(
        `SELECT
          id,
          name,
          topic,
          topic_normalized,
          status,
          is_duplicate,
          duplicate_of_workflow_id,
          metadata_json,
          error_message,
          error_code,
          failed_step,
          started_at,
          completed_at,
          created_at,
          updated_at
        FROM workflows
        WHERE id = ?`
      )
      .get(id) as WorkflowRow | undefined;

    return row ? this.mapRow(row) : null;
  }

  save(model: WorkflowRecord): void {
    this.db
      .prepare(
        `INSERT INTO workflows (
          id,
          name,
          topic,
          topic_normalized,
          status,
          is_duplicate,
          duplicate_of_workflow_id,
          metadata_json,
          error_message,
          error_code,
          failed_step,
          started_at,
          completed_at,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          topic = excluded.topic,
          topic_normalized = excluded.topic_normalized,
          status = excluded.status,
          is_duplicate = excluded.is_duplicate,
          duplicate_of_workflow_id = excluded.duplicate_of_workflow_id,
          metadata_json = excluded.metadata_json,
          error_message = excluded.error_message,
          error_code = excluded.error_code,
          failed_step = excluded.failed_step,
          started_at = excluded.started_at,
          completed_at = excluded.completed_at,
          updated_at = excluded.updated_at`
      )
      .run(
        model.id,
        model.name,
        model.topic,
        model.topicNormalized,
        model.status,
        model.isDuplicate ? 1 : 0,
        model.duplicateOfWorkflowId,
        JSON.stringify(model.metadata),
        model.errorMessage,
        model.errorCode,
        model.failedStep,
        model.startedAt,
        model.completedAt,
        model.createdAt,
        model.updatedAt
      );
  }

  /** The earliest published (or published-pending-approval) run of a topic, the reference for duplicate detection. */
  findFirstPublishedByTopic(topicNormalized: string): WorkflowRecord | null {
    const row = this.db
      .prepare(
        `SELECT * FROM workflows
         WHERE topic_normalized = ? AND status IN ('published', 'awaiting_approval')
         ORDER BY completed_at ASC, created_at ASC
         LIMIT 1`
      )
      .get(topicNormalized) as WorkflowRow | undefined;

    return row ? this.mapRow(row) : null;
  }

  /** Flags a run as a duplicate of another stored run (or of a remote post, then `null`). */
  markDuplicate(id: Identifier, duplicateOfWorkflowId: Identifier | null): void {
    this.db
      .prepare(
        `UPDATE workflows
         SET is_duplicate = 1, duplicate_of_workflow_id = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(duplicateOfWorkflowId, new Date().toISOString(), id);
  }

  updateStatus(
    id: Identifier,
    status: WorkflowStatus,
    completedAt: string | null,
    errorMessage: string | null,
    failure: { errorCode?: string | null; failedStep?: string | null } = {}
  ): void {
    this.db
      .prepare(
        `UPDATE workflows
         SET status = ?,
             completed_at = ?,
             error_message = ?,
             error_code = ?,
             failed_step = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        status,
        completedAt,
        errorMessage,
        failure.errorCode ?? null,
        failure.failedStep ?? null,
        new Date().toISOString(),
        id
      );
  }

  private mapRow(row: WorkflowRow): WorkflowRecord {
    return {
      id: row.id,
      name: row.name,
      topic: row.topic,
      topicNormalized: row.topic_normalized,
      status: row.status,
      isDuplicate: row.is_duplicate === 1,
      duplicateOfWorkflowId: row.duplicate_of_workflow_id,
      metadata: row.metadata_json ? (JSON.parse(row.metadata_json) as Record<string, unknown>) : {},
      errorMessage: row.error_message,
      errorCode: row.error_code,
      failedStep: row.failed_step,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}
