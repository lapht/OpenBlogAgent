import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadEnv } from "../../packages/config/src";
import { createApplication, loadStaticTaxonomy } from "../../packages/app/src";
import { runCli } from "../../apps/cli/src/run";
import { scriptedProvider } from "../mocks/scripted-provider";

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
  JSON.stringify({ category: "News", tags: ["alpha"] })
];

describe("createApplication", () => {
  let dir: string;
  const env = (extra: Record<string, string> = {}) =>
    loadEnv({
      OPENBLOG_OUTPUT_DIR: path.join(dir, "out"),
      OPENBLOG_MEMORY_DB_PATH: path.join(dir, "memory.db"),
      OPENBLOG_LOG_LEVEL: "fatal",
      ...extra
    });

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "openblog-app-"));
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  it("builds the workflow from config with a fake llm and publishes a markdown file", async () => {
    const llm = scriptedProvider(...replies());
    const app = await createApplication(
      env({
        OPENBLOG_TAXONOMY_CATEGORIES: "News, Tutorials",
        OPENBLOG_TAXONOMY_TAGS: "alpha,beta"
      }),
      { llm }
    );

    try {
      expect(app.info).toEqual({ publisherIds: ["markdown"], taxonomyProvider: "static" });

      const result = await app.workflow.run({
        article: "",
        category: "",
        outline: [],
        tags: [],
        topic: "Config driven"
      });

      expect(result.category).toBe("News");
      expect(result.publishResult?.success).toBe(true);
      expect(readdirSync(path.join(dir, "out"))).toContain("a-title.md");
      // Taxonomy comes from config, not from code.
      expect(llm.prompts[4]).toContain("1. News");
      expect(llm.prompts[4]).toContain("2. Tutorials");
      expect(llm.prompts[4]).toContain("2. beta");
      expect(llm.prompts[4]).not.toContain("Artificial Intelligence");
    } finally {
      await app.dispose();
    }

    expect(existsSync(path.join(dir, "memory.db"))).toBe(true);
  });

  const wordpress = {
    OPENBLOG_WORDPRESS_ENDPOINT: "https://example.com/wp-json/wp/v2",
    OPENBLOG_WORDPRESS_USERNAME: "user",
    OPENBLOG_WORDPRESS_APPLICATION_PASSWORD: "pw"
  };

  it.each([
    ["markdown + static taxonomy", {}, ["markdown"], "static"],
    ["markdown + wordpress + static taxonomy", wordpress, ["markdown", "wordpress"], "static"],
    [
      "markdown + wordpress + wordpress taxonomy",
      { ...wordpress, OPENBLOG_TAXONOMY_PROVIDER: "wordpress" },
      ["markdown", "wordpress"],
      "wordpress"
    ],
    [
      "wordpress taxonomy without an endpoint falls back to static",
      { OPENBLOG_TAXONOMY_PROVIDER: "wordpress" },
      ["markdown"],
      "static"
    ]
  ])("wires %s", async (_name, extra, publisherIds, taxonomyProvider) => {
    const app = await createApplication(env(extra), { llm: scriptedProvider("x") });

    expect(app.info).toEqual({ publisherIds, taxonomyProvider });
    await app.dispose();
  });

  it("uses injected adapters instead of building them", async () => {
    const memoryCalls: string[] = [];
    const app = await createApplication(env(), {
      llm: scriptedProvider(...replies()),
      publishers: [],
      categoryProvider: {
        list: async () => [{ id: 1, name: "News" }],
        resolve: async () => ({ id: 1, name: "News" })
      },
      tagProvider: { list: async () => [], resolveMany: async () => [] },
      memory: {
        beginWorkflow: async () => {
          memoryCalls.push("begin");
          return { workflowId: "w", isDuplicate: false, duplicateOfWorkflowId: null };
        },
        savePrompt: async () => {},
        markRunning: async () => {},
        finishWorkflow: async ({ status }) => {
          memoryCalls.push(`finish:${status}`);
        },
        recordStep: async () => {},
        failWorkflow: async () => {}
      }
    });

    expect(app.info).toEqual({ publisherIds: [], taxonomyProvider: "custom" });
    await app.workflow.run({ article: "", category: "", outline: [], tags: [], topic: "t" });
    expect(memoryCalls).toEqual(["begin", "finish:failed"]);
    expect(existsSync(path.join(dir, "memory.db"))).toBe(false);
  });

  describe("static taxonomy", () => {
    it("falls back to the default category when nothing is configured", async () => {
      expect(await loadStaticTaxonomy(env({ OPENBLOG_TAXONOMY_DEFAULT_CATEGORY: "Misc" }))).toEqual(
        {
          categories: ["Misc"],
          tags: []
        }
      );
    });

    it("reads a JSON file, and lists from env override it", async () => {
      const file = path.join(dir, "taxonomy.json");
      writeFileSync(file, JSON.stringify({ categories: ["A", "B"], tags: ["x", "X", "y"] }));

      expect(await loadStaticTaxonomy(env({ OPENBLOG_TAXONOMY_FILE: file }))).toEqual({
        categories: ["A", "B"],
        tags: ["x", "y"]
      });
      expect(
        await loadStaticTaxonomy(env({ OPENBLOG_TAXONOMY_FILE: file, OPENBLOG_TAXONOMY_TAGS: "z" }))
      ).toEqual({ categories: ["A", "B"], tags: ["z"] });
    });

    it("reports an unreadable taxonomy file", async () => {
      await expect(
        loadStaticTaxonomy(env({ OPENBLOG_TAXONOMY_FILE: path.join(dir, "missing.json") }))
      ).rejects.toThrow(/OPENBLOG_TAXONOMY_FILE/);
    });
  });
});

describe("CLI entry", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "openblog-cli-"));
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  const env = () => ({
    OPENBLOG_OUTPUT_DIR: path.join(dir, "out"),
    OPENBLOG_MEMORY_DB_PATH: path.join(dir, "memory.db"),
    OPENBLOG_TAXONOMY_CATEGORIES: "News",
    OPENBLOG_LOG_LEVEL: "fatal"
  });

  it("runs a topic end-to-end with a fake provider and exits 0", async () => {
    const code = await runCli({
      argv: ["My", "topic"],
      env: env(),
      overrides: { llm: scriptedProvider(...replies()) }
    });

    expect(code).toBe(0);
    expect(existsSync(path.join(dir, "out", "a-title.md"))).toBe(true);
  });

  it("exits 1 when the workflow fails", async () => {
    const code = await runCli({
      argv: ["topic"],
      env: env(),
      overrides: { llm: scriptedProvider("not json") }
    });

    expect(code).toBe(1);
  });

  it("exits 1 when the topic is missing", async () => {
    const saved = process.env.npm_config_argv;
    delete process.env.npm_config_argv;

    try {
      expect(await runCli({ argv: [], env: env() })).toBe(1);
    } finally {
      if (saved !== undefined) process.env.npm_config_argv = saved;
    }
  });
});
