import type { Database } from "better-sqlite3";
import type { Identifier } from "@openblog/types";

import type { WorkflowStepRecord, WorkflowStepStatus } from "./models";

interface StepRow {
  id: string;
  workflow_id: string;
  step: string;
  status: WorkflowStepStatus;
  attempt: number;
  output_json: string | null;
  error_code: string | null;
  error_message: string | null;
  started_at: string;
  completed_at: string;
}

export class StepRepository {
  constructor(private readonly db: Database) {}

  /** Appends an execution of a step; the attempt number follows the previous ones for that step. */
  append(model: Omit<WorkflowStepRecord, "attempt">): WorkflowStepRecord {
    const previous = this.db
      .prepare(
        "SELECT COALESCE(MAX(attempt), 0) AS attempt FROM workflow_steps WHERE workflow_id = ? AND step = ?"
      )
      .get(model.workflowId, model.step) as { attempt: number };
    const record = { ...model, attempt: previous.attempt + 1 };

    this.db
      .prepare(
        `INSERT INTO workflow_steps (
          id, workflow_id, step, status, attempt, output_json,
          error_code, error_message, started_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.workflowId,
        record.step,
        record.status,
        record.attempt,
        record.output === undefined ? null : JSON.stringify(record.output),
        record.errorCode,
        record.errorMessage,
        record.startedAt,
        record.completedAt
      );

    return record;
  }

  getByWorkflowId(workflowId: Identifier): WorkflowStepRecord[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM workflow_steps WHERE workflow_id = ? ORDER BY completed_at ASC, attempt ASC, rowid ASC"
      )
      .all(workflowId) as StepRow[];

    return rows.map((row) => ({
      id: row.id,
      workflowId: row.workflow_id,
      step: row.step,
      status: row.status,
      attempt: row.attempt,
      output: row.output_json === null ? undefined : (JSON.parse(row.output_json) as unknown),
      errorCode: row.error_code,
      errorMessage: row.error_message,
      startedAt: row.started_at,
      completedAt: row.completed_at
    }));
  }
}
