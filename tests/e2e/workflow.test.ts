import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApplication, type Application } from "../../packages/app/src";
import { loadEnv } from "../../packages/config/src";
import { OpenRouterProvider } from "../../packages/providers/src";
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

const outputFile = (slug = "caching-made-simple") => path.join(dir, "out", `${slug}.md`);

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

const stepStatuses = () =>
  rows("SELECT step, status FROM workflow_steps ORDER BY rowid").map(
    (row) => `${String(row.step)}:${String(row.status)}`
  );

describe("workflow end to end (offline)", () => {
  it("happy path: writes the markdown file and stores the run as published", async () => {
    const llm = routedProvider(healthy());
    const app = await start(llm);

    const result = await app.workflow.run({ topic: "Caching" });

    expect(result.status).toBe("published");
    expect(result.publishResult?.success).toBe(true);
    const file = fs.readFileSync(outputFile(), "utf8");
    expect(file).toContain("title: Caching made simple");
    expect(file).toContain("status: publish");
    expect(file).toContain("## Why caching matters");
    expect(rows("SELECT status, topic FROM workflows")).toEqual([
      { status: "published", topic: "Caching" }
    ]);
    expect(rows("SELECT review_state, gate_passed FROM articles")).toEqual([
      { review_state: "published", gate_passed: 1 }
    ]);
    expect(stepStatuses()).toEqual([
      "planner:succeeded",
      "writer:succeeded",
      "editor:succeeded",
      "seo:succeeded",
      "duplicate_check:succeeded",
      "quality:succeeded",
      "classification:succeeded",
      "publisher:succeeded"
    ]);
    expect(llm.prompts).toHaveLength(5);
  });

  it("re-prompts when the planner returns malformed JSON, then succeeds", async () => {
    const llm = routedProvider({
      ...healthy(),
      planner: ["Sure! Here is an outline: not json", JSON.stringify(outline)]
    });
    const app = await start(llm);

    const result = await app.workflow.run({ topic: "Caching" });

    expect(result.status).toBe("published");
    expect(llm.calls("planner")).toBe(2);
    const retryPrompt = llm.prompts.filter((entry) => entry.agent === "planner")[1]!.prompt;
    expect(retryPrompt).toContain("Your previous reply was rejected");
    expect(rows("SELECT step, status FROM workflow_steps WHERE step = 'planner'")).toEqual([
      { step: "planner", status: "succeeded" }
    ]);
    expect(fs.existsSync(outputFile())).toBe(true);
  });

  it("fails the run, without a file, when the planner never returns valid JSON", async () => {
    const llm = routedProvider({ ...healthy(), planner: ["still not json"] });
    const app = await start(llm);

    await expect(app.workflow.run({ topic: "Caching" })).rejects.toMatchObject({
      name: "WorkflowStepError"
    });

    expect(llm.calls("planner")).toBe(3);
    expect(llm.calls("writer")).toBe(0);
    expect(rows("SELECT status, failed_step FROM workflows")).toEqual([
      { status: "failed", failed_step: "planner" }
    ]);
    expect(fs.existsSync(path.join(dir, "out"))).toBe(false);
  });

  it("retries a provider 429 and still publishes", async () => {
    const replies = routedProvider(healthy());
    let failuresLeft = 1;
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (failuresLeft-- > 0) {
        return new Response("slow down", { status: 429, headers: { "retry-after": "0" } });
      }
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
      const { text } = await replies.generate({ prompt: body.messages.at(-1)!.content });
      return new Response(
        JSON.stringify({ model: "m", choices: [{ message: { content: text } }] })
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const app = await start(new OpenRouterProvider({ apiKey: "k", baseDelayMs: 1, maxRetries: 2 }));

    const result = await app.workflow.run({ topic: "Caching" });

    expect(result.status).toBe("published");
    expect(fetchMock).toHaveBeenCalledTimes(6); // 5 agent calls + 1 retried 429
    expect(replies.prompts).toHaveLength(5);
    expect(fs.existsSync(outputFile())).toBe(true);
  });

  it("marks the run failed when the publisher fails, then resumes without calling the LLM", async () => {
    const wordpress = stubWordPress({ failWrites: [500] });
    const llm = routedProvider(healthy());
    const app = await start(llm, {
      OPENBLOG_DEFAULT_PUBLISHER: "wordpress",
      OPENBLOG_WORDPRESS_ENDPOINT: WORDPRESS_ENDPOINT,
      OPENBLOG_WORDPRESS_USERNAME: "bot",
      OPENBLOG_WORDPRESS_APPLICATION_PASSWORD: "secret"
    });

    const failed = await app.workflow.run({ topic: "Caching" });

    expect(failed.status).toBe("failed");
    expect(failed.failure).toMatchObject({ step: "publisher", code: "server_error" });
    expect(wordpress.posts).toHaveLength(0);
    expect(rows("SELECT status, failed_step FROM workflows")).toEqual([
      { status: "failed", failed_step: "publisher" }
    ]);
    const callsBefore = llm.prompts.length;

    const resumed = await app.workflow.resume(failed.workflowId!);

    expect(resumed.status).toBe("published");
    expect(llm.prompts).toHaveLength(callsBefore);
    expect(wordpress.posts).toEqual([
      expect.objectContaining({ slug: "caching-made-simple", status: "publish" })
    ]);
    expect(rows("SELECT status FROM workflows")).toEqual([{ status: "published" }]);
  });

  it("regenerates a failing article, then parks it as needs_review without publishing", async () => {
    const llm = routedProvider({
      ...healthy(),
      writer: [tooShortArticle],
      editor: [edited(tooShortArticle)]
    });
    const app = await start(llm, { OPENBLOG_QUALITY_MAX_ATTEMPTS: "1" });

    const result = await app.workflow.run({ topic: "Caching" });

    expect(result.status).toBe("needs_review");
    if (result.status !== "needs_review") throw new Error("unreachable");
    expect(result.violations.map((violation) => violation.code)).toContain("word_count_too_short");
    expect(llm.calls("writer")).toBe(2);
    expect(llm.prompts.filter((entry) => entry.agent === "writer")[1]!.prompt).toContain(
      "rejected by automatic checks"
    );
    expect(fs.existsSync(path.join(dir, "out"))).toBe(false);
    expect(rows("SELECT status, failed_step FROM workflows")).toEqual([
      { status: "needs_review", failed_step: "quality" }
    ]);
    expect(rows("SELECT review_state, gate_passed FROM articles")).toEqual([
      { review_state: "needs_review", gate_passed: 0 }
    ]);
  });

  it("recovers when regeneration fixes the article", async () => {
    const llm = routedProvider({
      ...healthy(),
      writer: [tooShortArticle, goodArticle],
      editor: [edited(tooShortArticle), edited(goodArticle)]
    });
    const app = await start(llm, { OPENBLOG_QUALITY_MAX_ATTEMPTS: "1" });

    const result = await app.workflow.run({ topic: "Caching" });

    expect(result.status).toBe("published");
    expect(llm.calls("writer")).toBe(2);
    expect(fs.existsSync(outputFile())).toBe(true);
  });

  it("blocks a duplicate topic and leaves the first article untouched", async () => {
    const llm = routedProvider(healthy());
    const app = await start(llm);

    const first = await app.workflow.run({ topic: "Caching" });
    expect(first.status).toBe("published");
    const callsAfterFirst = llm.prompts.length;
    const written = fs.readFileSync(outputFile(), "utf8");

    const second = await app.workflow.run({ topic: "Caching" });

    expect(second.status).toBe("duplicate");
    if (second.status !== "duplicate") throw new Error("unreachable");
    expect(second.duplicateOf).toMatchObject({ matchedOn: "topic", workflowId: first.workflowId });
    expect(llm.prompts).toHaveLength(callsAfterFirst);
    expect(fs.readdirSync(path.join(dir, "out"))).toEqual(["caching-made-simple.md"]);
    expect(fs.readFileSync(outputFile(), "utf8")).toBe(written);
    expect(rows("SELECT status FROM workflows ORDER BY rowid")).toEqual([
      { status: "published" },
      { status: "duplicate" }
    ]);
  });

  it("approve flow: parks the article, then publishes it live exactly once", async () => {
    const llm = routedProvider(healthy());
    const app = await start(llm, { OPENBLOG_PUBLICATION_POLICY: "publish_after_approval" });

    const parked = await app.workflow.run({ topic: "Caching" });

    expect(parked.status).toBe("awaiting_approval");
    expect(fs.existsSync(path.join(dir, "out"))).toBe(false);
    expect(rows("SELECT review_state FROM articles")).toEqual([{ review_state: "needs_review" }]);
    const callsBefore = llm.prompts.length;

    const approved = await app.workflow.approve(parked.workflowId!, { approvedBy: "tester" });

    expect(approved.status).toBe("published");
    expect(fs.readFileSync(outputFile(), "utf8")).toContain("status: publish");
    expect(llm.prompts).toHaveLength(callsBefore);
    expect(rows("SELECT review_state, approved_by FROM articles")).toEqual([
      { review_state: "published", approved_by: "tester" }
    ]);
    expect(rows("SELECT status FROM workflows")).toEqual([{ status: "published" }]);
    await expect(
      app.workflow.approve(parked.workflowId!, { approvedBy: "tester" })
    ).rejects.toMatchObject({ code: "already_published" });
  });
  describe("article brief", () => {
    const brief = {
      topic: "Caching",
      audience: "backend engineers",
      tone: "dry and precise",
      targetKeyword: "cache invalidation",
      secondaryKeywords: ["ttl", "cdn"],
      notes: "Mention Redis only once.",
      minWords: 1100,
      maxWords: 2100
    };

    const promptOf = (llm: ReturnType<typeof routedProvider>, agent: string) =>
      llm.prompts.find((entry) => entry.agent === agent)!.prompt;

    it("a topic-only run keeps today's behavior and asks the writer for the gate's range", async () => {
      const llm = routedProvider(healthy());
      const app = await start(llm);

      const result = await app.workflow.run({ topic: "Caching" });

      expect(result.status).toBe("published");
      expect(promptOf(llm, "writer")).toContain("between 1000 and 2200 words");
      for (const agent of ["planner", "writer", "editor", "seo"]) {
        expect(promptOf(llm, agent)).not.toContain("Brief:");
      }
      expect(result.brief).toEqual({
        topic: "Caching",
        language: "en",
        minWords: 1000,
        maxWords: 2200
      });
    });

    it("takes the writer's word range from the quality configuration", async () => {
      const llm = routedProvider(healthy());
      const app = await start(llm, {
        OPENBLOG_QUALITY_MIN_WORDS: "900",
        OPENBLOG_QUALITY_MAX_WORDS: "2500"
      });

      await app.workflow.run({ topic: "Caching" });

      expect(promptOf(llm, "writer")).toContain("between 900 and 2500 words");
    });

    it("puts the brief in the prompts of the agents that use it", async () => {
      const llm = routedProvider(healthy());
      const app = await start(llm);

      const result = await app.workflow.run(brief);

      expect(result.status).toBe("published");
      expect(result.brief).toEqual({ ...brief, language: "en" });
      expect(promptOf(llm, "writer")).toContain("between 1100 and 2100 words");
      for (const agent of ["planner", "writer"]) {
        const prompt = promptOf(llm, agent);
        expect(prompt).toContain("Audience: backend engineers");
        expect(prompt).toContain("Tone: dry and precise");
        expect(prompt).toContain("Target keyword: cache invalidation");
        expect(prompt).toContain("Secondary keywords: ttl, cdn");
        expect(prompt).toContain("Editorial notes: Mention Redis only once.");
      }
      expect(promptOf(llm, "editor")).toContain("Tone: dry and precise");
      expect(promptOf(llm, "editor")).not.toContain("Editorial notes");
      expect(promptOf(llm, "seo")).toContain("Target keyword: cache invalidation");
      expect(promptOf(llm, "seo")).not.toContain("Tone:");
      expect(promptOf(llm, "classification")).not.toContain("Brief:");
    });

    it("holds the article to the brief's word range, not only to the configured one", async () => {
      const llm = routedProvider(healthy());
      const app = await start(llm, { OPENBLOG_QUALITY_MAX_ATTEMPTS: "0" });

      const result = await app.workflow.run({ topic: "Caching", minWords: 100, maxWords: 300 });

      expect(result.status).toBe("needs_review");
      expect(result.status === "needs_review" && result.violations.map((v) => v.code)).toContain(
        "word_count_too_long"
      );
    });

    it("stores the brief with the run and resume follows it", async () => {
      const llm = routedProvider({
        ...healthy(),
        writer: [new Error("provider down"), goodArticle]
      });
      const app = await start(llm);

      const pending = await app.workflow.begin(brief);
      await expect(pending.execute()).rejects.toThrow(/writer step failed/);
      expect(
        JSON.parse(String(rows("SELECT metadata_json FROM workflows")[0]!.metadata_json))
      ).toEqual({ brief: { ...brief, topic: "Caching", language: "en" } });

      const resumed = await app.workflow.resume(pending.workflowId!);

      expect(resumed.status).toBe("published");
      expect(resumed.brief).toEqual({ ...brief, language: "en" });
      const writerPrompts = llm.prompts.filter((entry) => entry.agent === "writer");
      expect(writerPrompts).toHaveLength(2);
      expect(writerPrompts[1]!.prompt).toContain("Target keyword: cache invalidation");
      expect(writerPrompts[1]!.prompt).toContain("between 1100 and 2100 words");
    });

    it("resumes a run stored before briefs existed with just its topic", async () => {
      const llm = routedProvider({
        ...healthy(),
        writer: [new Error("provider down"), goodArticle]
      });
      const app = await start(llm);
      const pending = await app.workflow.begin({ topic: "Caching" });
      await expect(pending.execute()).rejects.toThrow();
      const db = new Database(path.join(dir, "memory.db"));
      db.prepare("UPDATE workflows SET metadata_json = '{}'").run();
      db.close();

      const resumed = await app.workflow.resume(pending.workflowId!);

      expect(resumed.status).toBe("published");
      expect(resumed.brief).toEqual({
        topic: "Caching",
        language: "en",
        minWords: 1000,
        maxWords: 2200
      });
    });

    it("rejects an unusable brief before storing anything or calling a provider", async () => {
      const llm = routedProvider(healthy());
      const app = await start(llm);

      await expect(
        app.workflow.run({ topic: "Caching", minWords: 2000, maxWords: 1000 })
      ).rejects.toThrow(/minWords must not be greater than maxWords/);
      await expect(app.workflow.run({ topic: "Caching", minWords: 3000 })).rejects.toThrow(
        /word range 3000-2200/
      );

      expect(llm.prompts).toHaveLength(0);
      expect(rows("SELECT id FROM workflows")).toEqual([]);
    });
  });
  describe("content language", () => {
    const italianSeo = JSON.stringify({
      title: "Perché la cache conta",
      metaDescription: "Come usare bene la cache.",
      slug: "Perché la cache è così utile!",
      h1: "La cache",
      headings: [{ level: "H2", text: "Perché la cache conta" }]
    });

    const promptOf = (llm: ReturnType<typeof routedProvider>, agent: string) =>
      llm.prompts.find((entry) => entry.agent === agent)!.prompt;

    it("defaults to English and publishes language: en", async () => {
      const llm = routedProvider(healthy());
      const app = await start(llm);

      await app.workflow.run({ topic: "Caching" });

      expect(fs.readFileSync(outputFile(), "utf8")).toMatch(/^language: en$/m);
      for (const agent of ["planner", "writer", "editor", "seo"]) {
        expect(promptOf(llm, agent)).toContain("English (en)");
      }
    });

    it("OPENBLOG_CONTENT_LANGUAGE sets the prompts, the slug and the published language", async () => {
      const llm = routedProvider({ ...healthy(), seo: [italianSeo] });
      const app = await start(llm, { OPENBLOG_CONTENT_LANGUAGE: "it" });

      const result = await app.workflow.run({ topic: "Caching" });

      expect(result.status).toBe("published");
      expect(result.brief?.language).toBe("it");
      for (const agent of ["planner", "writer", "editor", "seo"]) {
        expect(promptOf(llm, agent)).toContain("Italian (it)");
        expect(promptOf(llm, agent)).not.toContain("English (en)");
      }
      expect(result.seoOutput.slug).toBe("perche-la-cache-e-cosi-utile");
      expect(fs.readFileSync(outputFile("perche-la-cache-e-cosi-utile"), "utf8")).toMatch(
        /^language: it$/m
      );
    });

    it("the brief's language overrides the configured one", async () => {
      const llm = routedProvider({ ...healthy(), seo: [italianSeo] });
      const app = await start(llm, { OPENBLOG_CONTENT_LANGUAGE: "de" });

      const result = await app.workflow.run({ topic: "Caching", language: "it" });

      expect(result.brief?.language).toBe("it");
      expect(promptOf(llm, "writer")).toContain("Italian (it)");
      expect(fs.readFileSync(outputFile("perche-la-cache-e-cosi-utile"), "utf8")).toMatch(
        /^language: it$/m
      );
    });

    it("English-only quality rules do not fire on an Italian article", async () => {
      const disclaimer = "\n\nAs a large language model, I cannot browse the web.";
      const llm = routedProvider({
        ...healthy(),
        writer: [goodArticle + disclaimer],
        editor: [edited(goodArticle + disclaimer)]
      });
      const english = await start(llm, { OPENBLOG_QUALITY_MAX_ATTEMPTS: "0" });
      expect((await english.workflow.run({ topic: "Caching" })).status).toBe("needs_review");

      const llmIt = routedProvider({
        ...healthy(),
        writer: [goodArticle + disclaimer],
        editor: [edited(goodArticle + disclaimer)]
      });
      const italian = await start(llmIt, {
        OPENBLOG_QUALITY_MAX_ATTEMPTS: "0",
        OPENBLOG_CONTENT_LANGUAGE: "it",
        OPENBLOG_MEMORY_DB_PATH: path.join(dir, "memory-it.db")
      });
      expect((await italian.workflow.run({ topic: "Caching" })).status).toBe("published");
    });

    it("approve and resume keep the language the run was started with", async () => {
      const llm = routedProvider({ ...healthy(), seo: [italianSeo] });
      const app = await start(llm, { OPENBLOG_PUBLICATION_POLICY: "publish_after_approval" });
      const parked = await app.workflow.run({ topic: "Caching", language: "it" });
      expect(parked.status).toBe("awaiting_approval");

      await app.workflow.approve(parked.workflowId!, { approvedBy: "tester" });

      expect(fs.readFileSync(outputFile("perche-la-cache-e-cosi-utile"), "utf8")).toMatch(
        /^language: it$/m
      );
    });
  });
});
