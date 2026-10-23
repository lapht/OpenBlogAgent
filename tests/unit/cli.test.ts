import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseCommand, UsageError } from "../../apps/cli/src/args";
import { runCli } from "../../apps/cli/src/run";
import type { PublishArticle } from "../../packages/publishers/src";
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

describe("argument parsing", () => {
  it("parses every command with its options", () => {
    expect(parseCommand(["generate", "My", "topic", "--dry-run", "--json"])).toMatchObject({
      name: "generate",
      topic: "My topic",
      options: { dryRun: true, json: true, force: false }
    });
    expect(parseCommand(["generate", "t", "--publisher", "wordpress", "--force"])).toMatchObject({
      options: { publisher: "wordpress", force: true }
    });
    expect(parseCommand(["resume", "wf-1"])).toMatchObject({ name: "resume", workflowId: "wf-1" });
    expect(parseCommand(["list", "--recover-stale"])).toMatchObject({
      name: "list",
      options: { recoverStale: true }
    });
    expect(() => parseCommand(["resume", "wf-1", "--recover-stale"])).toThrow(
      /only applies to list/
    );
    expect(parseCommand(["approve", "wf-1", "--override", "ok"])).toMatchObject({
      name: "approve",
      options: { override: "ok" }
    });
    expect(parseCommand(["reject", "wf-1", "--reason", " Off brand "])).toMatchObject({
      name: "reject",
      workflowId: "wf-1",
      reason: "Off brand"
    });
    expect(parseCommand(["revise", "wf-1", "--feedback", "Shorter"])).toMatchObject({
      name: "revise",
      workflowId: "wf-1",
      feedback: "Shorter"
    });
    expect(parseCommand(["list"])).toMatchObject({ name: "list" });
    expect(parseCommand(["--help"])).toMatchObject({ name: "help" });
  });

  it.each([
    [[], /Missing command/],
    [["nope"], /Unknown command/],
    [["generate"], /Missing article topic/],
    [["resume"], /exactly one workflow id/],
    [["resume", "a", "b"], /exactly one workflow id/],
    [["list", "x"], /no arguments/],
    [["generate", "t", "--bogus"], /bogus/],
    [["generate", "t", "--publisher"], /publisher/],
    [["generate", "t", "--override", "why"], /--override/],
    [["approve", "wf", "--force"], /--force/],
    [["reject", "wf"], /--reason/],
    [["reject", "wf", "--reason", "  "], /--reason/],
    [["reject", "--reason", "x"], /exactly one workflow id/],
    [["revise", "wf"], /--feedback/],
    [["revise", "wf", "--reason", "x"], /--reason only applies to reject/],
    [["generate", "t", "--feedback", "x"], /--feedback only applies to revise/]
  ])("rejects %j", (argv, message) => {
    expect(() => parseCommand(argv as string[])).toThrow(UsageError);
    expect(() => parseCommand(argv as string[])).toThrow(message);
  });
});

describe("CLI commands", () => {
  let dir: string;
  let out: string[];
  let err: string[];

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "openblog-cli-"));
    out = [];
    err = [];
  });

  afterEach(() => {
    fs.rmSync(dir, { force: true, recursive: true });
  });

  const env = (extra: Record<string, string> = {}) => ({
    OPENBLOG_OUTPUT_DIR: path.join(dir, "out"),
    OPENBLOG_MEMORY_DB_PATH: path.join(dir, "memory.db"),
    OPENBLOG_TAXONOMY_CATEGORIES: "News",
    OPENBLOG_PUBLICATION_POLICY: "publish_if_gate_passes",
    OPENBLOG_QUALITY_MIN_WORDS: "1",
    OPENBLOG_QUALITY_MIN_H2: "0",
    OPENBLOG_QUALITY_MIN_OUTLINE_COVERAGE: "0",
    OPENBLOG_QUALITY_MIN_EDIT_RATIO: "0.0001",
    OPENBLOG_QUALITY_MAX_ATTEMPTS: "0",
    ...extra
  });

  const cli = (
    argv: string[],
    extraEnv: Record<string, string> = {},
    overrides: Parameters<typeof runCli>[0] extends infer O
      ? O extends { overrides?: infer V }
        ? V
        : never
      : never = { llm: scriptedProvider(...replies()) }
  ) =>
    runCli({
      argv,
      env: env(extraEnv),
      overrides,
      stdout: (text) => out.push(text),
      stderr: (text) => err.push(text)
    });

  const lastJson = () => JSON.parse(out.at(-1)!) as Record<string, never>;

  const recordingPublisher = (id = "markdown") => {
    const calls: PublishArticle[] = [];
    return {
      calls,
      id,
      name: "Recorder",
      validate: async () => ({ valid: true, issues: [] }),
      supports: () => true,
      publish: async (article: PublishArticle) => {
        calls.push(article);
        return { success: true, publisherId: id, publisherName: "Recorder" };
      }
    };
  };

  it("--help documents every command and exits 0", async () => {
    expect(await cli(["--help"])).toBe(0);
    for (const word of ["generate", "resume", "approve", "list", "--dry-run", "--publisher"]) {
      expect(out.join()).toContain(word);
    }
    expect(out.join()).toContain("64");
  });

  it("exits 64 with the usage on a bad command line", async () => {
    expect(await cli(["frobnicate"])).toBe(64);
    expect(err.join()).toContain('Unknown command "frobnicate"');
    expect(err.join()).toContain("Usage:");
    expect(out).toEqual([]);
    expect(await cli([])).toBe(64);
  });

  it("exit 0 and a stable --json summary when the article is published", async () => {
    expect(await cli(["generate", "My topic", "--json"])).toBe(0);

    expect(out).toHaveLength(1);
    expect(lastJson()).toEqual({
      command: "generate",
      status: "published",
      exitCode: 0,
      dryRun: false,
      workflowId: expect.any(String),
      topic: "My topic",
      brief: { topic: "My topic", language: "en", minWords: 1, maxWords: 2200 },
      title: "A title",
      slug: "a-title",
      publisherId: "markdown",
      outputPath: path.join(dir, "out", "a-title.md"),
      remoteUrl: null,
      failure: null,
      violations: [],
      review: null
    });
    expect(fs.existsSync(path.join(dir, "out", "a-title.md"))).toBe(true);
  });

  it("exit 1 when the run fails", async () => {
    expect(await cli(["generate", "t", "--json"], {}, { llm: scriptedProvider("not json") })).toBe(
      1
    );
    expect(lastJson()).toMatchObject({ status: "error", exitCode: 1 });
  });

  it("exit 2 when the quality gate parks the article", async () => {
    expect(await cli(["generate", "t", "--json"], { OPENBLOG_QUALITY_MIN_WORDS: "1000" })).toBe(2);
    expect(lastJson()).toMatchObject({ status: "needs_review", exitCode: 2 });
    expect(lastJson().violations.length).toBeGreaterThan(0);
  });

  it("exit 3 for a duplicate topic, unless --force", async () => {
    expect(await cli(["generate", "Same topic"])).toBe(0);

    expect(
      await cli(["generate", "Same topic", "--json"], {}, { llm: scriptedProvider(...replies()) })
    ).toBe(3);
    expect(lastJson()).toMatchObject({ status: "duplicate", exitCode: 3 });
  });

  it("--dry-run never calls a publisher and leaves no trace", async () => {
    const publisher = recordingPublisher();

    const code = await cli(
      ["generate", "Dry topic", "--dry-run", "--json"],
      {},
      { llm: scriptedProvider(...replies()), publishers: [publisher] }
    );

    expect(code).toBe(0);
    expect(publisher.calls).toHaveLength(0);
    expect(lastJson()).toMatchObject({ status: "published", dryRun: true, slug: "a-title" });
    expect(fs.existsSync(path.join(dir, "out"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "memory.db"))).toBe(false);
    expect(
      fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith("openblog-dry-run-"))
    ).toEqual([]);

    // The topic is not burned: a real run afterwards still generates it.
    expect(await cli(["generate", "Dry topic"])).toBe(0);
  });

  it("--dry-run still sees earlier runs", async () => {
    expect(await cli(["generate", "Known topic"])).toBe(0);

    expect(
      await cli(["generate", "Known topic", "--dry-run"], {}, { llm: scriptedProvider("x") })
    ).toBe(3);
  });

  it("--publisher selects the publisher instead of the configured default", async () => {
    const chosen = recordingPublisher("custom");
    const other = recordingPublisher("other");

    const code = await cli(
      ["generate", "t", "--publisher", "custom"],
      { OPENBLOG_DEFAULT_PUBLISHER: "other" },
      { llm: scriptedProvider(...replies()), publishers: [other, chosen] }
    );

    expect(code).toBe(0);
    expect(chosen.calls).toHaveLength(1);
    expect(other.calls).toHaveLength(0);
  });

  it("lists runs, then approves a draft by id", async () => {
    const draft = { OPENBLOG_PUBLICATION_POLICY: "publish_after_approval" };
    expect(await cli(["generate", "Review me", "--json"], draft)).toBe(0);
    const { workflowId } = lastJson();
    expect(lastJson().status).toBe("awaiting_approval");
    expect(fs.existsSync(path.join(dir, "out"))).toBe(false);

    expect(await cli(["list", "--json"])).toBe(0);
    expect(lastJson()).toMatchObject({
      command: "list",
      runs: [
        {
          workflowId,
          topic: "Review me",
          status: "awaiting_approval",
          models: { planner: expect.any(String), writer: expect.any(String) }
        }
      ]
    });
    out.length = 0;
    expect(await cli(["list"])).toBe(0);
    expect(out.join()).toContain(workflowId);

    expect(await cli(["approve", workflowId, "--json"])).toBe(0);
    expect(lastJson()).toMatchObject({ command: "approve", status: "published", workflowId });
    expect(fs.existsSync(path.join(dir, "out", "a-title.md"))).toBe(true);

    expect(await cli(["approve", workflowId, "--json"])).toBe(1);
    expect(lastJson()).toMatchObject({ status: "error", error: { code: "already_published" } });
  });

  it("reject closes a stored article for good", async () => {
    const draft = { OPENBLOG_PUBLICATION_POLICY: "publish_after_approval" };
    await cli(["generate", "Review me", "--json"], draft);
    const { workflowId } = lastJson();

    expect(await cli(["reject", workflowId, "--reason", "Off brand", "--json"])).toBe(0);
    expect(lastJson()).toMatchObject({ command: "reject", status: "rejected", workflowId });

    for (const argv of [
      ["approve", workflowId, "--override", "x"],
      ["revise", workflowId, "--feedback", "x"],
      ["reject", workflowId, "--reason", "x"],
      ["resume", workflowId]
    ]) {
      expect(await cli([...argv, "--json"])).toBe(1);
      expect(lastJson()).toMatchObject({ status: "error", error: { code: "already_rejected" } });
    }
    expect(await cli(["list", "--json"])).toBe(0);
    expect(lastJson()).toMatchObject({ runs: [{ workflowId, status: "rejected" }] });
    expect(fs.existsSync(path.join(dir, "out"))).toBe(false);
  });

  it("revise sends the article back to the writer, then it can be approved", async () => {
    const draft = { OPENBLOG_PUBLICATION_POLICY: "publish_after_approval" };
    await cli(["generate", "Review me", "--json"], draft);
    const { workflowId } = lastJson();
    const writer = scriptedProvider(...replies().slice(1)); // no planner call: the outline is kept

    expect(
      await cli(["revise", workflowId, "--feedback", "Add an example", "--json"], draft, {
        llm: writer
      })
    ).toBe(0);

    expect(lastJson()).toMatchObject({
      command: "revise",
      status: "awaiting_approval",
      workflowId
    });
    expect(writer.prompts).toHaveLength(4);
    expect(writer.prompts[0]).toContain("Add an example");
    expect(await cli(["approve", workflowId, "--json"])).toBe(0);
    expect(lastJson()).toMatchObject({ status: "published" });

    expect(await cli(["revise", workflowId, "--feedback", "x", "--json"])).toBe(1);
    expect(lastJson()).toMatchObject({ error: { code: "already_published" } });
  });

  it("approve --dry-run publishes nothing", async () => {
    const draft = { OPENBLOG_PUBLICATION_POLICY: "publish_after_approval" };
    await cli(["generate", "Review me", "--json"], draft);
    const { workflowId } = lastJson();

    expect(await cli(["approve", workflowId, "--dry-run", "--json"])).toBe(0);
    expect(fs.existsSync(path.join(dir, "out"))).toBe(false);
    // Still approvable for real afterwards.
    expect(await cli(["approve", workflowId])).toBe(0);
  });

  it("resume continues a failed run without repeating its good steps", async () => {
    const failing = scriptedProvider(...replies().slice(0, 3));
    const original = failing.generate.bind(failing);
    failing.generate = async (request) => {
      if (failing.prompts.length === 3) {
        failing.prompts.push(request.prompt);
        throw new Error("provider down");
      }
      return original(request);
    };
    expect(await cli(["generate", "Flaky", "--json"], {}, { llm: failing })).toBe(1);
    expect(lastJson().status).toBe("error");
    expect(await cli(["list", "--json"])).toBe(0);
    const [{ workflowId, status }] = lastJson().runs;
    expect(status).toBe("failed");

    const rest = scriptedProvider(...replies().slice(3));
    expect(await cli(["resume", workflowId, "--json"], {}, { llm: rest })).toBe(0);

    expect(lastJson()).toMatchObject({ command: "resume", status: "published", workflowId });
    expect(rest.prompts).toHaveLength(2); // seo and classification only
  });
});
