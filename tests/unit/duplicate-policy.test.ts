import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { hasForceFlag, resolveTopic } from "../../apps/cli/src/run";
import { reportRunOutcome } from "../../apps/cli/src/report";
import { createArticleGenerationWorkflow } from "../../packages/graph/src/workflows/article-generation-workflow";
import { MarkdownPublisher } from "../../packages/publishers/src/markdown";
import { createSQLiteMemoryService } from "../../packages/storage/src/memory";
import { lenientQuality } from "../mocks/lenient-quality";
import { scriptedProvider } from "../mocks/scripted-provider";

const logger = { info() {}, warn() {}, error() {}, debug() {} };

const replies = () => [
  JSON.stringify(["Intro", "Body", "Conclusion"]),
  "Article body",
  JSON.stringify({ editedText: "Edited body", changesSummary: "tidied" }),
  JSON.stringify({
    title: "A title",
    metaDescription: "A description",
    slug: "a-title",
    h1: "A H1",
    headings: [{ level: "H2", text: "Intro" }]
  }),
  JSON.stringify({ category: "General", tags: [] })
];

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

async function setup(options: { remote?: boolean; allowDuplicates?: boolean } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openblog-dup-"));
  dirs.push(dir);
  const filePath = path.join(dir, "memory.db");
  const handle = await createSQLiteMemoryService({ filePath });
  const published: string[] = [];
  const workflow = createArticleGenerationWorkflow({
    logger,
    llm: scriptedProvider(...Array.from({ length: 4 }, replies).flat()),
    memory: handle.memoryService,
    quality: lenientQuality,
    publicationPolicy: "publish_if_gate_passes",
    allowDuplicates: options.allowDuplicates,
    publisher: {
      publish: async (article) => {
        published.push(article.slug);
        return { success: true, publisherId: "fake", publisherName: "Fake" };
      },
      ...(options.remote
        ? { findExisting: async () => ({ id: "7", url: "https://example.com/a-title" }) }
        : {})
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
  return { handle, workflow, published, rows, dir };
}

/** Provider that counts calls, to prove a duplicate costs nothing. */
const countingWorkflowRun = async (workflow: ReturnType<typeof createArticleGenerationWorkflow>) =>
  workflow.run({ topic: "Same topic" });

describe("duplicate policy", () => {
  it("stops a repeated topic before any provider call", async () => {
    const first = await setup();
    await countingWorkflowRun(first.workflow);
    expect(first.published).toEqual(["a-title"]);

    const llm = scriptedProvider(...replies());
    const second = createArticleGenerationWorkflow({
      logger,
      llm,
      memory: first.handle.memoryService,
      quality: lenientQuality,
      publicationPolicy: "publish_if_gate_passes",
      publisher: { publish: async () => ({ success: true, publisherId: "f", publisherName: "F" }) }
    });

    const result = await second.run({ topic: "  same   TOPIC " });

    expect(result.status).toBe("duplicate");
    expect(result.failure?.code).toBe("duplicate_topic");
    expect(llm.prompts).toHaveLength(0);
    expect(reportRunOutcome(result, { info() {}, error() {} })).toBe(1);

    const [published, duplicate] = first.rows(
      "SELECT id, status, is_duplicate, duplicate_of_workflow_id, error_code FROM workflows ORDER BY created_at, rowid"
    ) as Array<Record<string, unknown>>;
    expect(duplicate).toMatchObject({
      status: "duplicate",
      is_duplicate: 1,
      duplicate_of_workflow_id: published!.id,
      error_code: "duplicate_topic"
    });
    await first.handle.disconnect();
  });

  it("generates again with force and records it on the run", async () => {
    const first = await setup();
    await countingWorkflowRun(first.workflow);

    const result = await first.workflow.run({ topic: "Same topic", force: true });

    // The slug now collides too, but force covers it.
    expect(result.status).toBe("published");
    expect(first.published).toEqual(["a-title", "a-title"]);
    const rows = first.rows(
      "SELECT status, is_duplicate, metadata_json FROM workflows ORDER BY created_at, rowid"
    ) as Array<{ status: string; is_duplicate: number; metadata_json: string }>;
    expect(rows[1]).toMatchObject({ status: "published", is_duplicate: 1 });
    expect(JSON.parse(rows[1]!.metadata_json)).toEqual({ force: true });
    await first.handle.disconnect();
  });

  it("allows duplicates when configured", async () => {
    const first = await setup({ allowDuplicates: true });
    await countingWorkflowRun(first.workflow);
    const result = await first.workflow.run({ topic: "Same topic" });

    expect(result.status).toBe("published");
    await first.handle.disconnect();
  });

  it("detects a slug collision with a stored article after SEO", async () => {
    const first = await setup();
    await countingWorkflowRun(first.workflow);

    const result = await first.workflow.run({ topic: "A different topic" });

    expect(result.status).toBe("duplicate");
    expect(result.failure?.code).toBe("duplicate_slug");
    expect(first.published).toEqual(["a-title"]);
    const [, duplicate] = first.rows(
      "SELECT id, status, duplicate_of_workflow_id FROM workflows ORDER BY created_at, rowid"
    ) as Array<Record<string, unknown>>;
    expect(duplicate).toMatchObject({ status: "duplicate" });
    expect(duplicate!.duplicate_of_workflow_id).toEqual(expect.any(String));
    await first.handle.disconnect();
  });

  it("detects an existing remote post through the publisher lookup", async () => {
    const ctx = await setup({ remote: true });

    const result = await ctx.workflow.run({ topic: "Fresh topic" });

    expect(result.status).toBe("duplicate");
    expect(result.failure?.code).toBe("duplicate_remote");
    expect(result.failure?.message).toContain("https://example.com/a-title");
    expect(ctx.published).toHaveLength(0);

    const forced = await ctx.workflow.run({ topic: "Fresh topic 2", force: true });
    expect(forced.status).toBe("published");
    await ctx.handle.disconnect();
  });

  it("does not count failed or unfinished runs as duplicates", async () => {
    const ctx = await setup();
    const { memoryService } = ctx.handle;
    const failed = await memoryService.beginWorkflow({ workflowName: "w", topic: "Retry me" });
    await memoryService.failWorkflow({ workflowId: failed.workflowId, errorMessage: "boom" });

    const result = await ctx.workflow.run({ topic: "Retry me" });

    expect(result.status).toBe("published");
    await ctx.handle.disconnect();
  });

  it("looks slugs and titles up case-insensitively, ignoring its own run", async () => {
    const ctx = await setup();
    const { memoryService } = ctx.handle;
    const run = await memoryService.beginWorkflow({ workflowName: "w", topic: "t" });
    await memoryService.finishWorkflow({
      workflowId: run.workflowId,
      status: "published",
      topic: "t",
      article: "a",
      editedText: "a",
      seoOutput: { title: "My Title", slug: "my-slug" },
      category: "General",
      tags: []
    });

    const other = "other-run";
    expect(
      await memoryService.findDuplicateArticle({ workflowId: other, slug: "my-slug", title: "x" })
    ).toEqual({ workflowId: run.workflowId, matchedOn: "slug" });
    expect(
      await memoryService.findDuplicateArticle({ workflowId: other, slug: "y", title: "MY title" })
    ).toEqual({ workflowId: run.workflowId, matchedOn: "title" });
    expect(
      await memoryService.findDuplicateArticle({
        workflowId: run.workflowId,
        slug: "my-slug",
        title: "My Title"
      })
    ).toBeNull();
    await ctx.handle.disconnect();
  });
});

describe("markdown publisher lookup", () => {
  it("reports an existing file unless overwriting is enabled", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openblog-md-"));
    dirs.push(dir);
    fs.writeFileSync(path.join(dir, "taken.md"), "x");

    const strict = new MarkdownPublisher({ outputDir: dir }, logger);
    expect(await strict.findExisting({ slug: "taken" })).toEqual({
      url: path.join(dir, "taken.md")
    });
    expect(await strict.findExisting({ slug: "free" })).toBeNull();
    const overwriting = new MarkdownPublisher({ outputDir: dir, overwrite: true }, logger);
    expect(await overwriting.findExisting({ slug: "taken" })).toBeNull();
  });
});

describe("CLI --force", () => {
  it("is removed from the topic and detected", () => {
    expect(hasForceFlag(["My", "topic", "--force"])).toBe(true);
    expect(hasForceFlag(["My", "topic"])).toBe(false);
    expect(resolveTopic(["My", "--force", "topic"], undefined)).toBe("My topic");
  });
});
