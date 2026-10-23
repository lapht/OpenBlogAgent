import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseCommand, UsageError } from "../../apps/cli/src/args";
import { runCli } from "../../apps/cli/src/run";
import { articleBriefSchema } from "../../packages/types/src";
import { scriptedProvider } from "../mocks/scripted-provider";

describe("article brief schema", () => {
  it("accepts a topic alone and a complete brief", () => {
    expect(articleBriefSchema.parse({ topic: "Caching" })).toEqual({ topic: "Caching" });
    const full = {
      topic: "Caching",
      language: "pt-BR",
      audience: "backend engineers",
      tone: "dry",
      targetKeyword: "cache",
      secondaryKeywords: ["ttl", "cdn"],
      minWords: 800,
      maxWords: 1200,
      notes: "Keep it short."
    };
    expect(articleBriefSchema.parse(full)).toEqual(full);
  });

  it("trims text fields", () => {
    expect(articleBriefSchema.parse({ topic: "  Caching ", tone: " calm " })).toEqual({
      topic: "Caching",
      tone: "calm"
    });
  });

  it.each([
    ["a missing topic", {}, /topic/],
    ["an empty topic", { topic: "  " }, /topic/],
    ["an unknown field", { topic: "x", colour: "red" }, /colour/],
    ["a fractional word count", { topic: "x", minWords: 10.5 }, /minWords/],
    ["a negative word count", { topic: "x", maxWords: -1 }, /maxWords/],
    ["an inverted range", { topic: "x", minWords: 20, maxWords: 10 }, /must not be greater/],
    ["a bad language", { topic: "x", language: "english please" }, /language/],
    ["an empty keyword", { topic: "x", secondaryKeywords: [""] }, /secondaryKeywords/]
  ])("rejects %s", (_name, brief, message) => {
    const result = articleBriefSchema.safeParse(brief);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toMatch(message);
  });

  it("allows equal bounds", () => {
    expect(articleBriefSchema.safeParse({ topic: "x", minWords: 10, maxWords: 10 }).success).toBe(
      true
    );
  });
});

describe("brief on the command line", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "openblog-brief-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { force: true, recursive: true });
  });

  const write = (name: string, content: string) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, content);
    return file;
  };

  it("builds the brief from the flags", () => {
    expect(
      parseCommand([
        "generate",
        "Cache",
        "it",
        "--audience",
        "devs",
        "--tone",
        "calm",
        "--keyword",
        "caching",
        "--min-words",
        "800",
        "--max-words",
        "1200",
        "--notes",
        "short",
        "--language",
        "it"
      ])
    ).toMatchObject({
      name: "generate",
      topic: "Cache it",
      brief: {
        topic: "Cache it",
        audience: "devs",
        tone: "calm",
        targetKeyword: "caching",
        minWords: 800,
        maxWords: 1200,
        notes: "short",
        language: "it"
      }
    });
  });

  it("a topic-only command gives a topic-only brief", () => {
    expect(parseCommand(["generate", "Cache"])).toMatchObject({ brief: { topic: "Cache" } });
    expect(parseCommand(["generate", "Cache"]).name === "generate").toBe(true);
    const command = parseCommand(["generate", "Cache"]);
    expect(command.name === "generate" && Object.keys(command.brief)).toEqual(["topic"]);
  });

  it("reads a YAML brief file and lets the flags override it", () => {
    const file = write(
      "brief.yaml",
      [
        "topic: From file",
        "audience: beginners",
        "tone: friendly",
        "secondaryKeywords: [ttl, cdn]",
        "minWords: 500",
        "maxWords: 900"
      ].join("\n")
    );

    const command = parseCommand([
      "generate",
      "--brief",
      file,
      "--tone",
      "formal",
      "--max-words",
      "1000"
    ]);

    expect(command).toMatchObject({
      topic: "From file",
      brief: {
        topic: "From file",
        audience: "beginners",
        tone: "formal",
        secondaryKeywords: ["ttl", "cdn"],
        minWords: 500,
        maxWords: 1000
      }
    });
  });

  it("reads a JSON brief file, and the topic argument overrides the file's", () => {
    const file = write("brief.json", JSON.stringify({ topic: "From file", audience: "ops" }));

    expect(parseCommand(["generate", "On the line", "--brief", file])).toMatchObject({
      topic: "On the line",
      brief: { topic: "On the line", audience: "ops" }
    });
  });

  it.each([
    ["a non-numeric word count", ["--min-words", "many"], /--min-words/],
    ["an inverted range", ["--min-words", "900", "--max-words", "100"], /must not be greater/],
    ["a missing brief file", ["--brief", "/no/such/brief.yaml"], /Cannot read the brief file/]
  ])("rejects %s", (_name, flags, message) => {
    expect(() => parseCommand(["generate", "t", ...flags])).toThrow(UsageError);
    expect(() => parseCommand(["generate", "t", ...flags])).toThrow(message);
  });

  it("rejects a brief file with an unknown field, a bad shape or no topic anywhere", () => {
    const unknown = write("unknown.yaml", "topic: t\ncolour: red\n");
    expect(() => parseCommand(["generate", "--brief", unknown])).toThrow(/colour/);

    const list = write("list.yaml", "- a\n- b\n");
    expect(() => parseCommand(["generate", "--brief", list])).toThrow(/must contain an object/);

    const broken = write("broken.yaml", "topic: [unclosed\n");
    expect(() => parseCommand(["generate", "--brief", broken])).toThrow(/not valid YAML or JSON/);

    const noTopic = write("no-topic.yaml", "audience: devs\n");
    expect(() => parseCommand(["generate", "--brief", noTopic])).toThrow(/Missing article topic/);
  });

  it("brief flags only apply to generate", () => {
    expect(() => parseCommand(["resume", "wf-1", "--tone", "calm"])).toThrow(/--tone/);
    expect(() => parseCommand(["list", "--brief", "x.yaml"])).toThrow(/--brief/);
  });
});

describe("brief through the CLI", () => {
  let dir: string;
  let out: string[];
  let err: string[];

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "openblog-brief-cli-"));
    out = [];
    err = [];
  });
  afterEach(() => {
    fs.rmSync(dir, { force: true, recursive: true });
  });

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

  const cli = (argv: string[], llm = scriptedProvider(...replies())) =>
    runCli({
      argv,
      env: {
        OPENBLOG_OUTPUT_DIR: path.join(dir, "out"),
        OPENBLOG_MEMORY_DB_PATH: path.join(dir, "memory.db"),
        OPENBLOG_TAXONOMY_CATEGORIES: "News",
        OPENBLOG_QUALITY_MIN_WORDS: "1",
        OPENBLOG_QUALITY_MIN_H2: "0",
        OPENBLOG_QUALITY_MIN_OUTLINE_COVERAGE: "0",
        OPENBLOG_QUALITY_MIN_EDIT_RATIO: "0.0001",
        OPENBLOG_QUALITY_MAX_ATTEMPTS: "0"
      },
      overrides: { llm },
      stdout: (text) => out.push(text),
      stderr: (text) => err.push(text)
    });

  it("--dry-run --json shows the effective brief and reaches the prompts", async () => {
    const llm = scriptedProvider(...replies());

    const code = await cli(
      ["generate", "Caching", "--dry-run", "--json", "--audience", "devs", "--max-words", "3000"],
      llm
    );

    expect(code).toBe(0);
    expect(JSON.parse(out.at(-1)!)).toMatchObject({
      dryRun: true,
      brief: { topic: "Caching", audience: "devs", minWords: 1, maxWords: 3000 }
    });
    expect(llm.prompts[0]).toContain("Audience: devs");
    expect(llm.prompts[1]).toContain("between 1 and 3000 words");
  });

  it("prints the effective brief in the human summary", async () => {
    await cli(["generate", "Caching", "--dry-run", "--tone", "calm"]);

    expect(out.join("\n")).toMatch(/brief: tone="calm" language="en" words=1-\d+/);
  });

  it("exits 64 for an invalid brief without calling the provider or storing a run", async () => {
    const llm = scriptedProvider(...replies());

    const code = await cli(["generate", "t", "--min-words", "500", "--max-words", "100"], llm);

    expect(code).toBe(64);
    expect(err.join()).toContain("must not be greater than maxWords");
    expect(llm.prompts).toHaveLength(0);
    expect(fs.existsSync(path.join(dir, "memory.db"))).toBe(false);
  });
});
