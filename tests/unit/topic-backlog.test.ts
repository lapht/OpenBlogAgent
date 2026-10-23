import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseCommand, UsageError } from "../../apps/cli/src/args";
import { runCli } from "../../apps/cli/src/run";
import { buildServer } from "../../apps/server/src/app";
import {
  BacklogError,
  createApplication,
  createResearchService,
  type Application
} from "../../packages/app/src";
import { loadEnv } from "../../packages/config/src";
import {
  FetchError,
  scoreCandidate,
  tokenOverlap,
  type ContentFetcher,
  type TopicCandidate
} from "../../packages/research/src";
import {
  BacklogError as StoreBacklogError,
  LATEST_SCHEMA_VERSION,
  runStorageMigrations,
  TopicBacklogStore,
  type CandidateInput
} from "../../packages/storage/src";
import { scriptedProvider } from "../mocks/scripted-provider";

const NOW = new Date("2026-10-23T12:00:00Z");
const fixtureDir = path.resolve(__dirname, "../fixtures/research");
const fixture = (name: string) => fs.readFileSync(path.join(fixtureDir, name), "utf8");
const SOURCES_FILE = path.join(fixtureDir, "sources.yaml");

function fakeFetcher(replies: Record<string, string>): ContentFetcher {
  return {
    async fetch({ url }) {
      const body = replies[url];
      if (body === undefined) {
        throw new FetchError({ code: "fetch_http_error", message: "Server answered 404", url });
      }
      return {
        url,
        finalUrl: url,
        status: 200,
        contentType: "application/xml",
        size: body.length,
        body
      };
    }
  };
}

const feeds = (): Record<string, string> => ({
  "https://example.com/feed.xml": fixture("rss.xml"),
  "https://other.example.org/atom.xml": fixture("atom.xml"),
  "https://docs.example.net/sitemap.xml": fixture("sitemap.xml")
});

const candidate = (overrides: Partial<TopicCandidate> = {}): TopicCandidate => ({
  title: "Zero downtime deploys",
  url: "https://example.com/deploys",
  source: "Blog",
  weight: 1,
  publishedAt: "2026-10-23T12:00:00.000Z",
  ...overrides
});

describe("candidate scoring", () => {
  const base = { now: NOW, covered: [] };

  it("is deterministic and explains itself", () => {
    const first = scoreCandidate(candidate(), base);
    expect(scoreCandidate(candidate(), base)).toEqual(first);
    expect(first.breakdown).toEqual({ recency: 40, source: 15, keywords: 0, overlap: 0 });
    expect(first.score).toBe(55);
    expect(first.motivation).toBe("published today; source weight 1");
  });

  it("decays recency linearly over 30 days and gives undated entries a fixed amount", () => {
    const at = (days: number) =>
      scoreCandidate(
        candidate({ publishedAt: new Date(NOW.getTime() - days * 86_400_000).toISOString() }),
        base
      ).breakdown.recency;

    expect([at(0), at(15), at(30), at(90)]).toEqual([40, 20, 0, 0]);
    expect(scoreCandidate(candidate({ publishedAt: undefined }), base).breakdown.recency).toBe(10);
    // a date in the future counts as today
    expect(at(-5)).toBe(40);
  });

  it("scales with the source weight up to 2", () => {
    const source = (weight: number) => scoreCandidate(candidate({ weight }), base).breakdown.source;
    expect([source(0), source(1), source(2), source(9)]).toEqual([0, 15, 30, 30]);
  });

  it("adds points for include keywords and takes them off for exclude keywords", () => {
    const result = scoreCandidate(candidate({ summary: "A guide to Kubernetes rollouts" }), {
      ...base,
      include: ["deploys", "kubernetes", "rust"],
      exclude: ["sponsored"]
    });
    expect(result.breakdown.keywords).toBe(20); // two matches, capped
    expect(result.motivation).toContain('matches "deploys", "kubernetes"');

    const bad = scoreCandidate(candidate({ title: "Sponsored deploys" }), {
      ...base,
      exclude: ["sponsored"]
    });
    expect(bad.breakdown.keywords).toBe(-20);
  });

  it("flags an identical title as covered instead of scoring it", () => {
    const result = scoreCandidate(candidate({ title: "  Zero   Downtime Deploys " }), {
      ...base,
      covered: [{ topic: "zero downtime deploys", title: "Zero-downtime deploys, done right" }]
    });
    expect(result.covered).toEqual({ by: "zero downtime deploys", reason: "same_title" });
    expect(result.score).toBe(0);
  });

  it("scores down a candidate that overlaps a published title", () => {
    const covered = [{ topic: "Caching", title: "Zero downtime deploys with blue green" }];
    const result = scoreCandidate(candidate({ title: "Zero downtime deploys explained" }), {
      ...base,
      covered
    });

    expect(result.covered).toBeUndefined();
    expect(result.breakdown.overlap).toBeLessThan(0);
    expect(result.score).toBeLessThan(scoreCandidate(candidate(), base).score);
    expect(result.motivation).toContain("similar to");
  });

  it("measures token overlap without filler words, accents or case", () => {
    expect(tokenOverlap("The Café Guide to Caching", "caffe guide caching")).toBe(0.5);
    expect(tokenOverlap("Rust lifetimes", "Sourdough starters")).toBe(0);
    // too few significant words to compare
    expect(tokenOverlap("How to", "How to")).toBe(0);
  });

  it("never leaves 0-100", () => {
    const high = scoreCandidate(candidate({ weight: 5 }), {
      ...base,
      include: ["zero", "downtime", "deploys"]
    });
    expect(high.score).toBeLessThanOrEqual(100);
    const low = scoreCandidate(candidate({ publishedAt: "2020-01-01", weight: 0 }), {
      ...base,
      exclude: ["zero", "deploys"]
    });
    expect(low.score).toBe(0);
  });
});

describe("TopicBacklogStore", () => {
  let db: Database.Database;
  let store: TopicBacklogStore;

  const input = (n: number, overrides: Partial<CandidateInput> = {}): CandidateInput => ({
    title: `Candidate ${n}`,
    url: `https://example.com/${n}`,
    urlKey: `example.com/${n}`,
    source: "Blog",
    score: 50 + n,
    breakdown: { recency: 40, source: 15, keywords: 0, overlap: 0 },
    motivation: "published today",
    ...overrides
  });

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runStorageMigrations(db);
    store = new TopicBacklogStore(db);
  });

  afterEach(() => db.close());

  it("is created by the migration", () => {
    const columns = (
      db.prepare("PRAGMA table_info(topic_candidates)").all() as { name: string }[]
    ).map((column) => column.name);
    expect(columns).toEqual(
      expect.arrayContaining([
        "title_normalized",
        "score",
        "score_breakdown_json",
        "status",
        "workflow_id"
      ])
    );
    expect(db.pragma("user_version", { simple: true })).toBe(LATEST_SCHEMA_VERSION);
  });

  it("stores candidates as new with score, breakdown and motivation", () => {
    const { created } = store.upsertCollected([input(1)], { now: NOW });

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      title: "Candidate 1",
      status: "new",
      score: 51,
      breakdown: { recency: 40, source: 15, keywords: 0, overlap: 0 },
      motivation: "published today",
      collectedAt: NOW.toISOString(),
      decidedBy: null
    });
  });

  it("is idempotent: the same URL or title is not stored twice", () => {
    store.upsertCollected([input(1)], { now: NOW });
    const again = store.upsertCollected(
      [
        input(1, { score: 80 }),
        input(2, { title: "candidate   1", urlKey: "other.example/x", score: 80 })
      ],
      { now: NOW }
    );

    expect(again.created).toEqual([]);
    expect(again.refreshed).toHaveLength(2); // by URL, and by normalized title
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0].score).toBe(80); // a still-new candidate is rescored
  });

  it("leaves decided candidates alone when they are collected again", () => {
    const [first, second] = store.upsertCollected([input(1), input(2)], { now: NOW }).created;
    store.accept(first.id, { by: "ana", brief: { tone: "calm" } });
    store.drop(second.id, { by: "ana", reason: "off topic" });

    const again = store.upsertCollected([input(1, { score: 5 }), input(2, { score: 5 })], {
      now: NOW
    });

    expect(again.unchanged.map((record) => [record.status, record.score])).toEqual([
      ["accepted", 51],
      ["dropped", 52]
    ]);
    expect(store.list({ status: "new" })).toEqual([]);
  });

  it("accepts nothing by itself, and auto-accepts only at or above the threshold", () => {
    const manual = store.upsertCollected([input(1)], { now: NOW });
    expect(manual.created[0].status).toBe("new");
    expect(store.list({ status: "accepted" })).toEqual([]);

    const auto = store.upsertCollected([input(2, { score: 90 }), input(3, { score: 70 })], {
      now: NOW,
      autoAcceptMinScore: 80
    });
    const byTitle = Object.fromEntries(auto.created.map((record) => [record.title, record]));
    expect(byTitle["Candidate 2"]).toMatchObject({ status: "accepted", decidedBy: "auto" });
    expect(byTitle["Candidate 3"]).toMatchObject({ status: "new", decidedBy: null });
  });

  it("lists best score first and filters by status", () => {
    store.upsertCollected([input(1), input(3), input(2)], { now: NOW });
    expect(store.list().map((record) => record.title)).toEqual([
      "Candidate 3",
      "Candidate 2",
      "Candidate 1"
    ]);
    expect(store.list({ limit: 1 })).toHaveLength(1);
  });

  it("applies decisions with state rules", () => {
    const [record] = store.upsertCollected([input(1)], { now: NOW }).created;

    const accepted = store.accept(record.id, { by: "ana", brief: { language: "it" }, now: NOW });
    expect(accepted).toMatchObject({
      status: "accepted",
      decidedBy: "ana",
      brief: { language: "it" },
      decidedAt: NOW.toISOString()
    });
    // accepting again without a brief keeps the stored one
    expect(store.accept(record.id, { by: "bo" }).brief).toEqual({ language: "it" });

    const dropped = store.drop(record.id, { by: "ana", reason: "stale", now: NOW });
    expect(dropped).toMatchObject({ status: "dropped", decisionNote: "stale" });
    expect(() => store.markUsed(record.id, "wf-1")).toThrow(/must be accepted first/);

    store.accept(record.id, { by: "ana" });
    const used = store.markUsed(record.id, "wf-1", NOW);
    expect(used).toMatchObject({ status: "used", workflowId: "wf-1" });

    for (const act of [
      () => store.accept(record.id, { by: "x" }),
      () => store.drop(record.id, { by: "x" }),
      () => store.markUsed(record.id, "wf-2")
    ]) {
      expect(act).toThrow(StoreBacklogError);
      expect(act).toThrow(/already started a run/);
    }
  });

  it("finds a candidate by a unique id prefix and refuses unknown or ambiguous ones", () => {
    const [record] = store.upsertCollected([input(1)], { now: NOW }).created;

    expect(store.get(record.id.slice(0, 8)).id).toBe(record.id);
    expect(() => store.get("ffffffff")).toThrow(/No topic candidate/);
    expect(() => store.get("ab")).toThrow(StoreBacklogError); // too short to be a prefix

    db.prepare("UPDATE topic_candidates SET id = 'aaaa1111-1' WHERE id = ?").run(record.id);
    store.upsertCollected([input(2)], { now: NOW });
    db.prepare("UPDATE topic_candidates SET id = 'aaaa2222-2' WHERE title = 'Candidate 2'").run();
    try {
      store.get("aaaa");
      throw new Error("expected an error");
    } catch (error) {
      expect((error as StoreBacklogError).code).toBe("ambiguous_id");
    }
  });

  it("lists the topics and titles of published and parked runs as covered", () => {
    const insert = db.prepare(
      `INSERT INTO workflows (id, name, topic, topic_normalized, status, metadata_json, started_at, created_at, updated_at)
       VALUES (?, 'w', ?, ?, ?, '{}', 'now', 'now', 'now')`
    );
    insert.run("w1", "Topic one", "topic one", "published");
    insert.run("w2", "Topic two", "topic two", "needs_review");
    insert.run("w3", "Topic three", "topic three", "failed");
    insert.run("w4", "Topic four", "topic four", "rejected");
    db.prepare(
      `INSERT INTO articles (id, workflow_id, topic, title, tags_json, article_markdown, edited_markdown, seo_json, created_at, updated_at)
       VALUES ('a1', 'w1', 'Topic one', 'Final title', '[]', '', '', '{}', 'now', 'now')`
    ).run();

    expect(store.listCovered()).toEqual([
      { workflowId: "w1", topic: "Topic one", title: "Final title" },
      { workflowId: "w2", topic: "Topic two", title: null }
    ]);
  });
});

describe("topic backlog service, CLI and API", () => {
  let dir: string;
  let app: Application | undefined;

  const env = (extra: Record<string, string> = {}) => ({
    OPENBLOG_OUTPUT_DIR: path.join(dir, "out"),
    OPENBLOG_MEMORY_DB_PATH: path.join(dir, "memory.db"),
    OPENBLOG_LOG_LEVEL: "fatal",
    OPENBLOG_TAXONOMY_CATEGORIES: "News",
    OPENBLOG_RESEARCH_SOURCES_FILE: SOURCES_FILE,
    OPENBLOG_PUBLICATION_POLICY: "publish_if_gate_passes",
    OPENBLOG_QUALITY_MIN_WORDS: "1",
    OPENBLOG_QUALITY_MIN_H2: "0",
    OPENBLOG_QUALITY_MIN_OUTLINE_COVERAGE: "0",
    OPENBLOG_QUALITY_MIN_EDIT_RATIO: "0.0001",
    OPENBLOG_QUALITY_MAX_ATTEMPTS: "0",
    ...extra
  });

  const open = async (
    extra: Record<string, string> = {},
    replies: Record<string, string> = feeds()
  ) => {
    app = await createApplication(loadEnv(env(extra)), {
      fetcher: fakeFetcher(replies),
      clock: () => NOW
    });
    return app.research!;
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "openblog-backlog-"));
  });

  afterEach(async () => {
    await app?.dispose();
    app = undefined;
    fs.rmSync(dir, { force: true, recursive: true });
  });

  describe("research service", () => {
    it("stores scored candidates, shows the score and breakdown, and repeating changes nothing", async () => {
      const research = await open();

      const first = await research.collect();
      expect(first.counts).toMatchObject({ created: 6, refreshed: 0, unchanged: 0, skipped: 0 });
      const top = first.candidates[0];
      expect(top).toMatchObject({
        title: "Caching & Invalidation: a field guide",
        source: "Other Blog",
        status: "new",
        outcome: "created",
        score: 47
      });
      expect(top.breakdown).toEqual({ recency: 17, source: 30, keywords: 0, overlap: 0 });

      const stored = research.list();
      expect(stored).toHaveLength(6);

      const second = await research.collect();
      expect(second.counts).toMatchObject({ created: 0, refreshed: 6, unchanged: 0 });
      expect(research.list().map((record) => record.id)).toEqual(stored.map((record) => record.id));
    });

    it("reports failing sources and still stores the others", async () => {
      const research = await open({}, { "https://example.com/feed.xml": fixture("rss.xml") });
      const outcome = await research.collect();

      expect(outcome.sources.map((source) => source.status)).toEqual(["ok", "failed", "failed"]);
      expect(outcome.counts.created).toBe(3);
    });

    it("does not offer topics that are already published as new", async () => {
      const research = await open();
      const database = new Database(path.join(dir, "memory.db"));
      database
        .prepare(
          `INSERT INTO workflows (id, name, topic, topic_normalized, status, metadata_json, started_at, created_at, updated_at)
           VALUES ('w1', 'w', 'Sourdough for Beginners', 'sourdough for beginners', 'published', '{}', 'n', 'n', 'n')`
        )
        .run();
      database.close();

      const outcome = await research.collect();

      expect(outcome.skipped).toEqual([
        expect.objectContaining({
          title: "Sourdough for Beginners",
          coveredBy: "Sourdough for Beginners"
        })
      ]);
      expect(research.list().map((record) => record.title)).not.toContain(
        "Sourdough for Beginners"
      );
    });

    it("never accepts without a human unless the auto-accept threshold is set", async () => {
      const research = await open();
      await research.collect();
      expect(research.list({ status: "accepted" })).toEqual([]);

      await app?.dispose();
      const auto = await open({ OPENBLOG_RESEARCH_AUTO_ACCEPT_MIN_SCORE: "45" });
      const outcome = await auto.collect();
      expect(outcome.counts.autoAccepted).toBe(1); // only the heavy, recent Atom entry (47) reaches 45
      expect(auto.list({ status: "accepted" }).map((record) => record.decidedBy)).toEqual(["auto"]);
    });

    it("validates the brief on accept", async () => {
      const research = await open();
      const { candidates } = await research.collect();

      expect(() =>
        research.accept(candidates[0].id, { by: "ana", brief: { minWords: -1 } })
      ).toThrow(/Invalid brief/);
      expect(() =>
        research.accept(candidates[0].id, {
          by: "ana",
          brief: { topic: "no, the title is the topic" }
        })
      ).toThrow(BacklogError);
      expect(
        research.accept(candidates[0].id, { by: "ana", brief: { tone: "calm", minWords: 100 } })
          .brief
      ).toEqual({ tone: "calm", minWords: 100 });
    });

    it("needs the sources file", async () => {
      const research = await open({ OPENBLOG_RESEARCH_SOURCES_FILE: "" });
      await expect(research.collect()).rejects.toThrow(/OPENBLOG_RESEARCH_SOURCES_FILE is not set/);
    });

    it("is not available without the SQLite store", async () => {
      const memoryless = await createApplication(loadEnv(env()), {
        memory: {} as never,
        llm: scriptedProvider()
      });
      expect(memoryless.research).toBeUndefined();
      await memoryless.dispose();
    });

    it("can be built on a store directly", async () => {
      const database = new Database(":memory:");
      runStorageMigrations(database);
      const research = createResearchService({
        config: loadEnv(env()),
        backlog: new TopicBacklogStore(database),
        fetcher: fakeFetcher(feeds()),
        clock: () => NOW
      });
      expect((await research.collect()).counts.created).toBe(6);
      database.close();
    });
  });

  describe("CLI", () => {
    const articleReplies = () => [
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

    const cli = async (argv: string[], extra: Record<string, string> = {}) => {
      const out: string[] = [];
      const code = await runCli({
        argv,
        env: env(extra),
        overrides: {
          fetcher: fakeFetcher(feeds()),
          clock: () => NOW,
          llm: scriptedProvider(...articleReplies())
        },
        stdout: (text) => out.push(text),
        stderr: () => undefined
      });
      return { code, out, json: () => JSON.parse(out.at(-1)!) as Record<string, never> };
    };

    it("parses the research and topics commands", () => {
      expect(parseCommand(["research", "collect", "--json"])).toMatchObject({
        name: "research",
        action: "collect"
      });
      expect(parseCommand(["topics", "list", "--status", "accepted"])).toMatchObject({
        name: "topics",
        action: "list",
        status: "accepted"
      });
      expect(
        parseCommand(["topics", "accept", "abcd1234", "--tone", "calm", "--min-words", "300"])
      ).toMatchObject({ action: "accept", id: "abcd1234", brief: { tone: "calm", minWords: 300 } });
      expect(parseCommand(["topics", "accept", "abcd1234"])).toMatchObject({ brief: undefined });
      expect(parseCommand(["topics", "drop", "abcd1234", "--reason", "meh"])).toMatchObject({
        action: "drop",
        reason: "meh"
      });
      expect(parseCommand(["topics", "generate", "abcd1234", "--language", "it"])).toMatchObject({
        action: "generate",
        brief: { language: "it" }
      });

      for (const argv of [
        ["research"],
        ["research", "score"],
        ["topics"],
        ["topics", "explode"],
        ["topics", "accept"],
        ["topics", "accept", "a", "b"],
        ["topics", "list", "--status", "weird"],
        ["topics", "drop", "x", "--tone", "calm"],
        ["list", "--status", "new"],
        ["generate", "t", "--reason", "x"]
      ]) {
        expect(() => parseCommand(argv), argv.join(" ")).toThrow(UsageError);
      }
    });

    it("collects, lists, accepts, drops and generates from the backlog", async () => {
      const collected = await cli(["research", "collect", "--json"]);
      expect(collected.code).toBe(0);
      expect(collected.json()).toMatchObject({
        command: "research collect",
        status: "ok",
        counts: { created: 6 }
      });

      // idempotent
      expect((await cli(["research", "collect", "--json"])).json().counts).toMatchObject({
        created: 0,
        refreshed: 6
      });

      const listed = await cli(["topics", "list", "--json"]);
      const [first, second] = listed.json().candidates as Array<{
        id: string;
        title: string;
        score: number;
      }>;
      expect(listed.json().candidates).toHaveLength(6);
      expect(first.score).toBeGreaterThanOrEqual(second.score);

      const accepted = await cli([
        "topics",
        "accept",
        first.id.slice(0, 8),
        "--tone",
        "calm",
        "--json"
      ]);
      expect(accepted.json().candidate).toMatchObject({
        status: "accepted",
        brief: { tone: "calm" }
      });
      expect(
        (await cli(["topics", "list", "--status", "accepted", "--json"])).json().candidates
      ).toHaveLength(1);

      const dropped = await cli(["topics", "drop", second.id, "--reason", "off topic", "--json"]);
      expect(dropped.json().candidate).toMatchObject({
        status: "dropped",
        decisionNote: "off topic"
      });

      // a dropped candidate cannot be generated and is not offered again as new
      const refused = await cli(["topics", "generate", second.id, "--json"]);
      expect(refused.code).toBe(1);
      expect(refused.json().error.code).toBe("invalid_state");
      await cli(["research", "collect", "--json"]);
      expect(
        (await cli(["topics", "list", "--status", "new", "--json"])).json().candidates
      ).toHaveLength(4);

      const generated = await cli(["topics", "generate", first.id, "--json"]);
      expect(generated.code).toBe(0);
      expect(generated.json()).toMatchObject({
        command: "generate",
        status: "published",
        topic: first.title,
        candidateId: first.id,
        brief: { tone: "calm" }
      });
      const used = (await cli(["topics", "list", "--status", "used", "--json"])).json().candidates;
      expect(used).toHaveLength(1);
      expect(used[0].workflowId).toBe(generated.json().workflowId);

      const again = await cli(["topics", "generate", first.id, "--json"]);
      expect(again.code).toBe(1);
      expect(again.json().error.message).toMatch(/already started run/);
    });

    it("prints readable output", async () => {
      const report = await cli(["research", "collect"]);
      expect(report.out.join("\n")).toContain("Backlog: 6 new");
      expect(report.out.join("\n")).toMatch(/published today|published \d+ days ago/);

      const list = await cli(["topics", "list"]);
      expect(list.out.join("\n")).toMatch(/new\s+Caching & Invalidation/);
    });

    it("reports an unknown candidate and a missing sources file", async () => {
      const missing = await cli(["topics", "accept", "deadbeef", "--json"]);
      expect(missing.code).toBe(1);
      expect(missing.json().error.code).toBe("not_found");

      const noFile = await cli(["research", "collect", "--json"], {
        OPENBLOG_RESEARCH_SOURCES_FILE: ""
      });
      expect(noFile.code).toBe(1);
      expect(noFile.json().error.code).toBe("sources_not_configured");
    });

    it("exits 1 only when every source failed", async () => {
      const out: string[] = [];
      const code = await runCli({
        argv: ["research", "collect", "--json"],
        env: env(),
        overrides: { fetcher: fakeFetcher({}), clock: () => NOW },
        stdout: (text) => out.push(text),
        stderr: () => undefined
      });
      expect(code).toBe(1);
      expect(JSON.parse(out.at(-1)!)).toMatchObject({ status: "failed", candidates: [] });
    });
  });

  describe("HTTP API", () => {
    const auth = { authorization: "Bearer topics-key" };

    const server = async (extra: Record<string, string> = {}) => {
      await open(extra);
      return buildServer({ application: app!, apiKey: "topics-key" });
    };

    it("needs the API key", async () => {
      const api = await server();
      expect((await api.inject({ method: "GET", url: "/topics" })).statusCode).toBe(401);
      expect((await api.inject({ method: "POST", url: "/topics/collect" })).statusCode).toBe(401);
      app = undefined; // the server disposed it
      await api.close();
    });

    it("collects, lists, accepts and drops", async () => {
      const api = await server();

      const collected = await api.inject({ method: "POST", url: "/topics/collect", headers: auth });
      expect(collected.statusCode).toBe(200);
      expect(collected.json().counts).toMatchObject({ created: 6 });
      expect(collected.json().candidates[0]).toMatchObject({ outcome: "created", status: "new" });

      const again = await api.inject({ method: "POST", url: "/topics/collect", headers: auth });
      expect(again.json().counts).toMatchObject({ created: 0, refreshed: 6 });

      const list = await api.inject({
        method: "GET",
        url: "/topics?status=new&limit=3",
        headers: auth
      });
      const candidates = list.json().candidates as Array<{
        id: string;
        breakdown: object;
        score: number;
      }>;
      expect(candidates).toHaveLength(3);
      expect(candidates[0].breakdown).toMatchObject({ recency: expect.any(Number) });

      const accept = await api.inject({
        method: "POST",
        url: `/topics/${candidates[0].id}/accept`,
        headers: auth,
        payload: { acceptedBy: "ana", brief: { tone: "calm" } }
      });
      expect(accept.statusCode).toBe(200);
      expect(accept.json()).toMatchObject({
        status: "accepted",
        decidedBy: "ana",
        brief: { tone: "calm" }
      });

      const drop = await api.inject({
        method: "POST",
        url: `/topics/${candidates[1].id}/drop`,
        headers: auth,
        payload: { reason: "stale" }
      });
      expect(drop.json()).toMatchObject({
        status: "dropped",
        decisionNote: "stale",
        decidedBy: "api"
      });

      const accepted = await api.inject({
        method: "GET",
        url: "/topics?status=accepted",
        headers: auth
      });
      expect(accepted.json().candidates).toHaveLength(1);

      app = undefined;
      await api.close();
    });

    it("answers with stable error codes", async () => {
      const api = await server();
      await api.inject({ method: "POST", url: "/topics/collect", headers: auth });
      const [{ id }] = (await api.inject({ method: "GET", url: "/topics", headers: auth })).json()
        .candidates;

      const unknown = await api.inject({
        method: "POST",
        url: "/topics/deadbeef/drop",
        headers: auth
      });
      expect([unknown.statusCode, unknown.json().code]).toEqual([404, "not_found"]);

      const badBrief = await api.inject({
        method: "POST",
        url: `/topics/${id}/accept`,
        headers: auth,
        payload: { brief: { minWords: 500, maxWords: 100 } }
      });
      expect([badBrief.statusCode, badBrief.json().code]).toEqual([400, "invalid_input"]);

      const unknownField = await api.inject({
        method: "POST",
        url: `/topics/${id}/accept`,
        headers: auth,
        payload: { brief: { topic: "x" } }
      });
      expect(unknownField.statusCode).toBe(400);

      const badStatus = await api.inject({
        method: "GET",
        url: "/topics?status=weird",
        headers: auth
      });
      expect(badStatus.statusCode).toBe(400);

      app = undefined;
      await api.close();
    });

    it("says so when the sources file is not configured", async () => {
      const api = await server({ OPENBLOG_RESEARCH_SOURCES_FILE: "" });
      const response = await api.inject({ method: "POST", url: "/topics/collect", headers: auth });
      expect([response.statusCode, response.json().code]).toEqual([503, "sources_not_configured"]);
      app = undefined;
      await api.close();
    });

    it("documents the endpoints", async () => {
      const api = await server();
      const spec = (await api.inject({ method: "GET", url: "/openapi.json" })).json();
      expect(Object.keys(spec.paths)).toEqual(
        expect.arrayContaining([
          "/topics",
          "/topics/collect",
          "/topics/{id}/accept",
          "/topics/{id}/drop"
        ])
      );
      app = undefined;
      await api.close();
    });
  });
});
