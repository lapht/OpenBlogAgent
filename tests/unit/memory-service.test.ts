import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { createSQLiteMemoryService } from "../../packages/storage/src/memory";

describe("memory service", () => {
  const tempDirectories: string[] = [];

  afterEach(() => {
    for (const dir of tempDirectories.splice(0, tempDirectories.length)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("persists workflow lifecycle and detects duplicate topics", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openblog-memory-"));
    tempDirectories.push(tempDir);

    const dbPath = path.join(tempDir, "memory.db");
    const memoryHandle = await createSQLiteMemoryService({ filePath: dbPath });

    const firstRun = await memoryHandle.memoryService.beginWorkflow({
      workflowName: "article-generation-workflow",
      topic: "AI Agents for Testing"
    });

    expect(firstRun.isDuplicate).toBe(false);
    expect(firstRun.duplicateOfWorkflowId).toBeNull();

    await memoryHandle.memoryService.savePrompt({
      workflowId: firstRun.workflowId,
      promptType: "planner",
      content: "planner prompt"
    });
    await memoryHandle.memoryService.savePrompt({
      workflowId: firstRun.workflowId,
      promptType: "writer",
      content: "writer prompt"
    });

    await memoryHandle.memoryService.markRunning(firstRun.workflowId);
    await memoryHandle.memoryService.finishWorkflow({
      workflowId: firstRun.workflowId,
      status: "published",
      topic: "AI Agents for Testing",
      article: "raw article",
      editedText: "edited article",
      seoOutput: {
        title: "AI Agents for Testing",
        slug: "ai-agents-for-testing"
      },
      category: "General",
      tags: ["AI", "Testing"]
    });

    const secondRun = await memoryHandle.memoryService.beginWorkflow({
      workflowName: "article-generation-workflow",
      topic: "  ai agents FOR testing  "
    });

    expect(secondRun.isDuplicate).toBe(true);
    expect(secondRun.duplicateOfWorkflowId).toBe(firstRun.workflowId);

    await memoryHandle.memoryService.failWorkflow({
      workflowId: secondRun.workflowId,
      errorMessage: "forced failure"
    });

    await memoryHandle.disconnect();

    const db = new Database(dbPath, { readonly: true });
    const workflows = db
      .prepare(
        "SELECT id, status, is_duplicate, duplicate_of_workflow_id FROM workflows ORDER BY created_at ASC"
      )
      .all() as Array<{
      id: string;
      status: string;
      is_duplicate: number;
      duplicate_of_workflow_id: string | null;
    }>;
    const promptsCount = db.prepare("SELECT COUNT(*) AS count FROM prompts").get() as {
      count: number;
    };
    const topic = db.prepare("SELECT hit_count FROM topics LIMIT 1").get() as { hit_count: number };
    const articlesCount = db.prepare("SELECT COUNT(*) AS count FROM articles").get() as {
      count: number;
    };

    db.close();

    expect(workflows).toHaveLength(2);
    expect(workflows[0].id).toBe(firstRun.workflowId);
    expect(workflows[0].status).toBe("published");
    expect(workflows[0].is_duplicate).toBe(0);
    expect(workflows[1].status).toBe("failed");
    expect(workflows[1].is_duplicate).toBe(1);
    expect(workflows[1].duplicate_of_workflow_id).toBe(firstRun.workflowId);

    expect(promptsCount.count).toBe(2);
    expect(topic.hit_count).toBe(2);
    expect(articlesCount.count).toBe(1);
  });

  it("keeps the article and the failing step when a publish fails", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openblog-memory-"));
    tempDirectories.push(tempDir);

    const dbPath = path.join(tempDir, "memory.db");
    const memoryHandle = await createSQLiteMemoryService({ filePath: dbPath });
    const run = await memoryHandle.memoryService.beginWorkflow({
      workflowName: "article-generation-workflow",
      topic: "Failing publish"
    });

    await memoryHandle.memoryService.markRunning(run.workflowId);
    await memoryHandle.memoryService.finishWorkflow({
      workflowId: run.workflowId,
      status: "failed",
      topic: "Failing publish",
      article: "raw article",
      editedText: "edited article",
      seoOutput: { title: "T", slug: "t" },
      category: "General",
      tags: [],
      publishResult: { success: false },
      failedStep: "publisher",
      errorCode: "validation_failed",
      errorMessage: "Publisher validation failed"
    });
    await memoryHandle.disconnect();

    const db = new Database(dbPath, { readonly: true });
    const workflow = db
      .prepare("SELECT status, failed_step, error_code, error_message FROM workflows")
      .get();
    const article = db.prepare("SELECT edited_markdown FROM articles").get();
    db.close();

    expect(workflow).toEqual({
      status: "failed",
      failed_step: "publisher",
      error_code: "validation_failed",
      error_message: "Publisher validation failed"
    });
    expect(article).toEqual({ edited_markdown: "edited article" });
  });
});
