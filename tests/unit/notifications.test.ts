import fs from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApplication, type Application } from "../../packages/app/src";
import { SECRET_ENV_KEYS, loadEnv } from "../../packages/config/src";
import { REDACT_PATHS } from "../../packages/logger/src";
import {
  buildPayload,
  createWebhookNotifier,
  runUrl,
  type Notifier,
  type RunNotification
} from "../../packages/notify/src";
import { goodArticle } from "../fixtures/articles";
import { routedProvider, type Reply } from "../mocks/routed-provider";

const SECRET_URL = "https://hooks.slack.test/services/T0/B0/SECRET-TOKEN";

const notification = (overrides: Partial<RunNotification> = {}): RunNotification => ({
  event: "awaiting_approval",
  workflowId: "wf-1",
  topic: "Caching",
  title: "Caching made simple",
  status: "awaiting_approval",
  ...overrides
});

/** A logger that keeps every line, to look for leaks. */
function recordingLogger() {
  const lines: string[] = [];
  const write = (level: string) => (message: string, context?: Record<string, unknown>) =>
    void lines.push(JSON.stringify({ level, message, ...context }));
  return {
    lines,
    info: write("info"),
    warn: write("warn"),
    error: write("error"),
    debug: write("debug")
  };
}

function okResponse(status = 200): Response {
  return new Response("ok", { status });
}

describe("webhook payloads", () => {
  const occurredAt = new Date("2026-10-24T08:00:00Z");

  it("has a stable generic shape with a link to the run", () => {
    expect(
      buildPayload(notification(), "generic", { baseUrl: "https://blog.test:3000/", occurredAt })
    ).toEqual({
      source: "openblog",
      event: "awaiting_approval",
      workflowId: "wf-1",
      topic: "Caching",
      title: "Caching made simple",
      status: "awaiting_approval",
      errorCode: null,
      errorMessage: null,
      url: "https://blog.test:3000/runs/wf-1",
      occurredAt: "2026-10-24T08:00:00.000Z"
    });
  });

  it("has no link without a base URL or a run", () => {
    expect(buildPayload(notification(), "generic", { occurredAt }).url).toBeNull();
    expect(runUrl("https://x.test", undefined)).toBeNull();
    expect(runUrl("https://x.test/", "a b")).toBe("https://x.test/runs/a%20b");
  });

  it("writes Slack and Discord messages with the reason and the link", () => {
    const failed = notification({
      event: "failed",
      status: "failed",
      errorCode: "fetch_http_error",
      errorMessage: "Server answered 404"
    });
    const options = { baseUrl: "https://blog.test", occurredAt };
    const slack = buildPayload(failed, "slack", options) as { text: string };
    const discord = buildPayload(failed, "discord", options) as { content: string };

    for (const text of [slack.text, discord.content]) {
      expect(text).toContain("A run failed: Caching made simple");
      expect(text).toContain("Reason: fetch_http_error: Server answered 404");
      expect(text).toContain("https://blog.test/runs/wf-1");
    }
    expect(Object.keys(slack)).toEqual(["text"]);
    expect(Object.keys(discord)).toEqual(["content"]);
  });

  it("keeps long reasons and Discord messages bounded", () => {
    const long = notification({ event: "failed", errorMessage: "x".repeat(5000) });
    expect(
      (buildPayload(long, "generic", { occurredAt }).errorMessage as string).length
    ).toBeLessThanOrEqual(300);
    expect(
      (buildPayload(long, "discord", { occurredAt }) as { content: string }).content.length
    ).toBeLessThanOrEqual(1900);
  });
});

describe("webhook delivery", () => {
  const make = (
    calls: Array<{ url: string; body: string }>,
    answers: Array<Response | Error>,
    extra: Partial<Parameters<typeof createWebhookNotifier>[0]> = {}
  ) => {
    const delays: number[] = [];
    const logger = recordingLogger();
    const notifier = createWebhookNotifier({
      url: SECRET_URL,
      logger,
      sleep: async (ms) => void delays.push(ms),
      clock: () => new Date("2026-10-24T08:00:00Z"),
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, body: String(init.body) });
        const answer = answers[Math.min(calls.length, answers.length) - 1]!;
        if (answer instanceof Error) throw answer;
        return answer;
      }) as never,
      ...extra
    });
    return { notifier, delays, logger };
  };

  it("posts the JSON once for a configured event", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const { notifier, logger } = make(calls, [okResponse()]);

    await notifier.notify(notification());

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(SECRET_URL);
    expect(JSON.parse(calls[0]!.body)).toMatchObject({
      event: "awaiting_approval",
      workflowId: "wf-1"
    });
    expect(logger.lines.join("\n")).toContain('"host":"hooks.slack.test"');
  });

  it("sends only the events it is configured for, by default the ones that wait for a person", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const { notifier } = make(calls, [okResponse()]);

    for (const event of [
      "awaiting_approval",
      "needs_review",
      "failed",
      "budget_exceeded",
      "published",
      "duplicate",
      "schedule_limit_reached"
    ] as const) {
      await notifier.notify(notification({ event }));
    }
    expect(calls.map((call) => JSON.parse(call.body).event)).toEqual([
      "awaiting_approval",
      "needs_review",
      "failed",
      "budget_exceeded"
    ]);

    const only: Array<{ url: string; body: string }> = [];
    const published = make(only, [okResponse()], { events: ["published"] });
    await published.notifier.notify(notification({ event: "failed" }));
    await published.notifier.notify(notification({ event: "published" }));
    expect(only).toHaveLength(1);
  });

  it("retries 5xx, 429 and network errors with a growing delay, then succeeds", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const { notifier, delays } = make(calls, [
      okResponse(503),
      new Error("socket hang up"),
      okResponse(200)
    ]);

    await notifier.notify(notification());

    expect(calls).toHaveLength(3);
    expect(delays).toEqual([500, 1000]);

    const limited: Array<{ url: string; body: string }> = [];
    await make(limited, [okResponse(429), okResponse(200)]).notifier.notify(notification());
    expect(limited).toHaveLength(2);
  });

  it("does not retry a refusal", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const { notifier, logger } = make(calls, [okResponse(404)]);

    await notifier.notify(notification());

    expect(calls).toHaveLength(1);
    expect(logger.lines.join("\n")).toContain("Notification failed");
    expect(logger.lines.join("\n")).toContain("HTTP 404");
  });

  it("gives up after the attempts, without throwing and without the URL in the logs", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const { notifier, logger } = make(calls, [
      new Error(`request to ${SECRET_URL} failed, reason: ECONNREFUSED`)
    ]);

    await expect(notifier.notify(notification())).resolves.toBeUndefined();

    expect(calls).toHaveLength(3);
    const logs = logger.lines.join("\n");
    expect(logs).toContain("Notification failed");
    expect(logs).toContain("ECONNREFUSED");
    expect(logs).not.toContain("SECRET-TOKEN");
    expect(logs).not.toContain("/services/");
  });

  it("times out a webhook that never answers", async () => {
    const logger = recordingLogger();
    const notifier = createWebhookNotifier({
      url: SECRET_URL,
      logger,
      timeoutMs: 20,
      maxAttempts: 2,
      sleep: async () => undefined,
      fetch: ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener("abort", () => reject(new Error("aborted")));
        })) as never
    });

    await notifier.notify(notification());

    expect(logger.lines.join("\n")).toContain("timed out after 20ms");
  });

  it("posts to a real server", async () => {
    const received: Array<{ method?: string; type?: string; body: string }> = [];
    const server = await listen((request, respond) => {
      let body = "";
      request.on("data", (chunk) => (body += chunk));
      request.on("end", () => {
        received.push({ method: request.method, type: request.headers["content-type"], body });
        respond(204);
      });
    });
    try {
      await createWebhookNotifier({
        url: `${server.url}/hook/secret`,
        logger: recordingLogger()
      }).notify(notification());
      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({ method: "POST", type: "application/json" });
      expect(JSON.parse(received[0]!.body).workflowId).toBe("wf-1");
    } finally {
      await server.close();
    }
  });
});

describe("configuration", () => {
  it("defaults to the events that wait for a person, in generic format, with no webhook", () => {
    const config = loadEnv({});
    expect(config.OPENBLOG_NOTIFY_EVENTS).toEqual([
      "awaiting_approval",
      "needs_review",
      "failed",
      "budget_exceeded"
    ]);
    expect(config.OPENBLOG_NOTIFY_FORMAT).toBe("generic");
    expect(config.OPENBLOG_NOTIFY_WEBHOOK_URL).toBeUndefined();
  });

  it("parses a list, a format and a base URL", () => {
    const config = loadEnv({
      OPENBLOG_NOTIFY_WEBHOOK_URL: SECRET_URL,
      OPENBLOG_NOTIFY_EVENTS: " published , schedule_limit_reached ",
      OPENBLOG_NOTIFY_FORMAT: "slack",
      OPENBLOG_NOTIFY_BASE_URL: "https://blog.test"
    });
    expect(config.OPENBLOG_NOTIFY_EVENTS).toEqual(["published", "schedule_limit_reached"]);
    expect(config.OPENBLOG_NOTIFY_FORMAT).toBe("slack");
  });

  it("rejects an unknown event, a bad format and a non-http URL", () => {
    for (const bad of [
      { OPENBLOG_NOTIFY_EVENTS: "awaiting_approval,exploded" },
      { OPENBLOG_NOTIFY_FORMAT: "teams" },
      { OPENBLOG_NOTIFY_WEBHOOK_URL: "ftp://x.test/hook" },
      { OPENBLOG_NOTIFY_WEBHOOK_URL: "not a url" }
    ]) {
      expect(() => loadEnv(bad)).toThrow();
    }
  });

  it("treats the webhook URL as a secret", () => {
    expect(SECRET_ENV_KEYS).toContain("OPENBLOG_NOTIFY_WEBHOOK_URL");
    expect(REDACT_PATHS).toContain("webhookUrl");
    expect(REDACT_PATHS).toContain("*.OPENBLOG_NOTIFY_WEBHOOK_URL");
  });
});

interface Listening {
  url: string;
  close(): Promise<void>;
}

function listen(
  handler: (request: import("node:http").IncomingMessage, respond: (status: number) => void) => void
): Promise<Listening> {
  return new Promise((resolve) => {
    const server: Server = createServer((request, response) =>
      handler(request, (status) => {
        response.writeHead(status);
        response.end();
      })
    );
    server.listen(0, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          })
      });
    });
  });
}

describe("notifications from runs", () => {
  const outline = ["Why caching matters", "Choosing a cache strategy", "Invalidation in practice"];
  const seo = JSON.stringify({
    title: "Caching made simple",
    metaDescription: "Caching made simple: how to cache well.",
    slug: "caching-made-simple",
    h1: "Caching",
    headings: [{ level: "H2", text: "Why caching matters" }]
  });
  const healthy = (): Record<
    "planner" | "writer" | "editor" | "seo" | "classification",
    Reply[]
  > => ({
    planner: [JSON.stringify(outline)],
    writer: [goodArticle],
    editor: [JSON.stringify({ editedText: goodArticle, changesSummary: "tidied" })],
    seo: [seo],
    classification: [JSON.stringify({ category: "News", tags: ["ai"] })]
  });

  const silent = { info() {}, warn() {}, error() {}, debug() {} };
  let dir: string;
  let app: Application | undefined;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "openblog-notify-"));
  });

  afterEach(async () => {
    await app?.dispose();
    app = undefined;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function start(
    llm: ReturnType<typeof routedProvider>,
    overrides: { notifier?: Notifier; clock?: () => Date } = {},
    env: Record<string, string> = {}
  ) {
    app = await createApplication(
      loadEnv({
        OPENBLOG_OUTPUT_DIR: path.join(dir, "out"),
        OPENBLOG_MEMORY_DB_PATH: path.join(dir, "memory.db"),
        OPENBLOG_TAXONOMY_CATEGORIES: "News",
        OPENBLOG_TAXONOMY_TAGS: "ai",
        OPENBLOG_LOG_LEVEL: "fatal",
        ...env
      }),
      { llm: llm as never, logger: silent, ...overrides }
    );
    return app;
  }

  const recorder = () => {
    const seen: RunNotification[] = [];
    const notifier: Notifier = { notify: async (n) => void seen.push(n) };
    return { seen, notifier };
  };

  it("tells once when an article awaits approval", async () => {
    const { seen, notifier } = recorder();
    const application = await start(routedProvider(healthy()), { notifier });

    const result = await application.workflow.run({ topic: "Caching" });

    expect(result.status).toBe("awaiting_approval");
    expect(seen).toEqual([
      {
        event: "awaiting_approval",
        workflowId: result.workflowId,
        topic: "Caching",
        title: "Caching made simple",
        status: "awaiting_approval"
      }
    ]);
  });

  it("tells when the quality gate parks an article", async () => {
    const { seen, notifier } = recorder();
    const queues = healthy();
    queues.writer = ["too short"];
    queues.editor = [JSON.stringify({ editedText: "too short", changesSummary: "-" })];
    const application = await start(
      routedProvider(queues),
      { notifier },
      {
        OPENBLOG_QUALITY_MAX_ATTEMPTS: "0"
      }
    );

    await application.workflow.run({ topic: "Caching" });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      event: "needs_review",
      status: "needs_review",
      errorCode: "quality_gate_failed"
    });
  });

  it("tells when a run fails and rethrows the same error", async () => {
    const { seen, notifier } = recorder();
    const queues = healthy();
    queues.planner = [new Error("planner down")];
    const application = await start(routedProvider(queues), { notifier });

    await expect(application.workflow.run({ topic: "Caching" })).rejects.toThrow(/planner down/);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ event: "failed", status: "failed", topic: "Caching" });
    expect(seen[0]!.errorMessage).toContain("planner down");
  });

  it("tells when the budget stops a run", async () => {
    const { seen, notifier } = recorder();
    const application = await start(
      routedProvider(healthy()),
      { notifier },
      {
        OPENBLOG_MAX_TOKENS_PER_RUN: "5"
      }
    );

    await expect(application.workflow.run({ topic: "Caching" })).rejects.toThrow();

    expect(seen.map((n) => [n.event, n.errorCode])).toEqual([
      ["budget_exceeded", "budget_exceeded"]
    ]);
  });

  it("tells about a duplicate and about a published article", async () => {
    const { seen, notifier } = recorder();
    const application = await start(
      routedProvider(healthy()),
      { notifier },
      { OPENBLOG_PUBLICATION_POLICY: "publish_if_gate_passes" }
    );

    await application.workflow.run({ topic: "Caching" });
    await application.workflow.run({ topic: "Caching" });

    expect(seen.map((n) => n.event)).toEqual(["published", "duplicate"]);
    expect(seen[1]).toMatchObject({ status: "duplicate", errorCode: "duplicate_topic" });
  });

  it("tells again for every occurrence, resumes included", async () => {
    const { seen, notifier } = recorder();
    const queues = healthy();
    queues.writer = [new Error("writer down"), goodArticle];
    const application = await start(routedProvider(queues), { notifier });

    await expect(application.workflow.run({ topic: "Caching" })).rejects.toThrow();
    const [{ workflowId }] = await application.listRuns();
    const resumed = await application.workflow.resume(workflowId);

    expect(resumed.status).toBe("awaiting_approval");
    expect(seen.map((n) => n.event)).toEqual(["failed", "awaiting_approval"]);
  });

  it("changes nothing in a run when the notifier fails", async () => {
    const calls: string[] = [];
    const notifier: Notifier = {
      notify: async (n) => {
        calls.push(n.event);
        throw new Error("webhook exploded");
      }
    };
    const application = await start(routedProvider(healthy()), { notifier });

    const result = await application.workflow.run({ topic: "Caching" });

    expect(result.status).toBe("awaiting_approval");
    expect(calls).toEqual(["awaiting_approval"]);
    expect((await application.listRuns())[0]!.status).toBe("awaiting_approval");
  });

  it("without a webhook nothing is sent and nothing changes", async () => {
    const application = await start(routedProvider(healthy()));
    expect((await application.workflow.run({ topic: "Caching" })).status).toBe("awaiting_approval");
  });

  describe("through the webhook from the environment", () => {
    it("posts exactly one message per configured event and none for the others", async () => {
      const bodies: Array<Record<string, unknown>> = [];
      const hook = await listen((request, respond) => {
        let body = "";
        request.on("data", (chunk) => (body += chunk));
        request.on("end", () => {
          bodies.push(JSON.parse(body));
          respond(200);
        });
      });
      try {
        const application = await start(
          routedProvider(healthy()),
          {},
          {
            OPENBLOG_NOTIFY_WEBHOOK_URL: `${hook.url}/hook`,
            OPENBLOG_NOTIFY_BASE_URL: "https://blog.test"
          }
        );

        const result = await application.workflow.run({ topic: "Caching" });
        // a published article is not among the default events
        await application.workflow.approve(result.workflowId!, { approvedBy: "ana" });

        expect(bodies).toHaveLength(1);
        expect(bodies[0]).toMatchObject({
          event: "awaiting_approval",
          workflowId: result.workflowId,
          url: `https://blog.test/runs/${result.workflowId}`
        });
      } finally {
        await hook.close();
      }
    });

    it("keeps the run intact when the webhook answers 500 or is down", async () => {
      let hits = 0;
      const hook = await listen((_request, respond) => {
        hits += 1;
        respond(500);
      });
      const url = hook.url;
      try {
        const application = await start(
          routedProvider(healthy()),
          {},
          {
            OPENBLOG_NOTIFY_WEBHOOK_URL: `${url}/hook`
          }
        );
        const failing = await application.workflow.run({ topic: "Caching" });
        expect(failing.status).toBe("awaiting_approval");
        expect(hits).toBe(3); // bounded retries
      } finally {
        await hook.close();
      }

      await app?.dispose();
      const down = await start(
        routedProvider(healthy()),
        {},
        {
          OPENBLOG_NOTIFY_WEBHOOK_URL: `${url}/hook`,
          OPENBLOG_MEMORY_DB_PATH: path.join(dir, "other.db"),
          OPENBLOG_OUTPUT_DIR: path.join(dir, "out2")
        }
      );
      expect((await down.workflow.run({ topic: "Caching" })).status).toBe("awaiting_approval");
    }, 20_000);
  });

  describe("scheduler", () => {
    it("tells when a daily limit stops a run, but not when it is only outside the window", async () => {
      const { seen, notifier } = recorder();
      const application = await start(
        routedProvider(healthy()),
        { notifier },
        {
          OPENBLOG_SCHEDULE_MAX_RUNS_PER_DAY: "0"
        }
      );

      const limited = await application.scheduler!.runOnce();
      expect(limited).toMatchObject({ status: "limit_reached", reason: "max_runs_per_day" });
      expect(seen).toEqual([
        {
          event: "schedule_limit_reached",
          status: "limit_reached",
          errorCode: "max_runs_per_day",
          errorMessage: expect.stringContaining("the limit is 0")
        }
      ]);

      await application.dispose();
      app = undefined;
      const quiet = recorder();
      const outside = await start(
        routedProvider(healthy()),
        { notifier: quiet.notifier, clock: () => new Date(2026, 9, 24, 12, 0) },
        {
          OPENBLOG_SCHEDULE_ALLOWED_WINDOW: "22:00-23:00",
          OPENBLOG_MEMORY_DB_PATH: path.join(dir, "second.db")
        }
      );
      expect(await outside.scheduler!.runOnce()).toMatchObject({
        status: "limit_reached",
        reason: "outside_window"
      });
      expect(quiet.seen).toEqual([]);
    });
  });
});
