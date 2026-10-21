import type { Database } from "better-sqlite3";
import type { Identifier } from "@openblog/types";

import type { IRepositoryContract } from "./index";
import type { PromptRecord } from "./models";

interface PromptRow {
  id: string;
  workflow_id: string;
  prompt_type: "planner" | "writer";
  content: string;
  created_at: string;
}

export class PromptRepository implements IRepositoryContract<PromptRecord> {
  constructor(private readonly db: Database) {}

  getById(id: Identifier): PromptRecord | null {
    const row = this.db
      .prepare(
        `SELECT
          id,
          workflow_id,
          prompt_type,
          content,
          created_at
         FROM prompts
         WHERE id = ?`
      )
      .get(id) as PromptRow | undefined;

    return row ? this.mapRow(row) : null;
  }

  save(model: PromptRecord): void {
    this.db
      .prepare(
        `INSERT INTO prompts (
          id,
          workflow_id,
          prompt_type,
          content,
          created_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          workflow_id = excluded.workflow_id,
          prompt_type = excluded.prompt_type,
          content = excluded.content,
          created_at = excluded.created_at`
      )
      .run(model.id, model.workflowId, model.promptType, model.content, model.createdAt);
  }

  getByWorkflowId(workflowId: Identifier): PromptRecord[] {
    const rows = this.db
      .prepare(
        `SELECT
          id,
          workflow_id,
          prompt_type,
          content,
          created_at
         FROM prompts
         WHERE workflow_id = ?
         ORDER BY created_at ASC`
      )
      .all(workflowId) as PromptRow[];

    return rows.map((row) => this.mapRow(row));
  }

  private mapRow(row: PromptRow): PromptRecord {
    return {
      id: row.id,
      workflowId: row.workflow_id,
      promptType: row.prompt_type,
      content: row.content,
      createdAt: row.created_at
    };
  }
}
