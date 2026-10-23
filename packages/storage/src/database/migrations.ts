import type { Database } from "better-sqlite3";

type Migration = (db: Database) => void;

/**
 * Ordered schema migrations; the schema version is `PRAGMA user_version` (index + 1).
 * Never edit a released migration: append a new one.
 */
const migrations: Migration[] = [
  // v1: the original schema. Idempotent so databases created before versioning (user_version 0)
  // adopt it without losing data.
  (db) => {
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

    addMissingColumns(db, "workflows", { error_code: "TEXT", failed_step: "TEXT" });
  },

  // v2: per-step artifacts and publish metadata.
  (db) => {
    db.exec(`
      CREATE TABLE workflow_steps (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        step TEXT NOT NULL,
        status TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        output_json TEXT,
        error_code TEXT,
        error_message TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT NOT NULL,
        FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE,
        UNIQUE (workflow_id, step, attempt)
      );

      CREATE INDEX idx_workflow_steps_workflow_id
      ON workflow_steps(workflow_id);
    `);

    addMissingColumns(db, "articles", {
      publish_remote_id: "TEXT",
      publish_remote_url: "TEXT",
      publish_remote_status: "TEXT"
    });
  },

  // v3: review state and approval audit trail.
  (db) => {
    addMissingColumns(db, "articles", {
      review_state: "TEXT NOT NULL DEFAULT 'needs_review'",
      gate_passed: "INTEGER",
      approved_by: "TEXT",
      approved_at: "TEXT",
      approval_override_reason: "TEXT"
    });

    // Articles stored before the gate: published ones are published, nothing else is known.
    db.exec(`
      UPDATE articles
      SET review_state = 'published', gate_passed = 1
      WHERE workflow_id IN (SELECT id FROM workflows WHERE status = 'published');
    `);
  },

  // v4: provider usage per step execution.
  (db) => {
    addMissingColumns(db, "workflow_steps", {
      llm_calls: "INTEGER",
      prompt_tokens: "INTEGER",
      completion_tokens: "INTEGER",
      total_tokens: "INTEGER",
      cost_usd: "REAL"
    });
  },

  // v5: model reported by the provider per step execution.
  (db) => {
    addMissingColumns(db, "workflow_steps", { model: "TEXT" });
  },

  // v6: human decisions on stored articles (reject, revise).
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_decisions (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        action TEXT NOT NULL,
        actor TEXT NOT NULL,
        note TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_workflow_decisions_workflow_id
      ON workflow_decisions(workflow_id);
    `);
  }
];

export const LATEST_SCHEMA_VERSION = migrations.length;

function addMissingColumns(db: Database, table: string, columns: Record<string, string>): void {
  const existing = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
    (column) => column.name
  );
  for (const [name, type] of Object.entries(columns)) {
    if (!existing.includes(name)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    }
  }
}

function schemaVersion(db: Database): number {
  return db.pragma("user_version", { simple: true }) as number;
}

/**
 * Brings the database to the latest schema. Each pending migration and its version bump commit
 * together, and the version is re-read under a write lock so concurrent openers apply it once.
 */
export function runStorageMigrations(db: Database): void {
  if (schemaVersion(db) >= LATEST_SCHEMA_VERSION) {
    return;
  }

  db.transaction(() => {
    for (let version = schemaVersion(db); version < LATEST_SCHEMA_VERSION; version += 1) {
      migrations[version](db);
      db.pragma(`user_version = ${version + 1}`);
    }
  }).immediate();
}
