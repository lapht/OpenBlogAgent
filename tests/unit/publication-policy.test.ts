import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseCommand } from "../../apps/cli/src/args";
import { reportApprovalOutcome, reportRunOutcome } from "../../apps/cli/src/report";
import { loadEnv } from "../../packages/config/src";
import {
  ApprovalError,
  createArticleGenerationWorkflow,
  type PublicationPolicy
} from "../../packages/graph/src/workflows/article-generation-workflow";
import { logger } from "../../packages/logger/src";
import { MarkdownPublisher, WordPressPublisher } from "../../packages/publishers/src";
import type { PublishArticle, PublishResult } from "../../packages/publishers/src";
import { createSQLiteMemoryService } from "../../packages/storage/src/memory";
import { lenientQuality } from "../mocks/lenient-quality";
import { scriptedProvider } from "../mocks/scripted-provider";

const replies = (body = "Article body") => [
  JSON.stringify(["Intro", "Body", "Conclusion"]),
  body,
  JSON.stringify({ editedText: body, changesSummary: "tidied" }),
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
  vi.unstubAllGlobals();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

interface SetupOptions {
  policy?: PublicationPolicy;
  /** Fails the gate: the article is shorter than this many words. */
  minWords?: number;
  /** Results of successive publish calls; the last one repeats. */
  publishOutcomes?: boolean[];
}

async function setup(options: SetupOptions = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openblog-policy-"));
  dirs.push(dir);
  const filePath = path.join(dir, "memory.db");
  const handle = await createSQLiteMemoryService({ filePath });
  const calls: PublishArticle[] = [];
  const outcomes = options.publishOutcomes ?? [true];
  const publisher = {
    publish: async (article: PublishArticle): Promise<PublishResult> => {
      calls.push(article);
      const ok = outcomes[Math.min(calls.length, outcomes.length) - 1]!;
      return ok
        ? { success: true, publisherId: "fake", publisherName: "Fake", metadata: { id: 5 } }
        : {
            success: false,
            publisherId: "fake",
            publisherName: "Fake",
            error: { code: "boom", message: "publisher is down" }
          };
    }
  };
  const workflow = createArticleGenerationWorkflow({
    logger,
    llm: scriptedProvider(...replies()),
    memory: handle.memoryService,
    publisher,
    quality: {
      ...lenientQuality,
      rules: { ...lenientQuality.rules, minWords: options.minWords ?? 1 }
    },
    ...(options.policy ? { publicationPolicy: options.policy } : {})
  });
  const rows = (sql: string) => {
    const db = new Database(filePath, { readonly: true });
    try {
      return db.prepare(sql).all() as Array<Record<string, unknown>>;
    } finally {
      db.close();
    }
  };
  return { handle, workflow, calls, rows };
}

describe("publication policy matrix", () => {
  // policy, gate passes -> [publisher calls, status sent, run status, article review state]
  const matrix: Array<
    [PublicationPolicy | undefined, boolean, number, string | undefined, string, string]
  > = [
    [undefined, true, 1, "draft", "awaiting_approval", "needs_review"],
    ["draft", true, 1, "draft", "awaiting_approval", "needs_review"],
    ["publish_after_approval", true, 0, undefined, "awaiting_approval", "needs_review"],
    ["publish_if_gate_passes", true, 1, "publish", "published", "published"],
    [undefined, false, 0, undefined, "needs_review", "needs_review"],
    ["draft", false, 0, undefined, "needs_review", "needs_review"],
    ["publish_after_approval", false, 0, undefined, "needs_review", "needs_review"],
    ["publish_if_gate_passes", false, 0, undefined, "needs_review", "needs_review"]
  ];

  it.each(matrix)(
    "policy %s, gate passes=%s",
    async (policy, passes, publishCalls, sentStatus, runStatus, reviewState) => {
      const ctx = await setup({ policy, minWords: passes ? 1 : 1000 });

      const result = await ctx.workflow.run({ topic: "Topic" });

      expect(result.status).toBe(runStatus);
      expect(ctx.calls).toHaveLength(publishCalls);
      expect(ctx.calls[0]?.status).toBe(sentStatus);
      expect(ctx.rows("SELECT review_state, gate_passed FROM articles")).toEqual([
        { review_state: reviewState, gate_passed: passes ? 1 : 0 }
      ]);
      await ctx.handle.disconnect();
    }
  );

  it("defaults to draft in configuration, whatever the WordPress status says", () => {
    const env = loadEnv({ OPENBLOG_WORDPRESS_STATUS: "publish" });
    expect(env.OPENBLOG_PUBLICATION_POLICY).toBe("draft");
    expect(() => loadEnv({ OPENBLOG_PUBLICATION_POLICY: "yolo" })).toThrow();
  });

  it("exits 0 for a run waiting for approval and points at the approve command", async () => {
    const ctx = await setup({ policy: "publish_after_approval" });
    const result = await ctx.workflow.run({ topic: "Topic" });
    const logs: string[] = [];

    const code = reportRunOutcome(result, {
      info: (_m, meta) => logs.push(JSON.stringify(meta)),
      error: () => logs.push("error")
    });

    expect(code).toBe(0);
    expect(logs.join()).toContain("approve ");
    await ctx.handle.disconnect();
  });
});

describe("approve", () => {
  it("publishes a stored, gate-passing article live exactly once and records the approver", async () => {
    const ctx = await setup({ policy: "publish_after_approval" });
    const run = await ctx.workflow.run({ topic: "Topic" });
    expect(ctx.calls).toHaveLength(0);

    const result = await ctx.workflow.approve(run.workflowId!, { approvedBy: "luca" });

    expect(result).toMatchObject({ status: "published", slug: "a-title" });
    expect(ctx.calls).toHaveLength(1);
    expect(ctx.calls[0]).toMatchObject({
      status: "publish",
      slug: "a-title",
      content: "Article body"
    });
    expect(ctx.rows("SELECT status FROM workflows")).toEqual([{ status: "published" }]);
    const [article] = ctx.rows(
      "SELECT review_state, approved_by, approved_at, approval_override_reason, publish_remote_id FROM articles"
    );
    expect(article).toMatchObject({
      review_state: "published",
      approved_by: "luca",
      approval_override_reason: null,
      publish_remote_id: "5"
    });
    expect(Date.parse(String(article!.approved_at))).not.toBeNaN();

    await expect(
      ctx.workflow.approve(run.workflowId!, { approvedBy: "luca" })
    ).rejects.toMatchObject({
      code: "already_published"
    });
    expect(ctx.calls).toHaveLength(1);
    await ctx.handle.disconnect();
  });

  it("approves the draft of the draft policy by publishing it live", async () => {
    const ctx = await setup();
    const run = await ctx.workflow.run({ topic: "Topic" });
    expect(ctx.calls.map((call) => call.status)).toEqual(["draft"]);

    await ctx.workflow.approve(run.workflowId!, { approvedBy: "luca" });

    expect(ctx.calls.map((call) => call.status)).toEqual(["draft", "publish"]);
    await ctx.handle.disconnect();
  });

  it("refuses an article that failed the gate unless overridden with a recorded reason", async () => {
    const ctx = await setup({ minWords: 1000 });
    const run = await ctx.workflow.run({ topic: "Topic" });
    expect(run.status).toBe("needs_review");

    await expect(
      ctx.workflow.approve(run.workflowId!, { approvedBy: "luca" })
    ).rejects.toMatchObject({
      code: "gate_not_passed"
    });
    await expect(
      ctx.workflow.approve(run.workflowId!, { approvedBy: "luca", overrideReason: "  " })
    ).rejects.toBeInstanceOf(ApprovalError);
    expect(ctx.calls).toHaveLength(0);

    const result = await ctx.workflow.approve(run.workflowId!, {
      approvedBy: "luca",
      overrideReason: "short by design"
    });

    expect(result.status).toBe("published");
    expect(ctx.rows("SELECT approval_override_reason, review_state FROM articles")).toEqual([
      { approval_override_reason: "short by design", review_state: "published" }
    ]);
    await ctx.handle.disconnect();
  });

  it("stays approved when publishing fails and can be retried", async () => {
    const ctx = await setup({ policy: "publish_after_approval", publishOutcomes: [false, true] });
    const run = await ctx.workflow.run({ topic: "Topic" });

    const failed = await ctx.workflow.approve(run.workflowId!, { approvedBy: "luca" });

    expect(failed).toMatchObject({ status: "failed", failure: { code: "boom" } });
    expect(reportApprovalOutcome(failed, { info() {}, error() {} })).toBe(1);
    expect(ctx.rows("SELECT review_state FROM articles")).toEqual([{ review_state: "approved" }]);
    expect(ctx.rows("SELECT status FROM workflows")).toEqual([{ status: "awaiting_approval" }]);

    const retried = await ctx.workflow.approve(run.workflowId!, { approvedBy: "luca" });

    expect(retried.status).toBe("published");
    expect(ctx.rows("SELECT review_state FROM articles")).toEqual([{ review_state: "published" }]);
    expect(reportApprovalOutcome(retried, { info() {}, error() {} })).toBe(0);
    await ctx.handle.disconnect();
  });

  it("rejects unknown runs", async () => {
    const ctx = await setup();
    await expect(ctx.workflow.approve("nope", { approvedBy: "luca" })).rejects.toMatchObject({
      code: "not_found"
    });
    await ctx.handle.disconnect();
  });
});

describe("approve command line", () => {
  it("parses the id and the override reason", () => {
    expect(parseCommand(["approve", "wf-1"])).toMatchObject({
      name: "approve",
      workflowId: "wf-1",
      options: { override: undefined }
    });
    expect(parseCommand(["approve", "wf-1", "--override", "checked by hand"])).toMatchObject({
      name: "approve",
      options: { override: "checked by hand" }
    });
    expect(() => parseCommand(["approve"])).toThrow(/workflow id/);
    expect(() => parseCommand(["approve", "wf-1", "--override"])).toThrow();
  });
});

describe("publishers honor the article status", () => {
  const article: PublishArticle = {
    title: "Hello",
    slug: "hello",
    summary: "Summary",
    content: "Body",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    tags: [],
    category: "News",
    author: "OpenBlogAgent",
    language: "en"
  };

  it("WordPress sends the article status, over its own configured status", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "GET") return { ok: true, status: 200, json: async () => [] };
        bodies.push(JSON.parse(String(init?.body)));
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: 5,
            link: "https://example.com/hello",
            status: "x",
            slug: "hello"
          })
        };
      })
    );
    const publisher = new WordPressPublisher(
      {
        endpoint: "https://example.com/wp-json/wp/v2",
        username: "u",
        applicationPassword: "p",
        status: "publish"
      },
      logger,
      { list: async () => [], resolve: async () => ({ id: 7, name: "News" }) },
      { list: async () => [], resolveMany: async () => [] }
    );

    await publisher.publish({ ...article, status: "draft" });
    await publisher.publish(article);

    expect(bodies.map((body) => body.status)).toEqual(["draft", "publish"]);
  });

  it("markdown writes the status and replaces its own draft only when going live", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openblog-md-status-"));
    dirs.push(dir);
    const publisher = new MarkdownPublisher({ outputDir: dir }, logger);

    expect((await publisher.publish({ ...article, status: "draft" })).success).toBe(true);
    expect(fs.readFileSync(path.join(dir, "hello.md"), "utf8")).toContain("status: draft");
    expect((await publisher.publish({ ...article, status: "draft" })).error?.code).toBe(
      "already_exists"
    );

    expect((await publisher.publish({ ...article, status: "publish" })).success).toBe(true);
    expect(fs.readFileSync(path.join(dir, "hello.md"), "utf8")).toContain("status: publish");
    expect((await publisher.publish({ ...article, status: "publish" })).error?.code).toBe(
      "already_exists"
    );
  });
});
