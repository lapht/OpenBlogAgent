import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApplication, type Application } from "../../packages/app/src";
import { loadEnv } from "../../packages/config/src";
import { goodArticle, tooShortArticle } from "../fixtures/articles";
import { stubWordPress, WORDPRESS_ENDPOINT } from "../mocks/fake-wordpress";
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

const outputFile = (slug = "caching-made-simple") => path.join(dir, "out", `${slug}.md`);

/** A run whose only draft is too short for the gate: parked as needs_review (no regenerations). */
const parkable = () => ({
  ...healthy(),
  writer: [tooShortArticle, goodArticle] as Reply[],
  editor: [edited(tooShortArticle), edited(goodArticle)] as Reply[]
});
const noRegeneration = { OPENBLOG_QUALITY_MAX_ATTEMPTS: "0" };

describe("reject and revise (offline)", () => {
  it("needs_review -> revise -> awaiting_approval -> approve -> published", async () => {
    const llm = routedProvider(parkable());
    const app = await start(llm, {
      ...noRegeneration,
      OPENBLOG_PUBLICATION_POLICY: "publish_after_approval"
    });

    const parked = await app.workflow.run({ topic: "Caching" });
    expect(parked.status).toBe("needs_review");
    const id = parked.workflowId!;

    const revision = await app.workflow.revise(id, {
      revisedBy: "alice",
      feedback: "Add a section on cache stampedes."
    });
    expect(revision.workflowId).toBe(id);
    const revised = await revision.execute();

    expect(revised.status).toBe("awaiting_approval");
    // The outline was kept; only the writer and what follows ran again.
    expect(llm.calls("planner")).toBe(1);
    expect(llm.calls("writer")).toBe(2);
    expect(llm.calls("seo")).toBe(2);
    const prompt = llm.prompts.filter((entry) => entry.agent === "writer")[1]!.prompt;
    expect(prompt).toContain("A human reviewer read the previous version");
    expect(prompt).toContain("Add a section on cache stampedes.");
    expect(prompt).toContain(tooShortArticle);
    expect(llm.prompts.filter((entry) => entry.agent === "writer")[0]!.prompt).not.toContain(
      "human reviewer"
    );
    expect(rows("SELECT status, gate_passed FROM workflows, articles")).toEqual([
      { status: "awaiting_approval", gate_passed: 1 }
    ]);
    expect(rows("SELECT action, actor, note FROM workflow_decisions")).toEqual([
      { action: "revise", actor: "alice", note: "Add a section on cache stampedes." }
    ]);
    expect(rows("SELECT step, attempt FROM workflow_steps WHERE step = 'writer'")).toEqual([
      { step: "writer", attempt: 1 },
      { step: "writer", attempt: 2 }
    ]);

    const approved = await app.workflow.approve(id, { approvedBy: "bob" });
    expect(approved.status).toBe("published");
    expect(fs.readFileSync(outputFile(), "utf8")).toContain("status: publish");
    expect(rows("SELECT status FROM workflows")).toEqual([{ status: "published" }]);
  });

  it("keeps the reviewer's feedback in the writer prompt when the gate asks for a regeneration", async () => {
    const llm = routedProvider({
      ...parkable(),
      writer: [tooShortArticle, tooShortArticle, tooShortArticle, goodArticle],
      editor: [
        edited(tooShortArticle),
        edited(tooShortArticle),
        edited(tooShortArticle),
        edited(goodArticle)
      ]
    });
    const app = await start(llm, {
      OPENBLOG_QUALITY_MAX_ATTEMPTS: "1",
      OPENBLOG_PUBLICATION_POLICY: "publish_after_approval"
    });
    const parked = await app.workflow.run({ topic: "Caching" }); // writer x2, needs_review
    expect(parked.status).toBe("needs_review");

    const revised = await (
      await app.workflow.revise(parked.workflowId!, {
        revisedBy: "alice",
        feedback: "Be concrete."
      })
    ).execute();

    expect(revised.status).toBe("awaiting_approval");
    const writerPrompts = llm.prompts.filter((entry) => entry.agent === "writer");
    expect(writerPrompts).toHaveLength(4); // 2 for the first run, then the revision and its regeneration
    expect(writerPrompts[2]!.prompt).toContain("Be concrete.");
    expect(writerPrompts[3]!.prompt).toContain("Be concrete.");
    expect(writerPrompts[3]!.prompt).toContain("rejected by automatic checks");
  });

  it("a revision of a draft already at the target updates the same remote post", async () => {
    const wordpress = stubWordPress();
    const llm = routedProvider({
      ...healthy(),
      writer: [goodArticle, goodArticle]
    });
    const app = await start(llm, {
      OPENBLOG_PUBLICATION_POLICY: "draft",
      OPENBLOG_DEFAULT_PUBLISHER: "wordpress",
      OPENBLOG_WORDPRESS_ENDPOINT: WORDPRESS_ENDPOINT,
      OPENBLOG_WORDPRESS_USERNAME: "bot",
      OPENBLOG_WORDPRESS_APPLICATION_PASSWORD: "secret"
    });
    const drafted = await app.workflow.run({ topic: "Caching" });
    expect(drafted.status).toBe("awaiting_approval");
    expect(wordpress.posts).toHaveLength(1);

    const revised = await (
      await app.workflow.revise(drafted.workflowId!, { revisedBy: "alice", feedback: "Shorter." })
    ).execute();

    expect(revised.status).toBe("awaiting_approval");
    expect(wordpress.posts).toHaveLength(1);
    expect(wordpress.posts[0]).toMatchObject({ slug: "caching-made-simple", status: "draft" });
    expect(revised.publishResult?.metadata).toMatchObject({ action: "updated" });
  });

  it("counts a revision against the run budget", async () => {
    const llm = routedProvider(parkable());
    const app = await start(llm, {
      ...noRegeneration,
      OPENBLOG_PUBLICATION_POLICY: "publish_after_approval",
      OPENBLOG_MAX_TOKENS_PER_RUN: "70" // 10 per call: the first run uses 50
    });
    const parked = await app.workflow.run({ topic: "Caching" });
    expect(parked.status).toBe("needs_review");

    const revision = await app.workflow.revise(parked.workflowId!, {
      revisedBy: "alice",
      feedback: "More."
    });

    await expect(revision.execute()).rejects.toMatchObject({ code: "budget_exceeded" });
    expect(rows("SELECT status, error_code FROM workflows")).toEqual([
      { status: "failed", error_code: "budget_exceeded" }
    ]);
  });

  it("reject is terminal: approve, revise and resume refuse a rejected run", async () => {
    const llm = routedProvider(parkable());
    const app = await start(llm, {
      ...noRegeneration,
      OPENBLOG_PUBLICATION_POLICY: "publish_after_approval"
    });
    const parked = await app.workflow.run({ topic: "Caching" });
    const id = parked.workflowId!;

    const rejected = await app.workflow.reject(id, { rejectedBy: "alice", reason: "Off brand" });

    expect(rejected).toEqual({ status: "rejected", workflowId: id });
    expect(rows("SELECT status, error_code FROM workflows")).toEqual([
      { status: "rejected", error_code: null }
    ]);
    expect(rows("SELECT review_state FROM articles")).toEqual([{ review_state: "rejected" }]);
    expect(rows("SELECT action, actor, note FROM workflow_decisions")).toEqual([
      { action: "reject", actor: "alice", note: "Off brand" }
    ]);
    await expect(
      app.workflow.approve(id, { approvedBy: "x", overrideReason: "y" })
    ).rejects.toMatchObject({
      name: "ApprovalError",
      code: "already_rejected"
    });
    await expect(app.workflow.revise(id, { revisedBy: "x", feedback: "y" })).rejects.toMatchObject({
      name: "ReviewError",
      code: "already_rejected"
    });
    await expect(app.workflow.reject(id, { rejectedBy: "x", reason: "y" })).rejects.toMatchObject({
      code: "already_rejected"
    });
    await expect(app.workflow.resume(id)).rejects.toMatchObject({ code: "already_rejected" });
    expect(fs.existsSync(path.join(dir, "out"))).toBe(false);
  });

  it("a rejected article does not count as a duplicate of later runs", async () => {
    const llm = routedProvider(healthy());
    const app = await start(llm, { OPENBLOG_PUBLICATION_POLICY: "publish_after_approval" });
    const first = await app.workflow.run({ topic: "Caching" });
    expect(first.status).toBe("awaiting_approval");

    // While it waits, the same topic is a duplicate; once rejected, it is not.
    expect((await app.workflow.run({ topic: "Caching" })).status).toBe("duplicate");
    await app.workflow.reject(first.workflowId!, { rejectedBy: "alice", reason: "No" });
    const again = await app.workflow.run({ topic: "Caching" });

    expect(again.status).toBe("awaiting_approval");
  });

  it("refuses runs in other states and empty input, with stable codes", async () => {
    const llm = routedProvider({ ...healthy(), planner: ["not json"] });
    const app = await start(llm);
    const failed = await app.workflow.run({ topic: "Broken" }).catch(() => undefined);
    expect(failed).toBeUndefined();
    const [{ id }] = rows("SELECT id FROM workflows") as Array<{ id: string }>;

    await expect(app.workflow.revise(id!, { revisedBy: "a", feedback: "x" })).rejects.toMatchObject(
      {
        code: "invalid_state"
      }
    );
    await expect(app.workflow.reject(id!, { rejectedBy: "a", reason: "x" })).rejects.toMatchObject({
      code: "invalid_state"
    });
    await expect(
      app.workflow.reject("nope", { rejectedBy: "a", reason: "x" })
    ).rejects.toMatchObject({
      code: "not_found"
    });
    await expect(
      app.workflow.revise(id!, { revisedBy: "a", feedback: "  " })
    ).rejects.toMatchObject({
      code: "invalid_input"
    });

    const llm2 = routedProvider(healthy());
    const live = await start(llm2, { OPENBLOG_TAXONOMY_TAGS: "ai" });
    const published = await live.workflow.run({ topic: "Another" });
    expect(published.status).toBe("published");
    await expect(
      live.workflow.revise(published.workflowId!, { revisedBy: "a", feedback: "x" })
    ).rejects.toMatchObject({ code: "already_published" });
    expect(llm2.calls("writer")).toBe(1);
  });
});
