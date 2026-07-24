import type { Database } from "better-sqlite3";

export function runStorageMigrations(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      topic TEXT NOT NULL,
      topic_normalized TEXT NOT NULL,
      status TEXT NOT NULL,
      is_duplicate INTEGER NOT NULL DEFAULT 0,
      duplicate_of_workflow_id TEXT,
      metadata_json TEXT,
      error_message TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_workflows_topic_normalized
    ON workflows(topic_normalized);

    CREATE TABLE IF NOT EXISTS topics (
      id TEXT PRIMARY KEY,
      normalized_topic TEXT NOT NULL UNIQUE,
      first_topic TEXT NOT NULL,
      first_workflow_id TEXT NOT NULL,
      hit_count INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prompts (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      prompt_type TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_prompts_workflow_id
    ON prompts(workflow_id);

    CREATE TABLE IF NOT EXISTS articles (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL UNIQUE,
      topic TEXT NOT NULL,
      title TEXT,
      slug TEXT,
      category TEXT,
      tags_json TEXT NOT NULL,
      article_markdown TEXT NOT NULL,
      edited_markdown TEXT NOT NULL,
      seo_json TEXT NOT NULL,
      publish_result_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
    );
  `);
}
