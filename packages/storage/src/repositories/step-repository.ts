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
  llm_calls: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  cost_usd: number | null;
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
          error_code, error_message, started_at, completed_at,
          llm_calls, prompt_tokens, completion_tokens, total_tokens, cost_usd
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        record.completedAt,
        record.usage?.calls ?? null,
        record.usage?.promptTokens ?? null,
        record.usage?.completionTokens ?? null,
        record.usage?.totalTokens ?? null,
        record.usage?.costUsd ?? null
      );

    return record;
  }

  /** Tokens and cost summed over every stored step of each run (runs without usage are absent). */
  totalsByWorkflow(
    workflowIds: Identifier[]
  ): Map<Identifier, { totalTokens: number; costUsd: number }> {
    const totals = new Map<Identifier, { totalTokens: number; costUsd: number }>();
    if (workflowIds.length === 0) {
      return totals;
    }
    const rows = this.db
      .prepare(
        `SELECT workflow_id, SUM(total_tokens) AS tokens, SUM(cost_usd) AS cost
         FROM workflow_steps
         WHERE workflow_id IN (${workflowIds.map(() => "?").join(", ")})
         GROUP BY workflow_id`
      )
      .all(...workflowIds) as Array<{
      workflow_id: string;
      tokens: number | null;
      cost: number | null;
    }>;
    for (const row of rows) {
      totals.set(row.workflow_id, { totalTokens: row.tokens ?? 0, costUsd: row.cost ?? 0 });
    }
    return totals;
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
      completedAt: row.completed_at,
      usage:
        row.llm_calls === null
          ? null
          : {
              calls: row.llm_calls,
              promptTokens: row.prompt_tokens ?? 0,
              completionTokens: row.completion_tokens ?? 0,
              totalTokens: row.total_tokens ?? 0,
              costUsd: row.cost_usd ?? 0
            }
    }));
  }
}
