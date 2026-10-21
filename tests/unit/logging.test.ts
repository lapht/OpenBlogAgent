import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import { createLogger, withLogContext } from "../../packages/logger/src";
import { createArticleGenerationWorkflow } from "../../packages/graph/src/workflows/article-generation-workflow";
import { createSQLiteMemoryService } from "../../packages/storage/src/memory";
import { lenientQuality } from "../mocks/lenient-quality";
import { routedProvider } from "../mocks/routed-provider";

type Line = Record<string, unknown> & { msg: string };

/** A pino destination that keeps the JSON lines it receives. */
function capture() {
  const lines: Line[] = [];
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      for (const text of String(chunk).split("\n").filter(Boolean)) {
        lines.push(JSON.parse(text) as Line);
      }
      callback();
    }
  });
  return { lines, destination };
}

describe("secret redaction", () => {
  it("redacts known secret fields, at any depth we support, and never logs headers", () => {
    const { lines, destination } = capture();
    const log = createLogger({ destination, level: "debug" });

    log.info("provider call", {
      apiKey: "sk-live-123",
      OPENROUTER_API_KEY: "sk-live-456",
      options: { authorization: "Bearer sk-live-789", applicationPassword: "wp pass word" },
      request: { url: "https://x", headers: { Authorization: "Basic abc123" } },
      model: "gpt"
    });

    const text = JSON.stringify(lines);
    for (const secret of ["sk-live-123", "sk-live-456", "sk-live-789", "wp pass word", "abc123"]) {
      expect(text).not.toContain(secret);
    }
    expect(lines[0]).toMatchObject({ apiKey: "[redacted]", model: "gpt" });
  });

  it("serializes HTTP requests without their headers", () => {
    const { lines, destination } = capture();
    const log = createLogger({ destination });
    // Same shape Fastify hands to the `req` serializer.
    const request = { method: "GET", url: "/health", id: "r1", headers: { cookie: "session=1" } };

    log.info("request", { req: request });

    expect(JSON.stringify(lines)).not.toContain("session=1");
    expect(lines[0]).toMatchObject({ req: { method: "GET", url: "/health", id: "r1" } });
  });
});

describe("log context", () => {
  it("adds the run fields to every line written inside, also from code that only knows the logger", () => {
    const { lines, destination } = capture();
    const log = createLogger({ destination });

    log.info("outside");
    withLogContext({ workflowId: "wf-1" }, () => {
      withLogContext({ step: "seo", attempt: 2 }, () => log.warn("retrying", { delayMs: 5 }));
    });

    expect(lines[0]!.workflowId).toBeUndefined();
    expect(lines[1]).toMatchObject({ workflowId: "wf-1", step: "seo", attempt: 2, delayMs: 5 });
  });
});

const outline = ["Intro", "Body", "Conclusion"];
const seo = JSON.stringify({
  title: "A title",
  metaDescription: "d",
  slug: "a-title",
  h1: "H",
  headings: [{ level: "H2", text: "Intro" }]
});
const replies = () => ({
  planner: [JSON.stringify(outline)],
  writer: ["Article body"],
  editor: [JSON.stringify({ editedText: "Edited body", changesSummary: "tidied" })],
  seo: [seo],
  classification: [JSON.stringify({ category: "General", tags: [] })]
});

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("workflow logging", () => {
  const publisher = {
    publish: async () => ({ success: true, publisherId: "fake", publisherName: "Fake" })
  };

  it("tags every line of a run with its workflowId and logs every step's duration", async () => {
    const { lines, destination } = capture();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openblog-log-"));
    dirs.push(dir);
    const handle = await createSQLiteMemoryService({ filePath: path.join(dir, "m.db") });
    const workflow = createArticleGenerationWorkflow({
      logger: createLogger({ destination }),
      llm: {
        id: "fake",
        generate: async (request) => {
          const result = await routedProvider(replies()).generate(request);
          return { ...result, usage: { promptTokens: 4, completionTokens: 6, totalTokens: 10 } };
        }
      },
      quality: lenientQuality,
      publicationPolicy: "publish_if_gate_passes",
      memory: handle.memoryService,
      publisher
    });

    const result = await workflow.run({ topic: "Logs" });

    expect(result.status).toBe("published");
    expect(lines.length).toBeGreaterThan(5);
    expect(lines.filter((line) => line.workflowId !== result.workflowId)).toEqual([]);

    const steps = lines.filter((line) => line.msg === "Step finished");
    expect(steps.map((line) => line.step)).toEqual([
      "planner",
      "writer",
      "editor",
      "seo",
      "duplicate_check",
      "quality",
      "classification",
      "publisher"
    ]);
    for (const line of steps) {
      expect(line).toMatchObject({ outcome: "succeeded", attempt: 1 });
      expect(typeof line.durationMs).toBe("number");
    }

    const calls = lines.filter((line) => line.msg === "LLM call completed");
    expect(calls).toHaveLength(5);
    expect(calls[0]).toMatchObject({ provider: "fake", model: "fake", totalTokens: 10 });
    expect(calls.map((line) => line.step)).toEqual([
      "planner",
      "writer",
      "editor",
      "seo",
      "classification"
    ]);
    await handle.disconnect();
  });

  it("correlates runs without a memory store and keeps concurrent runs apart", async () => {
    const { lines, destination } = capture();
    const workflow = createArticleGenerationWorkflow({
      logger: createLogger({ destination }),
      llm: routedProvider(replies()),
      quality: lenientQuality,
      publicationPolicy: "publish_if_gate_passes",
      publisher
    });

    await Promise.all([workflow.run({ topic: "One" }), workflow.run({ topic: "Two" })]);

    const ids = new Set(lines.map((line) => line.workflowId));
    expect(ids.size).toBe(2);
    expect(ids.has(undefined)).toBe(false);
    for (const id of ids) {
      const topics = new Set(lines.filter((line) => line.workflowId === id).map((l) => l.topic));
      topics.delete(undefined);
      expect(topics.size).toBe(1);
    }
  });

  it("logs a failed step with its error, then counts the attempt on resume", async () => {
    const { lines, destination } = capture();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openblog-log-"));
    dirs.push(dir);
    const handle = await createSQLiteMemoryService({ filePath: path.join(dir, "m.db") });
    const workflow = createArticleGenerationWorkflow({
      logger: createLogger({ destination }),
      llm: routedProvider({ ...replies(), seo: [new Error("provider down"), seo] }),
      quality: lenientQuality,
      publicationPolicy: "publish_if_gate_passes",
      memory: handle.memoryService,
      publisher
    });

    await expect(workflow.run({ topic: "Flaky" })).rejects.toThrow(/provider down/);
    const failed = lines.find((line) => line.msg === "Step finished" && line.outcome === "failed");
    expect(failed).toMatchObject({
      step: "seo",
      attempt: 1,
      error: expect.stringContaining("down")
    });
    const workflowId = failed!.workflowId as string;

    await workflow.resume(workflowId);

    const retried = lines.filter((line) => line.msg === "Step finished" && line.step === "seo");
    expect(retried.map((line) => [line.attempt, line.outcome])).toEqual([
      [1, "failed"],
      [2, "succeeded"]
    ]);
    expect(lines.filter((line) => line.workflowId !== workflowId)).toEqual([]);
    await handle.disconnect();
  });
});
