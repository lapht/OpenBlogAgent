import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApplication, type Application } from "../../packages/app/src";
import { loadEnv } from "../../packages/config/src";
import { goodArticle } from "../fixtures/articles";
import { routedProvider, type Reply } from "../mocks/routed-provider";

const outline = ["Why caching matters", "Choosing a cache strategy", "Invalidation in practice"];
const seo = JSON.stringify({
  title: "Caching made simple",
  metaDescription: "How to cache well.",
  slug: "caching-made-simple",
  h1: "Caching",
  headings: [{ level: "H2", text: "Why caching matters" }]
});
const healthy = () => ({
  planner: [JSON.stringify(outline)] as Reply[],
  writer: [goodArticle] as Reply[],
  editor: [JSON.stringify({ editedText: goodArticle, changesSummary: "tidied" })] as Reply[],
  seo: [seo] as Reply[],
  classification: [JSON.stringify({ category: "News", tags: ["ai"] })] as Reply[]
});

const silent = { info() {}, warn() {}, error() {}, debug() {} };
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

let dir: string;
let promptsDir: string;
let apps: Application[];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "openblog-prompts-"));
  promptsDir = path.join(dir, "prompts");
  fs.mkdirSync(promptsDir);
  apps = [];
});

afterEach(async () => {
  await Promise.all(apps.map((app) => app.dispose()));
  fs.rmSync(dir, { recursive: true, force: true });
});

const env = (extra: Record<string, string> = {}) =>
  loadEnv({
    OPENBLOG_OUTPUT_DIR: path.join(dir, "out"),
    OPENBLOG_MEMORY_DB_PATH: path.join(dir, "memory.db"),
    OPENBLOG_TAXONOMY_CATEGORIES: "News",
    OPENBLOG_TAXONOMY_TAGS: "ai",
    OPENBLOG_PUBLICATION_POLICY: "publish_if_gate_passes",
    OPENBLOG_LOG_LEVEL: "fatal",
    ...extra
  });

async function start(llm: { generate: unknown }, extra: Record<string, string> = {}) {
  const app = await createApplication(env(extra), { llm: llm as never, logger: silent });
  apps.push(app);
  return app;
}

const write = (name: string, text: string) => fs.writeFileSync(path.join(promptsDir, name), text);

function stepHashes(): Record<string, string | null> {
  const db = new Database(path.join(dir, "memory.db"), { readonly: true });
  try {
    const rows = db
      .prepare("SELECT step, prompt_hash FROM workflow_steps ORDER BY rowid")
      .all() as {
      step: string;
      prompt_hash: string | null;
    }[];
    return Object.fromEntries(rows.map((row) => [row.step, row.prompt_hash]));
  } finally {
    db.close();
  }
}

describe("prompt overrides from OPENBLOG_PROMPTS_DIR (offline)", () => {
  it("without the variable the prompts are the built-in ones", async () => {
    const llm = routedProvider(healthy());
    const app = await start(llm);

    const result = await app.workflow.run({ topic: "Caching" });

    expect(result.status).toBe("published");
    expect(llm.prompts[0]!.prompt).toContain("You are a pragmatic content strategist.");
    expect(llm.prompts[1]!.prompt).toContain("You are a clear and concise technical blog writer.");
  });

  it("an override file changes the prompt that reaches the provider; other agents keep theirs", async () => {
    write(
      "writer.md",
      "You are a blog writer with a house style: short, warm, no jargon.\nWrite about {{topic}} for {{brief.audience}}.\n"
    );
    const llm = routedProvider(healthy());
    const app = await start(llm, { OPENBLOG_PROMPTS_DIR: promptsDir });

    const result = await app.workflow.run({ topic: "Caching", audience: "beginners" });

    expect(result.status).toBe("published");
    const writerPrompt = llm.prompts.find((entry) => entry.agent === "writer")!.prompt;
    expect(writerPrompt).toContain("short, warm, no jargon.\nWrite about Caching for beginners.");
    expect(writerPrompt).toContain("- Do not include an H1 title.");
    expect(writerPrompt).not.toContain("Prefer short paragraphs");
    expect(llm.prompts.find((entry) => entry.agent === "editor")!.prompt).toContain(
      "You are an experienced editor."
    );
  });

  it("stores the hash of the prompt each step sent, and a different one when the override differs", async () => {
    write("writer.md", "You are a blog writer. Write about {{topic}} plainly.");
    const llm = routedProvider(healthy());
    const app = await start(llm, { OPENBLOG_PROMPTS_DIR: promptsDir });

    await app.workflow.run({ topic: "Caching" });

    const hashes = stepHashes();
    expect(hashes.writer).toBe(
      sha256(llm.prompts.find((entry) => entry.agent === "writer")!.prompt)
    );
    expect(hashes.planner).toBe(
      sha256(llm.prompts.find((entry) => entry.agent === "planner")!.prompt)
    );
    expect(hashes.duplicate_check).toBeNull();
    expect(hashes.quality).toBeNull();

    const details = await app.getRun((await app.listRuns())[0]!.workflowId);
    expect(details?.steps.find((entry) => entry.step === "writer")?.promptHash).toBe(hashes.writer);

    // The same topic with the built-in writer prompt hashes differently.
    const other = routedProvider(healthy());
    fs.rmSync(path.join(promptsDir, "writer.md"));
    fs.rmSync(path.join(dir, "memory.db"));
    const plain = await start(other, { OPENBLOG_PROMPTS_DIR: promptsDir });
    await plain.workflow.run({ topic: "Caching" });
    expect(stepHashes().writer).not.toBe(hashes.writer);
  });
});

describe("prompt overrides are validated when the application is created", () => {
  const create = () =>
    createApplication(env({ OPENBLOG_PROMPTS_DIR: promptsDir }), {
      llm: routedProvider(healthy()) as never
    });

  it("fails on an unknown placeholder, naming the file", async () => {
    write("seo.md", "Optimize for {{keyword}}.");

    await expect(create()).rejects.toThrow(/seo\.md: .*unknown placeholder \{\{keyword\}\}/);
    expect(fs.existsSync(path.join(dir, "memory.db"))).toBe(false);
  });

  it("fails on a planner or writer override without {{topic}}", async () => {
    write("planner.md", "Plan something good.");

    await expect(create()).rejects.toThrow(/planner\.md: .*must contain \{\{topic\}\}/);
  });

  it("fails on an empty file and on one that cannot be read", async () => {
    write("editor.md", "\n\n");
    await expect(create()).rejects.toThrow(/editor\.md: .*empty/);

    fs.rmSync(path.join(promptsDir, "editor.md"));
    fs.mkdirSync(path.join(promptsDir, "review.md"));
    await expect(create()).rejects.toThrow(/Cannot read the prompt override .*review\.md/);
  });

  it("fails when the directory does not exist", async () => {
    fs.rmSync(promptsDir, { recursive: true });

    await expect(create()).rejects.toThrow(/OPENBLOG_PROMPTS_DIR .* is not a directory/);
  });

  it("starts with an empty directory and falls back to the built-in prompts", async () => {
    const llm = routedProvider(healthy());
    const app = await start(llm, { OPENBLOG_PROMPTS_DIR: promptsDir });

    expect((await app.workflow.run({ topic: "Caching" })).status).toBe("published");
    expect(llm.prompts[0]!.prompt).toContain("You are a pragmatic content strategist.");
  });
});
