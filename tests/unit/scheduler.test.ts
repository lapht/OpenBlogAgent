import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseCommand, UsageError } from "../../apps/cli/src/args";
import { runCli } from "../../apps/cli/src/run";
import { createApplication, inWindow, type Application } from "../../packages/app/src";
import { loadEnv } from "../../packages/config/src";
import { FetchError, type ContentFetcher } from "../../packages/research/src";
import { runStorageMigrations, SchedulerStore } from "../../packages/storage/src";
import { scriptedProvider } from "../mocks/scripted-provider";

const DAY = 86_400_000;
const fixtureDir = path.resolve(__dirname, "../fixtures/research");
const fixture = (name: string) => fs.readFileSync(path.join(fixtureDir, name), "utf8");
const SOURCES_FILE = path.join(fixtureDir, "sources.yaml");
const PAGE = "https://www.example.com/posts/caching-guide";

function fakeFetcher(): ContentFetcher {
  const pages: Record<string, string> = {
    "https://example.com/feed.xml": fixture("rss.xml"),
    "https://other.example.org/atom.xml": fixture("atom.xml"),
    "https://docs.example.net/sitemap.xml": fixture("sitemap.xml"),
    [PAGE]: "Caching explained in plain words. ".repeat(20),
    "https://other.example.org/rust-lifetimes": "Lifetimes explained in plain words. ".repeat(20)
  };
  return {
    async fetch({ url }) {
      const body = pages[url];
      if (body === undefined) {
        throw new FetchError({ code: "fetch_http_error", message: "Server answered 404", url });
      }
      return { url, finalUrl: url, status: 200, contentType: "text/html", size: body.length, body };
    }
  };
}

const replies = () => [
  JSON.stringify(["Intro", "Body", "Conclusion"]),
  `Article body, based on ${PAGE}`,
  JSON.stringify({ editedText: `Edited body, based on ${PAGE}`, changesSummary: "tidied" }),
  JSON.stringify({
    title: "A title",
    metaDescription: "A description",
    slug: "a-title",
    h1: "A H1",
    headings: [{ level: "H2", text: "Intro" }]
  }),
  JSON.stringify({ category: "News", tags: ["alpha"] })
];

describe("scheduler lock and usage store", () => {
  let db: Database.Database;
  let store: SchedulerStore;
  const t0 = new Date("2026-10-23T10:00:00Z");

  beforeEach(() => {
    db = new Database(":memory:");
    runStorageMigrations(db);
    store = new SchedulerStore(db);
  });
  afterEach(() => db.close());

  it("lets one owner hold the lock", () => {
    expect(store.acquireLock("l", "a", 60_000, t0)).toEqual({
      acquired: true,
      expiresAt: new Date(t0.getTime() + 60_000).toISOString()
    });
    expect(store.acquireLock("l", "b", 60_000, new Date(t0.getTime() + 1000))).toMatchObject({
      acquired: false,
      owner: "a"
    });
  });

  it("takes over an expired lock, and only the holder can release it", () => {
    store.acquireLock("l", "a", 60_000, t0);
    const later = new Date(t0.getTime() + 61_000);

    expect(store.acquireLock("l", "b", 60_000, later).acquired).toBe(true);
    store.releaseLock("l", "a"); // a no longer holds it
    expect(store.acquireLock("l", "c", 60_000, later).acquired).toBe(false);
    store.releaseLock("l", "b");
    expect(store.acquireLock("l", "c", 60_000, later).acquired).toBe(true);
  });

  it("excludes another connection to the same database file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openblog-lock-"));
    const file = path.join(dir, "db.sqlite");
    const first = new Database(file);
    runStorageMigrations(first);
    const second = new Database(file);
    try {
      expect(new SchedulerStore(first).acquireLock("l", "a", 60_000, t0).acquired).toBe(true);
      expect(new SchedulerStore(second).acquireLock("l", "b", 60_000, t0).acquired).toBe(false);
    } finally {
      first.close();
      second.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sums runs and cost since a moment", () => {
    const run = db.prepare(
      `INSERT INTO workflows (id, name, topic, topic_normalized, status, metadata_json, started_at, created_at, updated_at)
       VALUES (?, 'w', 't', 't', 'published', '{}', ?, ?, ?)`
    );
    const step = db.prepare(
      `INSERT INTO workflow_steps (id, workflow_id, step, status, attempt, started_at, completed_at, cost_usd)
       VALUES (?, ?, ?, 'succeeded', 1, ?, ?, ?)`
    );
    const old = new Date(t0.getTime() - 2 * DAY).toISOString();
    const recent = new Date(t0.getTime() - 3600_000).toISOString();
    run.run("old", old, old, old);
    run.run("new", recent, recent, recent);
    step.run("s1", "old", "writer", old, old, 3);
    step.run("s2", "new", "writer", recent, recent, 0.25);
    step.run("s3", "new", "seo", recent, recent, 0.5);

    expect(store.usageSince(new Date(t0.getTime() - DAY))).toEqual({ runs: 1, costUsd: 0.75 });
    expect(store.usageSince(new Date(t0.getTime() - 3 * DAY))).toEqual({ runs: 2, costUsd: 3.75 });
    expect(store.usageSince(t0)).toEqual({ runs: 0, costUsd: 0 });
  });
});

describe("allowed window", () => {
  const at = (hours: number, minutes = 0) => new Date(2026, 9, 23, hours, minutes);

  it("covers a daytime window", () => {
    expect(
      [at(7, 59), at(8), at(19, 59), at(20)].map((now) => inWindow("08:00-20:00", now))
    ).toEqual([false, true, true, false]);
  });

  it("covers a window that crosses midnight", () => {
    expect(
      [at(21, 59), at(22), at(3), at(5, 59), at(6)].map((now) => inWindow("22:00-06:00", now))
    ).toEqual([false, true, true, true, false]);
  });
});

describe("schedule run-once", () => {
  let dir: string;
  let apps: Application[];

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "openblog-schedule-"));
    apps = [];
  });

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.dispose()));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const env = (extra: Record<string, string> = {}) => ({
    OPENBLOG_OUTPUT_DIR: path.join(dir, "out"),
    OPENBLOG_MEMORY_DB_PATH: path.join(dir, "memory.db"),
    OPENBLOG_LOG_LEVEL: "fatal",
    OPENBLOG_TAXONOMY_CATEGORIES: "News",
    OPENBLOG_RESEARCH_SOURCES_FILE: SOURCES_FILE,
    OPENBLOG_QUALITY_MIN_WORDS: "1",
    OPENBLOG_QUALITY_MIN_H2: "0",
    OPENBLOG_QUALITY_MIN_OUTLINE_COVERAGE: "0",
    OPENBLOG_QUALITY_MIN_EDIT_RATIO: "0.0001",
    OPENBLOG_QUALITY_MAX_ATTEMPTS: "0",
    ...extra
  });

  const open = async (extra: Record<string, string> = {}, clock?: () => Date) => {
    const app = await createApplication(loadEnv(env(extra)), {
      fetcher: fakeFetcher(),
      llm: scriptedProvider(...replies()) as never,
      clock
    });
    apps.push(app);
    return app;
  };

  const rows = (sql: string): Array<Record<string, unknown>> => {
    const db = new Database(path.join(dir, "memory.db"), { readonly: true });
    try {
      return db.prepare(sql).all() as Array<Record<string, unknown>>;
    } finally {
      db.close();
    }
  };

  /** Collects and accepts the best candidate. */
  const acceptBest = async (app: Application) => {
    await app.research!.collect();
    const best = app.research!.list({ status: "new", limit: 1 })[0]!;
    return app.research!.accept(best.id, { by: "ana" });
  };

  it("does nothing, cleanly, when no candidate is accepted", async () => {
    const app = await open();

    const outcome = await app.scheduler!.runOnce({ collect: true });

    expect(outcome).toMatchObject({ status: "nothing_to_do", collected: { created: 6 } });
    expect(rows("SELECT * FROM workflows")).toEqual([]);
    // collecting never accepts by itself
    expect(app.research!.list({ status: "accepted" })).toEqual([]);
  });

  it("runs the best accepted candidate as a normal draft run and marks it used", async () => {
    const app = await open();
    const candidate = await acceptBest(app);

    const outcome = await app.scheduler!.runOnce();

    expect(outcome).toMatchObject({ status: "ran", candidate: { id: candidate.id } });
    expect(outcome.status === "ran" && outcome.result.status).toBe("awaiting_approval");
    expect(rows("SELECT topic, status FROM workflows")).toEqual([
      { topic: candidate.title, status: "awaiting_approval" }
    ]);
    expect(app.research!.get(candidate.id)).toMatchObject({
      status: "used",
      workflowId: rows("SELECT id FROM workflows")[0]!.id
    });
    // the candidate's page grounded the article
    expect(rows("SELECT step FROM workflow_steps ORDER BY rowid")[0]).toEqual({
      step: "read_sources"
    });
    // used once: the next call has nothing left
    expect((await app.scheduler!.runOnce()).status).toBe("nothing_to_do");
  });

  it("picks the highest-scored accepted candidate", async () => {
    const app = await open();
    await app.research!.collect();
    const [first, second] = app.research!.list({ status: "new" });
    app.research!.accept(second!.id, { by: "ana" });
    app.research!.accept(first!.id, { by: "ana" });

    const outcome = await app.scheduler!.runOnce();

    expect(outcome.status === "ran" && outcome.candidate.id).toBe(first!.id);
  });

  it("starts only one run when two calls overlap", async () => {
    const app = await open();
    await acceptBest(app);

    const [a, b] = await Promise.all([app.scheduler!.runOnce(), app.scheduler!.runOnce()]);

    expect([a.status, b.status].sort()).toEqual(["locked", "ran"]);
    expect(rows("SELECT id FROM workflows")).toHaveLength(1);
  });

  it("starts only one run when two processes overlap", async () => {
    const first = await open();
    const second = await open();
    await acceptBest(first);

    const outcomes = await Promise.all([first.scheduler!.runOnce(), second.scheduler!.runOnce()]);

    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(["locked", "ran"]);
    expect(rows("SELECT id FROM workflows")).toHaveLength(1);
  });

  it("releases the lock after a run, also when it fails", async () => {
    const app = await open();
    const failing = await createApplication(loadEnv(env()), {
      fetcher: fakeFetcher(),
      llm: { id: "down", generate: async () => Promise.reject(new Error("provider down")) } as never
    });
    apps.push(failing);
    await acceptBest(app);

    await expect(failing.scheduler!.runOnce()).rejects.toThrow(/provider down/);
    expect(rows("SELECT name FROM scheduler_locks")).toEqual([]);
    // the candidate was marked used, the run is failed and resumable; the scheduler is free again
    expect((await app.scheduler!.runOnce()).status).toBe("nothing_to_do");
  });

  it("recovers a lock left by a dead process once it has expired", async () => {
    const app = await open();
    await acceptBest(app);
    const db = new Database(path.join(dir, "memory.db"));
    const insert = db.prepare(
      "INSERT OR REPLACE INTO scheduler_locks (name, owner, acquired_at, expires_at) VALUES ('schedule-run-once', 'dead:1', ?, ?)"
    );
    const now = Date.now();
    insert.run(new Date(now - 3 * 3600_000).toISOString(), new Date(now + 3600_000).toISOString());
    try {
      expect(await app.scheduler!.runOnce()).toMatchObject({ status: "locked", owner: "dead:1" });

      insert.run(
        new Date(now - 3 * 3600_000).toISOString(),
        new Date(now - 3600_000).toISOString()
      );
      expect((await app.scheduler!.runOnce()).status).toBe("ran");
    } finally {
      db.close();
    }
  });

  it("marks runs abandoned by a dead process as interrupted first", async () => {
    const app = await open({ OPENBLOG_RUN_STALE_AFTER_MINUTES: "10" });
    const db = new Database(path.join(dir, "memory.db"));
    const long = new Date(Date.now() - 3 * 3600_000).toISOString();
    db.prepare(
      `INSERT INTO workflows (id, name, topic, topic_normalized, status, metadata_json, started_at, created_at, updated_at)
       VALUES ('dead', 'w', 'old', 'old', 'running', '{}', ?, ?, ?)`
    ).run(long, long, long);
    db.close();

    const outcome = await app.scheduler!.runOnce();

    expect(outcome).toMatchObject({ status: "nothing_to_do", recovered: ["dead"] });
    expect(rows("SELECT status FROM workflows WHERE id = 'dead'")).toEqual([
      { status: "interrupted" }
    ]);
  });

  describe("limits", () => {
    it("stops at the daily run limit, also after a restart", async () => {
      const app = await open({ OPENBLOG_SCHEDULE_MAX_RUNS_PER_DAY: "1" });
      await acceptBest(app);
      expect((await app.scheduler!.runOnce()).status).toBe("ran");
      await app.research!.collect();
      const next = app.research!.list({ status: "new", limit: 1 })[0]!;
      app.research!.accept(next.id, { by: "ana" });

      const restarted = await open({ OPENBLOG_SCHEDULE_MAX_RUNS_PER_DAY: "1" });
      const outcome = await restarted.scheduler!.runOnce();

      expect(outcome).toMatchObject({ status: "limit_reached", reason: "max_runs_per_day" });
      expect(rows("SELECT id FROM workflows")).toHaveLength(1);
      expect(restarted.research!.get(next.id).status).toBe("accepted");
    });

    it("stops at the daily cost limit, summed from stored usage", async () => {
      const app = await open({ OPENBLOG_SCHEDULE_MAX_COST_PER_DAY: "1" });
      await acceptBest(app);
      expect((await app.scheduler!.runOnce()).status).toBe("ran");
      const db = new Database(path.join(dir, "memory.db"));
      db.prepare("UPDATE workflow_steps SET cost_usd = 0.6").run(); // many steps: well above $1
      db.close();
      await app.research!.collect();
      const next = app.research!.list({ status: "new", limit: 1 })[0]!;
      app.research!.accept(next.id, { by: "ana" });

      const restarted = await open({ OPENBLOG_SCHEDULE_MAX_COST_PER_DAY: "1" });

      expect(await restarted.scheduler!.runOnce()).toMatchObject({
        status: "limit_reached",
        reason: "max_cost_per_day"
      });
    });

    it("counts only the last 24 hours", async () => {
      const app = await open({ OPENBLOG_SCHEDULE_MAX_RUNS_PER_DAY: "1" });
      await acceptBest(app);
      await app.scheduler!.runOnce();
      await app.research!.collect();
      app.research!.accept(app.research!.list({ status: "new", limit: 1 })[0]!.id, { by: "ana" });

      const tomorrow = await open(
        { OPENBLOG_SCHEDULE_MAX_RUNS_PER_DAY: "1" },
        () => new Date(Date.now() + 2 * DAY)
      );

      expect((await tomorrow.scheduler!.runOnce()).status).toBe("ran");
    });

    it("stays outside the allowed window", async () => {
      const night = () => new Date(2026, 9, 23, 3, 0);
      const app = await open({ OPENBLOG_SCHEDULE_ALLOWED_WINDOW: "08:00-20:00" }, night);
      await acceptBest(app);

      expect(await app.scheduler!.runOnce()).toMatchObject({
        status: "limit_reached",
        reason: "outside_window"
      });

      const day = await open(
        { OPENBLOG_SCHEDULE_ALLOWED_WINDOW: "08:00-20:00" },
        () => new Date(2026, 9, 23, 12, 0)
      );
      expect((await day.scheduler!.runOnce()).status).toBe("ran");
    });

    it("collects before checking limits, since collecting costs nothing", async () => {
      const app = await open({ OPENBLOG_SCHEDULE_MAX_RUNS_PER_DAY: "0" });
      const outcome = await app.scheduler!.runOnce({ collect: true });
      expect(outcome).toMatchObject({
        status: "limit_reached",
        collected: { created: 6 }
      });
    });

    it("rejects a malformed window and negative limits", () => {
      for (const bad of [
        { OPENBLOG_SCHEDULE_ALLOWED_WINDOW: "8-20" },
        { OPENBLOG_SCHEDULE_ALLOWED_WINDOW: "10:00-10:00" },
        { OPENBLOG_SCHEDULE_MAX_RUNS_PER_DAY: "-1" },
        { OPENBLOG_SCHEDULE_LOCK_TTL_MINUTES: "0" }
      ]) {
        expect(() => loadEnv(bad)).toThrow();
      }
    });
  });

  describe("CLI", () => {
    const cli = async (argv: string[], extra: Record<string, string> = {}) => {
      const out: string[] = [];
      const code = await runCli({
        argv,
        env: env(extra),
        overrides: {
          fetcher: fakeFetcher(),
          llm: scriptedProvider(...replies()) as never,
          clock: () => new Date()
        },
        stdout: (text) => out.push(text),
        stderr: () => undefined
      });
      return { code, out, json: () => JSON.parse(out.at(-1)!) as Record<string, never> };
    };

    it("parses the command", () => {
      expect(parseCommand(["schedule", "run-once", "--collect", "--json"])).toMatchObject({
        name: "schedule",
        action: "run-once",
        options: { collect: true, json: true }
      });
      expect(() => parseCommand(["schedule"])).toThrow(UsageError);
      expect(() => parseCommand(["schedule", "cron"])).toThrow(UsageError);
      expect(() => parseCommand(["list", "--collect"])).toThrow(/only applies to schedule/);
    });

    it("exits 10 with nothing to do, then 0 after a run, and prints what it did", async () => {
      const idle = await cli(["schedule", "run-once", "--collect", "--json"]);
      expect(idle.code).toBe(10);
      expect(idle.json()).toMatchObject({
        command: "schedule run-once",
        status: "nothing_to_do",
        exitCode: 10,
        collected: { created: 6 }
      });

      const app = await open();
      app.research!.accept(app.research!.list({ status: "new", limit: 1 })[0]!.id, { by: "ana" });
      await app.dispose();
      apps.pop();

      const ran = await cli(["schedule", "run-once", "--json"]);
      expect(ran.code).toBe(0);
      expect(ran.json()).toMatchObject({
        status: "ran",
        run: { command: "generate", status: "awaiting_approval" },
        candidate: { status: "accepted" }
      });

      const human = await cli(["schedule", "run-once"]);
      expect(human.code).toBe(10);
      expect(human.out.join("\n")).toContain("Nothing to do");
    });

    it("exits 11 at a limit and 12 when locked", async () => {
      const limited = await cli(["schedule", "run-once", "--json"], {
        OPENBLOG_SCHEDULE_MAX_RUNS_PER_DAY: "0"
      });
      expect(limited.code).toBe(11);
      expect(limited.json()).toMatchObject({
        status: "limit_reached",
        limit: { reason: "max_runs_per_day" }
      });

      const db = new Database(path.join(dir, "memory.db"));
      db.prepare(
        "INSERT INTO scheduler_locks (name, owner, acquired_at, expires_at) VALUES ('schedule-run-once', 'other:9', 'a', ?)"
      ).run(new Date(Date.now() + 3600_000).toISOString());
      db.close();

      const locked = await cli(["schedule", "run-once", "--json"]);
      expect(locked.code).toBe(12);
      expect(locked.json()).toMatchObject({ status: "locked", lock: { owner: "other:9" } });
    });

    it("exits 1 when the run fails", async () => {
      const app = await open();
      await acceptBest(app);
      await app.dispose();
      apps.pop();

      const out: string[] = [];
      const code = await runCli({
        argv: ["schedule", "run-once", "--json"],
        env: env(),
        overrides: {
          fetcher: fakeFetcher(),
          llm: {
            id: "down",
            generate: async () => Promise.reject(new Error("provider down"))
          } as never
        },
        stdout: (text) => out.push(text),
        stderr: () => undefined
      });

      expect(code).toBe(1);
      expect(JSON.parse(out.at(-1)!)).toMatchObject({ status: "error", exitCode: 1 });
    });

    it("works on a throwaway copy with --dry-run", async () => {
      const app = await open();
      await acceptBest(app);
      await app.dispose();
      apps.pop();

      const dry = await cli(["schedule", "run-once", "--dry-run", "--json"]);

      expect(dry.code).toBe(0);
      expect(dry.json()).toMatchObject({ status: "ran", dryRun: true });
      expect(rows("SELECT id FROM workflows")).toEqual([]);
      expect(rows("SELECT status FROM topic_candidates WHERE status = 'accepted'")).toHaveLength(1);
    });
  });
});
