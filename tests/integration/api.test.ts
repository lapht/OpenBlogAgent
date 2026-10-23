import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApplication } from "../../packages/app/src";
import { loadEnv } from "../../packages/config/src";
import { buildServer } from "../../apps/server/src/app";

const API_KEY = "test-key-123";
const auth = { authorization: `Bearer ${API_KEY}` };

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

/** Replays one reply per call; the call numbers in `failOn` throw instead; `gate` holds every call until released. */
function fakeProvider(
  options: { failOn?: number[]; gate?: Promise<void>; script?: string[] } = {}
) {
  let calls = 0;
  let cursor = 0;
  const script = options.script ?? replies();
  return {
    id: "fake",
    get calls() {
      return calls;
    },
    async generate() {
      calls += 1;
      await options.gate;
      if (options.failOn?.includes(calls)) {
        throw new Error(`provider down on call ${calls}`);
      }
      return { text: script[cursor++]!, model: "fake", usage: { totalTokens: 10 } };
    }
  };
}

describe("HTTP API", () => {
  let dir: string;
  const open: Array<{ close(): Promise<unknown> }> = [];

  const env = () =>
    loadEnv({
      OPENBLOG_OUTPUT_DIR: path.join(dir, "out"),
      OPENBLOG_MEMORY_DB_PATH: path.join(dir, "memory.db"),
      OPENBLOG_LOG_LEVEL: "fatal",
      OPENBLOG_TAXONOMY_CATEGORIES: "News, Tutorials",
      OPENBLOG_TAXONOMY_TAGS: "alpha,beta",
      OPENBLOG_QUALITY_MIN_WORDS: "1",
      OPENBLOG_QUALITY_MIN_H2: "0",
      OPENBLOG_QUALITY_MIN_OUTLINE_COVERAGE: "0",
      OPENBLOG_QUALITY_MIN_EDIT_RATIO: "0.0001",
      OPENBLOG_QUALITY_MAX_ATTEMPTS: "0"
    });

  async function server(
    llm: ReturnType<typeof fakeProvider>,
    options: Parameters<typeof buildServer>[0] = { apiKey: API_KEY }
  ) {
    const application = await createApplication(env(), { llm });
    const app = await buildServer({ application, ...options });
    open.push(app);
    return app;
  }

  async function waitForRun(app: Awaited<ReturnType<typeof server>>, id: string) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const response = await app.inject({ method: "GET", url: `/runs/${id}`, headers: auth });
      const run = response.json();
      if (!["started", "running"].includes(run.status)) return run;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`run ${id} did not finish`);
  }

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "openblog-api-"));
  });

  afterEach(async () => {
    await Promise.all(open.splice(0).map((app) => app.close()));
    rmSync(dir, { force: true, recursive: true });
  });

  it("rejects unauthenticated requests but keeps /health public", async () => {
    const app = await server(fakeProvider());

    for (const headers of [{}, { authorization: "Bearer wrong" }, { "x-api-key": "wrong" }]) {
      const response = await app.inject({ method: "GET", url: "/runs", headers });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ code: "unauthorized" });
    }
    const post = await app.inject({ method: "POST", url: "/runs", payload: { topic: "x" } });
    expect(post.statusCode).toBe(401);

    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    expect(
      (await app.inject({ method: "GET", url: "/runs", headers: { "x-api-key": API_KEY } }))
        .statusCode
    ).toBe(200);
  });

  it("refuses every run request when no API key is configured", async () => {
    const app = await server(fakeProvider(), {});

    const response = await app.inject({ method: "GET", url: "/runs", headers: auth });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: "api_disabled" });
  });

  it("starts a run, reports its steps and lists it, like a CLI run", async () => {
    const llm = fakeProvider();
    const app = await server(llm);

    const started = await app.inject({
      method: "POST",
      url: "/runs",
      headers: auth,
      payload: { topic: "Over HTTP" }
    });
    expect(started.statusCode).toBe(202);
    const { workflowId } = started.json();

    const run = await waitForRun(app, workflowId);
    expect(run.errorMessage).toBeNull();
    expect(run).toMatchObject({
      workflowId,
      topic: "Over HTTP",
      status: "awaiting_approval",
      totalTokens: 50
    });
    expect(run.steps.map((step: { step: string }) => step.step)).toEqual([
      "planner",
      "writer",
      "editor",
      "seo",
      "duplicate_check",
      "quality",
      "classification",
      "publisher"
    ]);
    expect(existsSync(path.join(dir, "out", "a-title.md"))).toBe(true);
    // The model each step used, as reported by the provider (null where no call was made).
    expect(run.steps.map((step: { model: string | null }) => step.model)).toEqual([
      "fake",
      "fake",
      "fake",
      "fake",
      null,
      null,
      "fake",
      null
    ]);
    expect(run.models).toEqual({
      planner: "fake",
      writer: "fake",
      editor: "fake",
      seo: "fake",
      classification: "fake"
    });

    const list = await app.inject({ method: "GET", url: "/runs", headers: auth });
    expect(list.json().runs).toEqual([
      expect.objectContaining({ workflowId, topic: "Over HTTP", models: run.models })
    ]);
  });

  it("approves a stored article once", async () => {
    const app = await server(fakeProvider());
    const { workflowId } = (
      await app.inject({ method: "POST", url: "/runs", headers: auth, payload: { topic: "T" } })
    ).json();
    await waitForRun(app, workflowId);

    const approved = await app.inject({
      method: "POST",
      url: `/runs/${workflowId}/approve`,
      headers: auth,
      payload: { approvedBy: "ci" }
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({ workflowId, slug: "a-title", status: "published" });

    const again = await app.inject({
      method: "POST",
      url: `/runs/${workflowId}/approve`,
      headers: auth
    });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: "already_published" });

    const missing = await app.inject({
      method: "POST",
      url: "/runs/nope/approve",
      headers: auth
    });
    expect(missing.statusCode).toBe(404);
  });

  it("rejects a stored article for good and shows the decision", async () => {
    const llm = fakeProvider();
    const app = await server(llm);
    const { workflowId } = (
      await app.inject({ method: "POST", url: "/runs", headers: auth, payload: { topic: "R" } })
    ).json();
    expect((await waitForRun(app, workflowId)).status).toBe("awaiting_approval");
    const post = (action: string, payload: object) =>
      app.inject({ method: "POST", url: `/runs/${workflowId}/${action}`, headers: auth, payload });

    expect((await post("reject", {})).statusCode).toBe(400);
    expect((await post("reject", { reason: "x", extra: 1 })).statusCode).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/runs/nope/reject",
          headers: auth,
          payload: { reason: "x" }
        })
      ).statusCode
    ).toBe(404);

    const rejected = await post("reject", { reason: "Off brand", rejectedBy: "alice" });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json()).toEqual({ workflowId, status: "rejected" });

    const run = await waitForRun(app, workflowId);
    expect(run.status).toBe("rejected");
    expect(run.decisions).toEqual([
      expect.objectContaining({ action: "reject", actor: "alice", note: "Off brand" })
    ]);
    expect(run.decisions[0].createdAt).toBeTruthy();
    for (const [action, payload] of [
      ["reject", { reason: "again" }],
      ["revise", { feedback: "again" }],
      ["approve", { overrideReason: "x" }],
      ["resume", {}]
    ] as const) {
      const response = await post(action, payload);
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: "already_rejected" });
    }
    expect(llm.calls).toBe(5);
  });

  it("revises a stored article through the queue, then approves it", async () => {
    const script = [...replies(), ...replies().slice(1)];
    const app = await server(fakeProvider({ script }));
    const { workflowId } = (
      await app.inject({ method: "POST", url: "/runs", headers: auth, payload: { topic: "V" } })
    ).json();
    expect((await waitForRun(app, workflowId)).status).toBe("awaiting_approval");
    const revise = (payload: object) =>
      app.inject({
        method: "POST",
        url: `/runs/${workflowId}/revise`,
        headers: auth,
        payload
      });

    expect((await revise({})).statusCode).toBe(400);
    expect((await revise({ feedback: "" })).statusCode).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/runs/nope/revise",
          headers: auth,
          payload: { feedback: "x" }
        })
      ).statusCode
    ).toBe(404);

    const accepted = await revise({ feedback: "Add an example", revisedBy: "alice" });
    expect(accepted.statusCode).toBe(202);
    expect(accepted.json()).toEqual({ workflowId, status: "started" });

    let run = await waitForRun(app, workflowId);
    for (let attempt = 0; attempt < 200 && run.decisions.length === 0; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      run = await waitForRun(app, workflowId);
    }
    expect(run.errorMessage).toBeNull();
    expect(run.status).toBe("awaiting_approval");
    expect(run.decisions).toEqual([
      expect.objectContaining({ action: "revise", actor: "alice", note: "Add an example" })
    ]);
    expect(
      run.steps
        .filter((step: { step: string }) => step.step === "writer")
        .map((s: { attempt: number }) => s.attempt)
    ).toEqual([1, 2]);

    const approve = await app.inject({
      method: "POST",
      url: `/runs/${workflowId}/approve`,
      headers: auth
    });
    expect(approve.statusCode).toBe(200);
    // A published run cannot be revised.
    const late = await revise({ feedback: "too late" });
    expect(late.statusCode).toBe(409);
    expect(late.json()).toMatchObject({ code: "already_published" });
  });

  it("validates the request body", async () => {
    const app = await server(fakeProvider());

    for (const payload of [{}, { topic: "" }, { topic: "x", extra: 1 }]) {
      const response = await app.inject({ method: "POST", url: "/runs", headers: auth, payload });
      expect(response.statusCode).toBe(400);
    }
  });

  it("resumes a failed run in the background", async () => {
    const app = await server(fakeProvider({ failOn: [4] })); // the seo step fails once
    const { workflowId } = (
      await app.inject({ method: "POST", url: "/runs", headers: auth, payload: { topic: "T" } })
    ).json();
    expect((await waitForRun(app, workflowId)).status).toBe("failed");

    const resumed = await app.inject({
      method: "POST",
      url: `/runs/${workflowId}/resume`,
      headers: auth
    });
    expect(resumed.statusCode).toBe(202);
    expect((await waitForRun(app, workflowId)).status).toBe("awaiting_approval");

    expect(
      (await app.inject({ method: "POST", url: "/runs/nope/resume", headers: auth })).statusCode
    ).toBe(404);
  });

  it("answers 429 when the queue is full and 409 for a run already in progress", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const app = await server(fakeProvider({ gate }), {
      apiKey: API_KEY,
      queue: { concurrency: 1, maxQueued: 0 }
    });

    const first = await app.inject({
      method: "POST",
      url: "/runs",
      headers: auth,
      payload: { topic: "First" }
    });
    expect(first.statusCode).toBe(202);

    const second = await app.inject({
      method: "POST",
      url: "/runs",
      headers: auth,
      payload: { topic: "Second" }
    });
    expect(second.statusCode).toBe(429);
    expect(second.json()).toMatchObject({ code: "queue_full" });
    expect(second.headers["retry-after"]).toBeDefined();

    const resume = await app.inject({
      method: "POST",
      url: `/runs/${first.json().workflowId}/resume`,
      headers: auth
    });
    expect(resume.statusCode).toBe(409);

    release();
    expect((await waitForRun(app, first.json().workflowId)).status).toBe("awaiting_approval");
  });

  it("sends no CORS headers unless origins are configured", async () => {
    const closed = await server(fakeProvider());
    const open1 = await closed.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "https://evil.example" }
    });
    expect(open1.headers["access-control-allow-origin"]).toBeUndefined();

    const allowed = await server(fakeProvider(), {
      apiKey: API_KEY,
      corsOrigins: ["https://app.example"]
    });
    const ok = await allowed.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "https://app.example" }
    });
    expect(ok.headers["access-control-allow-origin"]).toBe("https://app.example");
    const other = await allowed.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "https://evil.example" }
    });
    expect(other.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("publishes an OpenAPI document describing the run endpoints", async () => {
    const app = await server(fakeProvider());

    const response = await app.inject({ method: "GET", url: "/openapi.json" });

    expect(response.statusCode).toBe(200);
    expect(Object.keys(response.json().paths)).toEqual(
      expect.arrayContaining([
        "/runs",
        "/runs/{id}",
        "/runs/{id}/resume",
        "/runs/{id}/approve",
        "/runs/{id}/reject",
        "/runs/{id}/revise"
      ])
    );
  });
  it("accepts the brief fields when starting a run", async () => {
    const llm = fakeProvider();
    const app = await server(llm);

    const started = await app.inject({
      method: "POST",
      url: "/runs",
      headers: auth,
      payload: {
        topic: "With a brief",
        audience: "beginners",
        secondaryKeywords: ["ttl"],
        minWords: 1,
        maxWords: 5000
      }
    });
    expect(started.statusCode).toBe(202);

    const run = await waitForRun(app, started.json().workflowId);
    expect(run.status).toBe("awaiting_approval");
  });

  it.each([
    ["an unknown field", { topic: "x", colour: "red" }],
    ["an empty topic", { topic: "" }],
    ["a non-numeric word count", { topic: "x", minWords: "many" }],
    ["an inverted word range", { topic: "x", minWords: 2000, maxWords: 1000 }],
    ["a bad language code", { topic: "x", language: "not a language" }]
  ])("rejects %s with 400 before calling the provider", async (_name, payload) => {
    const llm = fakeProvider();
    const app = await server(llm);

    const response = await app.inject({ method: "POST", url: "/runs", headers: auth, payload });

    expect(response.statusCode).toBe(400);
    expect(llm.calls).toBe(0);
    const runs = await app.inject({ method: "GET", url: "/runs", headers: auth });
    expect(runs.json().runs).toEqual([]);
  });

  it("documents the brief fields in the OpenAPI document", async () => {
    const app = await server(fakeProvider());

    const spec = (await app.inject({ method: "GET", url: "/openapi.json" })).json();

    const body = spec.paths["/runs"].post.requestBody.content["application/json"].schema;
    expect(Object.keys(body.properties)).toEqual(
      expect.arrayContaining([
        "topic",
        "language",
        "audience",
        "tone",
        "targetKeyword",
        "secondaryKeywords",
        "minWords",
        "maxWords",
        "notes"
      ])
    );
  });
});
