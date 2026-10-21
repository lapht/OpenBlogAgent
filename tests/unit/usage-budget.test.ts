import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  createArticleGenerationWorkflow,
  WorkflowStepError
} from "../../packages/graph/src/workflows/article-generation-workflow";
import { createSQLiteMemoryService } from "../../packages/storage/src/memory";
import { lenientQuality } from "../mocks/lenient-quality";

const replies = [
  JSON.stringify(["Intro", "Body", "Conclusion"]),
  "# not used\nArticle body",
  JSON.stringify({ editedText: "Edited body", changesSummary: "tidied" }),
  JSON.stringify({
    title: "A title",
    metaDescription: "A description",
    slug: "a-title",
    h1: "A H1",
    headings: [{ level: "H2", text: "Intro" }]
  }),
  JSON.stringify({ category: "General", tags: ["ai"] })
];

/** Replays one reply per call; each call reports 100 tokens and $0.01. */
function meteredProvider() {
  let calls = 0;
  return {
    id: "fake",
    get calls() {
      return calls;
    },
    async generate() {
      return {
        text: replies[calls++],
        model: "fake",
        usage: { promptTokens: 60, completionTokens: 40, totalTokens: 100, cost: 0.01 }
      };
    }
  };
}

const logger = { info() {}, warn() {}, error() {}, debug() {} };
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function setup(budget: { maxTokens?: number; maxCostUsd?: number }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openblog-usage-"));
  dirs.push(dir);
  const filePath = path.join(dir, "memory.db");
  const handle = await createSQLiteMemoryService({ filePath });
  const llm = meteredProvider();
  const build = (limit: typeof budget) =>
    createArticleGenerationWorkflow({
      logger,
      llm,
      budget: limit,
      quality: lenientQuality,
      memory: handle.memoryService,
      publisher: {
        publish: async () => ({ success: true, publisherId: "fake", publisherName: "Fake" })
      }
    });
  const rows = (sql: string) => {
    const db = new Database(filePath, { readonly: true });
    try {
      return db.prepare(sql).all();
    } finally {
      db.close();
    }
  };
  return { handle, llm, workflow: build(budget), build, rows };
}

describe("token usage and budget", () => {
  it("stores the usage of every step and totals it in the run list", async () => {
    const { handle, workflow, rows } = await setup({});

    await workflow.run({ topic: "Metered" });

    expect(
      rows("SELECT step, llm_calls, total_tokens, cost_usd FROM workflow_steps ORDER BY rowid")
    ).toEqual([
      { step: "planner", llm_calls: 1, total_tokens: 100, cost_usd: 0.01 },
      { step: "writer", llm_calls: 1, total_tokens: 100, cost_usd: 0.01 },
      { step: "editor", llm_calls: 1, total_tokens: 100, cost_usd: 0.01 },
      { step: "seo", llm_calls: 1, total_tokens: 100, cost_usd: 0.01 },
      { step: "duplicate_check", llm_calls: 0, total_tokens: 0, cost_usd: 0 },
      { step: "quality", llm_calls: 0, total_tokens: 0, cost_usd: 0 },
      { step: "classification", llm_calls: 1, total_tokens: 100, cost_usd: 0.01 },
      { step: "publisher", llm_calls: 0, total_tokens: 0, cost_usd: 0 }
    ]);

    const [run] = await handle.memoryService.listWorkflows();
    expect(run.totalTokens).toBe(500);
    expect(run.costUsd).toBeCloseTo(0.05);
    await handle.disconnect();
  });

  it("aborts the run when the token budget is exceeded", async () => {
    const { handle, llm, workflow, rows } = await setup({ maxTokens: 250 });

    const error = await workflow.run({ topic: "Too long" }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(WorkflowStepError);
    expect(error).toMatchObject({ step: "editor", code: "budget_exceeded" });
    expect(llm.calls).toBe(3);
    expect(rows("SELECT status, error_code, failed_step FROM workflows")).toEqual([
      { status: "failed", error_code: "budget_exceeded", failed_step: "editor" }
    ]);
    await handle.disconnect();
  });

  it("aborts the run when the cost budget is exceeded", async () => {
    const { handle, workflow, rows } = await setup({ maxCostUsd: 0.015 });

    await expect(workflow.run({ topic: "Too dear" })).rejects.toMatchObject({
      code: "budget_exceeded"
    });
    expect(rows("SELECT error_code FROM workflows")).toEqual([{ error_code: "budget_exceeded" }]);
    await handle.disconnect();
  });

  it("counts what earlier attempts used when a run is resumed", async () => {
    const { handle, llm, build, rows } = await setup({ maxTokens: 250 });
    await build({ maxTokens: 250 })
      .run({ topic: "Resumed" })
      .catch(() => undefined);
    const [{ id }] = rows("SELECT id FROM workflows") as Array<{ id: string }>;
    const before = llm.calls;

    // 300 tokens were already used: any further call is over the budget before it is made.
    await expect(build({ maxTokens: 250 }).resume(id)).rejects.toMatchObject({
      code: "budget_exceeded"
    });
    expect(llm.calls).toBe(before);
    await handle.disconnect();
  });
});
