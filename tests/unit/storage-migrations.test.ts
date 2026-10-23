import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { LATEST_SCHEMA_VERSION, runStorageMigrations } from "../../packages/storage/src/database";
import { createSQLiteMemoryService } from "../../packages/storage/src/memory";
import { MemoryService } from "../../packages/storage/src/memory/service";
import {
  ArticleRepository,
  DecisionRepository,
  PromptRepository,
  StepRepository,
  TopicRepository,
  WorkflowRepository
} from "../../packages/storage/src/repositories";

const dirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openblog-storage-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const finishParams = (workflowId: string, status: "published" | "failed" = "published") => ({
  workflowId,
  status,
  topic: "Topic",
  article: "raw",
  editedText: "edited",
  seoOutput: { title: "T", slug: "t" },
  category: "General",
  tags: ["a"]
});

describe("storage setup", () => {
  it("creates the database and its missing directory on first run", async () => {
    const filePath = path.join(tempDir(), "nested", "data", "memory.db");

    const handle = await createSQLiteMemoryService({ filePath });
    const run = await handle.memoryService.beginWorkflow({ workflowName: "w", topic: "First" });
    await handle.disconnect();

    expect(fs.existsSync(filePath)).toBe(true);
    expect(run.isDuplicate).toBe(false);
  });

  it("lets two connections open the same new database", async () => {
    const filePath = path.join(tempDir(), "memory.db");

    const [first, second] = await Promise.all([
      createSQLiteMemoryService({ filePath }),
      createSQLiteMemoryService({ filePath })
    ]);
    await first.memoryService.beginWorkflow({ workflowName: "w", topic: "A" });
    await second.memoryService.beginWorkflow({ workflowName: "w", topic: "B" });
    await Promise.all([first.disconnect(), second.disconnect()]);

    const db = new Database(filePath, { readonly: true });
    expect(db.pragma("user_version", { simple: true })).toBe(LATEST_SCHEMA_VERSION);
    expect(db.prepare("SELECT COUNT(*) AS n FROM workflows").get()).toEqual({ n: 2 });
    db.close();
  });
});

describe("storage migrations", () => {
  it("upgrades an unversioned v1 database without losing data", async () => {
    const filePath = path.join(tempDir(), "legacy.db");
    const legacy = new Database(filePath);
    legacy.exec(`
      CREATE TABLE workflows (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, topic TEXT NOT NULL, topic_normalized TEXT NOT NULL,
        status TEXT NOT NULL, is_duplicate INTEGER NOT NULL DEFAULT 0, duplicate_of_workflow_id TEXT,
        metadata_json TEXT, error_message TEXT, started_at TEXT NOT NULL, completed_at TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE topics (
        id TEXT PRIMARY KEY, normalized_topic TEXT NOT NULL UNIQUE, first_topic TEXT NOT NULL,
        first_workflow_id TEXT NOT NULL, hit_count INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL
      );
      CREATE TABLE prompts (
        id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, prompt_type TEXT NOT NULL,
        content TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE articles (
        id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL UNIQUE, topic TEXT NOT NULL, title TEXT,
        slug TEXT, category TEXT, tags_json TEXT NOT NULL, article_markdown TEXT NOT NULL,
        edited_markdown TEXT NOT NULL, seo_json TEXT NOT NULL, publish_result_json TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      INSERT INTO workflows VALUES ('w1','n','Old topic','old topic','completed',0,NULL,'{}',NULL,'t','t','t','t');
      INSERT INTO articles VALUES ('a1','w1','Old topic','Title','slug','General','[]','raw','edited','{}',NULL,'t','t');
    `);
    expect(legacy.pragma("user_version", { simple: true })).toBe(0);
    legacy.close();

    const handle = await createSQLiteMemoryService({ filePath });
    await handle.disconnect();

    const db = new Database(filePath, { readonly: true });
    expect(db.pragma("user_version", { simple: true })).toBe(LATEST_SCHEMA_VERSION);
    expect(db.prepare("SELECT topic, status, error_code FROM workflows").get()).toEqual({
      topic: "Old topic",
      status: "completed",
      error_code: null
    });
    expect(db.prepare("SELECT edited_markdown, publish_remote_id FROM articles").get()).toEqual({
      edited_markdown: "edited",
      publish_remote_id: null
    });
    expect(db.prepare("SELECT COUNT(*) AS n FROM workflow_steps").get()).toEqual({ n: 0 });
    db.close();
  });

  it("adds the step model column to a v4 database and keeps its steps", () => {
    const db = new Database(":memory:");
    runStorageMigrations(db);
    db.exec("ALTER TABLE workflow_steps DROP COLUMN model");
    db.pragma("user_version = 4");
    db.exec(`
      INSERT INTO workflows (id, name, topic, topic_normalized, status, started_at, created_at, updated_at)
      VALUES ('w1','n','Topic','topic','completed','t','t','t');
    `);
    db.exec(`
      INSERT INTO workflow_steps (id, workflow_id, step, status, attempt, started_at, completed_at, llm_calls)
      VALUES ('s1','w1','planner','succeeded',1,'t','t',1);
    `);

    runStorageMigrations(db);

    expect(db.pragma("user_version", { simple: true })).toBe(LATEST_SCHEMA_VERSION);
    expect(db.prepare("SELECT step, llm_calls, model FROM workflow_steps").all()).toEqual([
      { step: "planner", llm_calls: 1, model: null }
    ]);
    db.close();
  });

  it("adds the decisions table to a v5 database", () => {
    const db = new Database(":memory:");
    runStorageMigrations(db);
    db.exec("DROP TABLE workflow_decisions");
    db.pragma("user_version = 5");

    runStorageMigrations(db);

    expect(db.pragma("user_version", { simple: true })).toBe(LATEST_SCHEMA_VERSION);
    expect(
      (db.prepare("PRAGMA table_info(workflow_decisions)").all() as { name: string }[]).map(
        (column) => column.name
      )
    ).toEqual(["id", "workflow_id", "action", "actor", "note", "created_at"]);
    db.close();
  });

  it("adds the step prompt hash column to a v6 database and keeps its steps", () => {
    const db = new Database(":memory:");
    runStorageMigrations(db);
    db.exec("ALTER TABLE workflow_steps DROP COLUMN prompt_hash");
    db.pragma("user_version = 6");
    db.exec(`
      INSERT INTO workflows (id, name, topic, topic_normalized, status, started_at, created_at, updated_at)
      VALUES ('w1','n','Topic','topic','completed','t','t','t');
      INSERT INTO workflow_steps (id, workflow_id, step, status, attempt, started_at, completed_at)
      VALUES ('s1','w1','planner','succeeded',1,'t','t');
    `);

    runStorageMigrations(db);

    expect(db.pragma("user_version", { simple: true })).toBe(LATEST_SCHEMA_VERSION);
    expect(db.prepare("SELECT step, prompt_hash FROM workflow_steps").all()).toEqual([
      { step: "planner", prompt_hash: null }
    ]);
    db.close();
  });

  it("is a no-op on a database that is already current", () => {
    const db = new Database(":memory:");
    runStorageMigrations(db);
    runStorageMigrations(db);
    expect(db.pragma("user_version", { simple: true })).toBe(LATEST_SCHEMA_VERSION);
    db.close();
  });
});

describe("storage transactions and step artifacts", () => {
  function build(filePath: string, crash: { topics?: boolean; articles?: boolean } = {}) {
    const db = new Database(filePath);
    db.pragma("foreign_keys = ON");
    runStorageMigrations(db);
    const topics = new TopicRepository(db);
    const articles = new ArticleRepository(db);
    if (crash.topics) {
      topics.save = () => {
        throw new Error("crash after the workflow insert");
      };
    }
    if (crash.articles) {
      articles.save = () => {
        throw new Error("crash after the status update");
      };
    }
    const service = new MemoryService(
      new WorkflowRepository(db),
      topics,
      new PromptRepository(db),
      articles,
      new StepRepository(db),
      (fn) => db.transaction(fn)(),
      new DecisionRepository(db)
    );
    return { db, service };
  }

  it("leaves no partial workflow when beginWorkflow fails midway", async () => {
    const { db, service } = build(path.join(tempDir(), "tx.db"), { topics: true });

    await expect(service.beginWorkflow({ workflowName: "w", topic: "Crash" })).rejects.toThrow(
      "crash"
    );

    expect(db.prepare("SELECT COUNT(*) AS n FROM workflows").get()).toEqual({ n: 0 });
    db.close();
  });

  it("rolls the status back when storing the article fails", async () => {
    const { db, service } = build(path.join(tempDir(), "tx2.db"), { articles: true });

    const run = await service.beginWorkflow({ workflowName: "w", topic: "Crash" });
    await service.markRunning(run.workflowId);
    await expect(service.finishWorkflow(finishParams(run.workflowId))).rejects.toThrow("crash");

    expect(db.prepare("SELECT status FROM workflows").get()).toEqual({ status: "running" });
    db.close();
  });

  it("stores step outputs per workflow with attempt numbers", async () => {
    const { db, service } = build(path.join(tempDir(), "steps.db"));
    const run = await service.beginWorkflow({ workflowName: "w", topic: "Steps" });
    const other = await service.beginWorkflow({ workflowName: "w", topic: "Other" });
    const at = { startedAt: "2026-01-01T00:00:00Z", completedAt: "2026-01-01T00:00:01Z" };

    await service.recordStep({
      workflowId: run.workflowId,
      step: "planner",
      status: "succeeded",
      output: { outline: ["a"] },
      ...at
    });
    await service.recordStep({
      workflowId: run.workflowId,
      step: "writer",
      status: "failed",
      errorCode: "x",
      errorMessage: "boom",
      ...at
    });
    await service.recordStep({
      workflowId: run.workflowId,
      step: "writer",
      status: "succeeded",
      output: { article: "text" },
      ...at
    });
    await service.recordStep({
      workflowId: other.workflowId,
      step: "planner",
      status: "succeeded",
      output: {},
      ...at
    });

    const steps = await service.getSteps(run.workflowId);
    expect(steps.map((s) => [s.step, s.status, s.attempt])).toEqual([
      ["planner", "succeeded", 1],
      ["writer", "failed", 1],
      ["writer", "succeeded", 2]
    ]);
    expect(steps[0].output).toEqual({ outline: ["a"] });
    expect(steps[1]).toMatchObject({ errorCode: "x", errorMessage: "boom" });
    db.close();
  });

  it("only treats a published run as the original for duplicates", async () => {
    const { db, service } = build(path.join(tempDir(), "dup.db"));
    const failed = await service.beginWorkflow({ workflowName: "w", topic: "Same topic" });
    await service.failWorkflow({ workflowId: failed.workflowId, errorMessage: "nope" });

    const retry = await service.beginWorkflow({ workflowName: "w", topic: "same topic" });
    expect(retry.isDuplicate).toBe(false);
    await service.finishWorkflow(finishParams(retry.workflowId));

    const again = await service.beginWorkflow({ workflowName: "w", topic: "Same Topic" });
    expect(again.isDuplicate).toBe(true);
    expect(again.duplicateOfWorkflowId).toBe(retry.workflowId);
    db.close();
  });

  it("stores publish metadata columns", async () => {
    const { db, service } = build(path.join(tempDir(), "meta.db"));
    const run = await service.beginWorkflow({ workflowName: "w", topic: "Meta" });
    await service.finishWorkflow({
      ...finishParams(run.workflowId),
      publishResult: { success: true, metadata: { id: 42, url: "https://x/y", status: "draft" } }
    });

    expect(
      db
        .prepare(
          "SELECT publish_remote_id, publish_remote_url, publish_remote_status FROM articles"
        )
        .get()
    ).toEqual({
      publish_remote_id: "42",
      publish_remote_url: "https://x/y",
      publish_remote_status: "draft"
    });
    db.close();
  });
});
