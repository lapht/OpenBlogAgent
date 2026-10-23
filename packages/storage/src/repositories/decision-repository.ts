import type { Database } from "better-sqlite3";
import type { Identifier } from "@openblog/types";

import type { WorkflowDecisionRecord } from "./models";

interface DecisionRow {
  id: string;
  workflow_id: string;
  action: WorkflowDecisionRecord["action"];
  actor: string;
  note: string;
  created_at: string;
}

/** The human decisions on a run (reject, revise), oldest first. */
export class DecisionRepository {
  constructor(private readonly db: Database) {}

  append(record: WorkflowDecisionRecord): void {
    this.db
      .prepare(
        `INSERT INTO workflow_decisions (id, workflow_id, action, actor, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.workflowId,
        record.action,
        record.actor,
        record.note,
        record.createdAt
      );
  }

  getByWorkflowId(workflowId: Identifier): WorkflowDecisionRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM workflow_decisions WHERE workflow_id = ? ORDER BY created_at, rowid")
      .all(workflowId) as DecisionRow[];
    return rows.map((row) => ({
      id: row.id,
      workflowId: row.workflow_id,
      action: row.action,
      actor: row.actor,
      note: row.note,
      createdAt: row.created_at
    }));
  }
}
