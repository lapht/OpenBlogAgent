import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  createArticleGenerationWorkflow,
  WorkflowResumeError,
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

/** Replays one reply per call, in order; the call numbers in `failOn` throw once instead. */
function flakyProvider(failOn: Set<number>) {
  const prompts: string[] = [];
  let cursor = 0;
  return {
    prompts,
    id: "fake",
    async generate(request: { prompt: string }) {
      prompts.push(request.prompt);
      const call = prompts.length;
      if (failOn.has(call)) {
        throw new Error(`provider down on call ${call}`);
      }
      return { text: replies[cursor++], model: "fake" };
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

async function setup(llm: ReturnType<typeof flakyProvider>, publishOk = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openblog-resume-"));
  dirs.push(dir);
  const filePath = path.join(dir, "memory.db");
  const handle = await createSQLiteMemoryService({ filePath });
  const published: string[] = [];
  const workflow = createArticleGenerationWorkflow({
    logger,
    llm,
    quality: lenientQuality,
    memory: handle.memoryService,
    publisher: {
      publish: async (article) => {
        published.push(article.slug);
        return publishOk
          ? { success: true, publisherId: "fake", publisherName: "Fake" }
          : {
              success: false,
              publisherId: "fake",
              publisherName: "Fake",
              error: { code: "rejected", message: "rejected" }
            };
      }
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
  return { handle, workflow, published, rows };
}

describe("resuming a run", () => {
  it("calls the provider only for the failed step onward", async () => {
    const llm = flakyProvider(new Set([4])); // planner, writer, editor ok; seo throws once
    const { handle, workflow, published, rows } = await setup(llm);

    await expect(workflow.run({ topic: "Resume me" })).rejects.toBeInstanceOf(WorkflowStepError);
    expect(llm.prompts).toHaveLength(4);

    const [failedRun] = rows("SELECT id, status, failed_step FROM workflows") as Array<{
      id: string;
      status: string;
      failed_step: string;
    }>;
    expect(failedRun).toMatchObject({ status: "failed", failed_step: "seo" });

    const result = await workflow.resume(failedRun.id);

    expect(result.status).toBe("published");
    expect(result.editedText).toBe("Edited body");
    expect(result.seoOutput.slug).toBe("a-title");
    // 4 calls before the failure + seo and classification again; planner/writer/editor not repeated.
    expect(llm.prompts).toHaveLength(6);
    expect(llm.prompts[4]).toContain("Edited body");
    expect(published).toEqual(["a-title"]);

    expect(rows("SELECT status FROM workflows")).toEqual([{ status: "published" }]);
    expect(rows("SELECT step, status, attempt FROM workflow_steps ORDER BY rowid")).toEqual([
      { step: "planner", status: "succeeded", attempt: 1 },
      { step: "writer", status: "succeeded", attempt: 1 },
      { step: "editor", status: "succeeded", attempt: 1 },
      { step: "seo", status: "failed", attempt: 1 },
      { step: "seo", status: "succeeded", attempt: 2 },
      { step: "duplicate_check", status: "succeeded", attempt: 1 },
      { step: "quality", status: "succeeded", attempt: 1 },
      { step: "classification", status: "succeeded", attempt: 1 },
      { step: "publisher", status: "succeeded", attempt: 1 }
    ]);
    await handle.disconnect();
  });

  it("rejects resuming a published run and an unknown run", async () => {
    const llm = flakyProvider(new Set());
    const { handle, workflow, rows } = await setup(llm);

    await workflow.run({ topic: "Done" });
    const [{ id }] = rows("SELECT id FROM workflows") as Array<{ id: string }>;
    const calls = llm.prompts.length;

    await expect(workflow.resume(id)).rejects.toMatchObject({
      name: "WorkflowResumeError",
      code: "already_published"
    });
    await expect(workflow.resume("missing")).rejects.toBeInstanceOf(WorkflowResumeError);
    expect(llm.prompts).toHaveLength(calls);
    await handle.disconnect();
  });

  it("reruns the publisher when the previous publish was rejected", async () => {
    const llm = flakyProvider(new Set());
    const { handle, workflow, published, rows } = await setup(llm, false);

    const first = await workflow.run({ topic: "Rejected" });
    expect(first.status).toBe("failed");
    const [{ id }] = rows("SELECT id FROM workflows") as Array<{ id: string }>;
    const calls = llm.prompts.length;

    const second = await workflow.resume(id);

    expect(second.status).toBe("failed");
    expect(llm.prompts).toHaveLength(calls);
    expect(published).toEqual(["a-title", "a-title"]);
    await handle.disconnect();
  });
});
