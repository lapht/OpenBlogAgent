import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApplication, type Application } from "../../packages/app/src";
import { loadEnv } from "../../packages/config/src";
import { goodArticle, tooShortArticle } from "../fixtures/articles";
import { routedProvider, type Reply } from "../mocks/routed-provider";

const outline = ["Why caching matters", "Choosing a cache strategy", "Invalidation in practice"];
const seo = JSON.stringify({
  title: "Caching made simple",
  metaDescription: "How to cache well.",
  slug: "caching-made-simple",
  h1: "Caching",
  headings: [{ level: "H2", text: "Why caching matters" }]
});
const edited = (text: string) => JSON.stringify({ editedText: text, changesSummary: "tidied" });
const classification = JSON.stringify({ category: "News", tags: ["ai"] });

const healthy = () => ({
  planner: [JSON.stringify(outline)] as Reply[],
  writer: [goodArticle] as Reply[],
  editor: [edited(goodArticle)] as Reply[],
  seo: [seo] as Reply[],
  classification: [classification] as Reply[]
});

const silent = { info() {}, warn() {}, error() {}, debug() {} };

let dir: string;
let apps: Application[];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "openblog-e2e-"));
  apps = [];
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(apps.map((app) => app.dispose()));
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Builds the real application (SQLite, publishers, quality gate) around a fake provider. */
async function start(llm: { generate: unknown }, extraEnv: Record<string, string> = {}) {
  const app = await createApplication(
    loadEnv({
      OPENBLOG_OUTPUT_DIR: path.join(dir, "out"),
      OPENBLOG_MEMORY_DB_PATH: path.join(dir, "memory.db"),
      OPENBLOG_TAXONOMY_CATEGORIES: "News",
      OPENBLOG_TAXONOMY_TAGS: "ai",
      OPENBLOG_PUBLICATION_POLICY: "publish_if_gate_passes",
      OPENBLOG_LOG_LEVEL: "fatal",
      ...extraEnv
    }),
    { llm: llm as never, logger: silent }
  );
  apps.push(app);
  return app;
}

function rows(sql: string): Array<Record<string, unknown>> {
  const db = new Database(path.join(dir, "memory.db"), { readonly: true });
  try {
    return db.prepare(sql).all() as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

const stepModels = () =>
  rows("SELECT step, model FROM workflow_steps ORDER BY rowid").map(
    (row) => `${String(row.step)}:${String(row.model)}`
  );

describe("per-step model routing (offline)", () => {
  it("without per-step variables no request names a model and the provider's model is stored", async () => {
    const llm = routedProvider(healthy());
    const app = await start(llm);

    const result = await app.workflow.run({ topic: "Caching" });

    expect(result.status).toBe("published");
    expect(llm.prompts.map((entry) => entry.model)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined
    ]);
    expect(stepModels()).toEqual([
      "planner:fake",
      "writer:fake",
      "editor:fake",
      "seo:fake",
      "duplicate_check:null",
      "quality:null",
      "classification:fake",
      "publisher:null"
    ]);
  });

  it("OPENBLOG_MODEL_WRITER routes only the writer, regenerations included", async () => {
    const llm = routedProvider({ ...healthy(), writer: [tooShortArticle, goodArticle] });
    const app = await start(llm, { OPENBLOG_MODEL_WRITER: "vendor/writer-x" });

    const result = await app.workflow.run({ topic: "Caching" });

    expect(result.status).toBe("published");
    expect(llm.modelsOf("writer")).toEqual(["vendor/writer-x", "vendor/writer-x"]);
    for (const agent of ["planner", "editor", "seo", "classification"] as const) {
      expect(llm.modelsOf(agent).every((model) => model === undefined)).toBe(true);
    }
    expect(rows("SELECT attempt, model FROM workflow_steps WHERE step = 'writer'")).toEqual([
      { attempt: 1, model: "vendor/writer-x" },
      { attempt: 2, model: "vendor/writer-x" }
    ]);
    expect(rows("SELECT model FROM workflow_steps WHERE step = 'editor'")).toEqual([
      { model: "fake" },
      { model: "fake" }
    ]);
  });

  it("routes each step to its own model and exposes them through the application", async () => {
    const llm = routedProvider(healthy());
    const app = await start(llm, {
      OPENBLOG_MODEL_PLANNER: "m/planner",
      OPENBLOG_MODEL_WRITER: "m/writer",
      OPENBLOG_MODEL_EDITOR: "m/editor",
      OPENBLOG_MODEL_SEO: "m/seo",
      OPENBLOG_MODEL_CLASSIFICATION: "m/classification"
    });

    const result = await app.workflow.run({ topic: "Caching" });

    const [run] = await app.listRuns();
    expect(run!.models).toEqual({
      planner: "m/planner",
      writer: "m/writer",
      editor: "m/editor",
      seo: "m/seo",
      classification: "m/classification"
    });
    const details = await app.getRun(result.workflowId!);
    expect(details!.steps.map((entry) => [entry.step, entry.model])).toEqual([
      ["planner", "m/planner"],
      ["writer", "m/writer"],
      ["editor", "m/editor"],
      ["seo", "m/seo"],
      ["duplicate_check", null],
      ["quality", null],
      ["classification", "m/classification"],
      ["publisher", null]
    ]);
  });

  it("routes the editorial review to OPENBLOG_MODEL_REVIEW", async () => {
    const llm = routedProvider(healthy());
    const original = llm.generate.bind(llm);
    // The review prompt has no agent marker of its own; answer it with a passing review.
    llm.generate = async (request: { prompt: string; model?: string }) => {
      if (request.prompt.includes("strict editorial reviewer")) {
        return {
          text: JSON.stringify({
            scores: { seo: 9, readability: 9, structure: 9, completeness: 9, repetition: 9 },
            rationale: "Good."
          }),
          model: request.model ?? "fake",
          usage: { totalTokens: 10 }
        };
      }
      return original(request);
    };
    const app = await start(llm, {
      OPENBLOG_REVIEW_ENABLED: "true",
      OPENBLOG_MODEL_REVIEW: "m/review"
    });

    await app.workflow.run({ topic: "Caching" });

    expect(rows("SELECT model FROM workflow_steps WHERE step = 'editorial_review'")).toEqual([
      { model: "m/review" }
    ]);
  });

  it("keeps one budget for the whole run across differently routed steps", async () => {
    const llm = routedProvider(healthy());
    const app = await start(llm, {
      OPENBLOG_MODEL_PLANNER: "m/planner",
      OPENBLOG_MODEL_WRITER: "m/writer",
      OPENBLOG_MODEL_EDITOR: "m/editor",
      OPENBLOG_MAX_TOKENS_PER_RUN: "25" // 10 tokens per call: the third call goes over
    });

    const result = await app.workflow.run({ topic: "Caching" }).catch((error: unknown) => error);

    expect(result).toMatchObject({ name: "WorkflowStepError", code: "budget_exceeded" });
    expect(llm.calls("editor")).toBe(1);
    expect(llm.calls("seo")).toBe(0);
  });
});
