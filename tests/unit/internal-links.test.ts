import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  selectRelatedArticles,
  validateArticle,
  type PublishedArticle
} from "../../packages/agents/src";
import { buildWriterPrompt } from "../../packages/agents/src/prompts/writer";
import { createApplication, type Application } from "../../packages/app/src";
import { loadEnv } from "../../packages/config/src";
import { goodArticle } from "../fixtures/articles";
import { routedProvider, type Reply } from "../mocks/routed-provider";

const article = (overrides: Partial<PublishedArticle> = {}): PublishedArticle => ({
  workflowId: "w1",
  title: "Caching strategies for busy APIs",
  slug: "caching-strategies-busy-apis",
  category: "Backend",
  tags: ["caching", "redis"],
  url: "https://blog.test/caching-strategies/",
  ...overrides
});

describe("selecting related articles", () => {
  const query = {
    topic: "Caching",
    targetKeyword: "cache invalidation",
    outline: ["Why caching matters", "Choosing a cache strategy"]
  };

  it("ranks by shared words in title, tags, slug and category, and keeps only related ones", () => {
    const articles = [
      article({ workflowId: "tags", title: "Unrelated heading", tags: ["caching"], slug: "x" }),
      article({ workflowId: "none", title: "Sourdough starters", tags: ["bread"], slug: "bread" }),
      article({ workflowId: "title", title: "Cache invalidation patterns", tags: [], slug: "p" }),
      article({ workflowId: "slugonly", title: "Nothing here", tags: [], slug: "caching-notes" })
    ];

    expect(selectRelatedArticles(query, articles, 5).map((link) => link.workflowId)).toEqual([
      "title",
      "tags"
    ]);
  });

  it("returns title and address only, at most `max`, and nothing when off", () => {
    const articles = [
      article({ workflowId: "a" }),
      article({ workflowId: "b", url: "https://blog.test/b/" }),
      article({ workflowId: "c", url: "https://blog.test/c/" })
    ];

    expect(selectRelatedArticles(query, articles, 2)).toEqual([
      { workflowId: "a", title: article().title, url: article().url },
      { workflowId: "b", title: article().title, url: "https://blog.test/b/" }
    ]);
    expect(selectRelatedArticles(query, articles, 0)).toEqual([]);
    expect(selectRelatedArticles(query, [], 3)).toEqual([]);
  });

  it("is deterministic: equal scores keep the given order (newest first)", () => {
    const articles = ["z", "y", "x"].map((id) => article({ workflowId: id }));
    expect(selectRelatedArticles(query, articles, 3).map((link) => link.workflowId)).toEqual([
      "z",
      "y",
      "x"
    ]);
  });

  it("uses the keywords and the outline, not only the topic", () => {
    expect(
      selectRelatedArticles({ topic: "Latency", secondaryKeywords: ["redis"] }, [article()], 3)
    ).toHaveLength(1);
    expect(
      selectRelatedArticles({ topic: "Latency", outline: ["Measuring caching"] }, [article()], 3)
    ).toHaveLength(1);
    expect(selectRelatedArticles({ topic: "Latency" }, [article()], 3)).toEqual([]);
  });
});

describe("the writer prompt", () => {
  it("lists the offered articles and forbids other pages of the site", () => {
    const prompt = buildWriterPrompt("Caching", ["a", "b", "c"], {
      internalLinks: [{ title: "Caching strategies", url: "https://blog.test/caching-strategies/" }]
    });

    expect(prompt).toContain("Internal links:");
    expect(prompt).toContain("Caching strategies: https://blog.test/caching-strategies/");
    expect(prompt).toContain("do not link to any other page of this site");
  });

  it("is unchanged without offered articles", () => {
    expect(buildWriterPrompt("Caching", ["a"], { internalLinks: [] })).toBe(
      buildWriterPrompt("Caching", ["a"])
    );
  });
});

describe("internal links in the quality gate", () => {
  const rules = { minWords: 1, minH2: 0, minOutlineCoverage: 0 };
  const offered = { urls: ["https://blog.test/caching-strategies/"] };
  const check = (
    text: string,
    internalLinks: { urls: string[]; origins?: string[] } | undefined,
    sources?: string[]
  ) =>
    validateArticle({ article: text, internalLinks, sources }, rules).violations.map(
      (violation) => violation.code
    );

  it("does nothing when internal linking is off", () => {
    expect(check("See https://blog.test/anything.", undefined)).toEqual([]);
  });

  it("accepts the offered links, however they are written, and links elsewhere", () => {
    expect(check("[a](https://blog.test/caching-strategies/)", offered)).toEqual([]);
    expect(check("[a](http://www.blog.test/caching-strategies?utm_source=x#top)", offered)).toEqual(
      []
    );
    expect(check("[a](https://other.example/page)", offered)).toEqual([]);
    expect(check("No links at all.", offered)).toEqual([]);
  });

  it("rejects an invented page of the same site", () => {
    expect(check("[a](https://blog.test/made-up-post/)", offered)).toEqual([
      "internal_link_not_offered"
    ]);
    expect(
      check("[a](https://blog.test/caching-strategies/) and https://blog.test/other", offered)
    ).toEqual(["internal_link_not_offered"]);
  });

  it("knows the site from its address even when no article was offered", () => {
    expect(
      check("[a](https://blog.test/made-up/)", { urls: [], origins: ["https://blog.test"] })
    ).toEqual(["internal_link_not_offered"]);
    expect(check("[a](https://blog.test/made-up/)", { urls: [] })).toEqual([]);
  });

  it("lets a source on the same site through, and offered links count as allowed beside sources", () => {
    const source = "https://blog.test/cited-source/";
    expect(check(`[s](${source})`, offered, [source])).toEqual([]);
    expect(
      check(`[s](${source}) [o](https://blog.test/caching-strategies/)`, offered, [source])
    ).toEqual([]);
    // the offered link alone is not a source
    expect(check("[o](https://blog.test/caching-strategies/)", offered, [source])).toEqual([
      "references_missing"
    ]);
  });
});

describe("internal links in a run (offline end to end)", () => {
  const outline = ["Why caching matters", "Choosing a cache strategy", "Invalidation in practice"];
  const seo = JSON.stringify({
    title: "Caching made simple",
    metaDescription: "Caching made simple: how to cache well.",
    slug: "caching-made-simple",
    h1: "Caching",
    headings: [{ level: "H2", text: "Why caching matters" }]
  });
  const OFFERED = "https://blog.test/caching-strategies/";
  const SECOND = "https://blog.test/cache-invalidation-patterns/";
  const linked = `${goodArticle}\n\nSee [Caching strategies](${OFFERED}).\n`;

  const queues = (writer: string | string[] = linked) => {
    const articles = Array.isArray(writer) ? writer : [writer];
    return {
      planner: [JSON.stringify(outline)] as Reply[],
      writer: articles as Reply[],
      editor: articles.map((text) =>
        JSON.stringify({ editedText: text, changesSummary: "tidied" })
      ) as Reply[],
      seo: [seo] as Reply[],
      classification: [JSON.stringify({ category: "News", tags: ["ai"] })] as Reply[]
    };
  };

  const silent = { info() {}, warn() {}, error() {}, debug() {} };
  let dir: string;
  let app: Application | undefined;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "openblog-links-"));
  });

  afterEach(async () => {
    await app?.dispose();
    app = undefined;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function start(llm: ReturnType<typeof routedProvider>, env: Record<string, string> = {}) {
    app = await createApplication(
      loadEnv({
        OPENBLOG_OUTPUT_DIR: path.join(dir, "out"),
        OPENBLOG_MEMORY_DB_PATH: path.join(dir, "memory.db"),
        OPENBLOG_TAXONOMY_CATEGORIES: "News",
        OPENBLOG_TAXONOMY_TAGS: "ai",
        OPENBLOG_LOG_LEVEL: "fatal",
        ...env
      }),
      { llm: llm as never, logger: silent }
    );
    return app;
  }

  /** A published article as `approve` leaves it. */
  function seed(
    id: string,
    title: string,
    options: {
      tags?: string[];
      url?: string | null;
      publisherId?: string;
      status?: string;
      reviewState?: string;
    } = {}
  ) {
    const db = new Database(path.join(dir, "memory.db"));
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO workflows (id, name, topic, topic_normalized, status, metadata_json, started_at, created_at, updated_at)
       VALUES (?, 'w', ?, ?, ?, '{}', ?, ?, ?)`
    ).run(id, title, title.toLowerCase(), options.status ?? "published", now, now, now);
    db.prepare(
      `INSERT INTO articles (id, workflow_id, topic, title, slug, category, tags_json, article_markdown, edited_markdown,
                             seo_json, publish_result_json, publish_remote_url, review_state, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'Backend', ?, '', '', '{}', ?, ?, ?, ?, ?)`
    ).run(
      `a-${id}`,
      id,
      title,
      title,
      title.toLowerCase().replaceAll(" ", "-"),
      JSON.stringify(options.tags ?? []),
      JSON.stringify({ success: true, publisherId: options.publisherId ?? "markdown" }),
      options.url === undefined ? `https://blog.test/${id}/` : options.url,
      options.reviewState ?? "published",
      now,
      now
    );
    db.close();
  }

  const stepNames = () => {
    const db = new Database(path.join(dir, "memory.db"), { readonly: true });
    try {
      return (
        db.prepare("SELECT step FROM workflow_steps ORDER BY rowid").all() as Array<{
          step: string;
        }>
      ).map((row) => row.step);
    } finally {
      db.close();
    }
  };

  const on = { OPENBLOG_INTERNAL_LINKS_MAX: "2" };

  it("is off by default: no step, no extra prompt text", async () => {
    const llm = routedProvider(queues(goodArticle));
    const application = await start(llm);
    seed("caching-strategies", "Caching strategies for busy APIs", { url: OFFERED });

    const result = await application.workflow.run({ topic: "Caching" });

    expect(result.status).toBe("awaiting_approval");
    expect(stepNames()).not.toContain("find_links");
    expect(llm.prompts.find((entry) => entry.agent === "writer")!.prompt).not.toContain(
      "Internal links"
    );
  });

  it("offers only related articles that are live, with a public address, on the same target", async () => {
    const llm = routedProvider(queues());
    const application = await start(llm, { ...on, OPENBLOG_DEFAULT_PUBLISHER: "markdown" });
    seed("caching-strategies", "Caching strategies for busy APIs", {
      url: OFFERED,
      tags: ["caching"]
    });
    seed("cache-invalidation", "Cache invalidation patterns", { url: SECOND });
    seed("unrelated", "Sourdough starters", { url: "https://blog.test/sourdough/" });
    seed("draft", "Caching drafts", {
      url: "https://blog.test/draft/",
      status: "awaiting_approval",
      reviewState: "needs_review"
    });
    seed("file", "Caching on disk", { url: "output/articles/caching.md" });
    seed("nourl", "Caching without address", { url: null });
    seed("elsewhere", "Caching on another site", {
      url: "https://wp.test/elsewhere/",
      publisherId: "wordpress"
    });

    const result = await application.workflow.run({ topic: "Caching" });

    expect(result.status).toBe("awaiting_approval");
    const writer = llm.prompts.filter((entry) => entry.agent === "writer").at(-1)!.prompt;
    expect(writer).toContain("Internal links:");
    expect(writer).toContain(`Caching strategies for busy APIs: ${OFFERED}`);
    expect(writer).toContain(`Cache invalidation patterns: ${SECOND}`);
    for (const absent of ["sourdough", "draft/", "caching.md", "wp.test", "without address"]) {
      expect(writer).not.toContain(absent);
    }
  });

  it("stores the offered links as the step output and never offers more than the maximum", async () => {
    const llm = routedProvider(queues());
    const application = await start(llm, { OPENBLOG_INTERNAL_LINKS_MAX: "1" });
    seed("caching-strategies", "Caching strategies for busy APIs", { url: OFFERED });
    seed("cache-invalidation", "Cache invalidation patterns", { url: SECOND });

    await application.workflow.run({ topic: "Caching" });

    const db = new Database(path.join(dir, "memory.db"), { readonly: true });
    const row = db
      .prepare("SELECT output_json FROM workflow_steps WHERE step = 'find_links'")
      .get() as { output_json: string };
    db.close();
    expect(JSON.parse(row.output_json).internalLinks).toHaveLength(1);
    expect(stepNames()).toEqual(expect.arrayContaining(["planner", "find_links", "writer"]));
    expect(stepNames().indexOf("find_links")).toBeGreaterThan(stepNames().indexOf("planner"));
    expect(stepNames().indexOf("find_links")).toBeLessThan(stepNames().indexOf("writer"));
  });

  it("parks an article that links to a page of the site that was not offered", async () => {
    const invented = `${goodArticle}\n\nSee [Made up](https://blog.test/made-up-post/).\n`;
    const llm = routedProvider(queues(invented));
    const application = await start(llm, { ...on, OPENBLOG_QUALITY_MAX_ATTEMPTS: "0" });
    seed("caching-strategies", "Caching strategies for busy APIs", { url: OFFERED });

    const result = await application.workflow.run({ topic: "Caching" });

    expect(result.status).toBe("needs_review");
    expect(
      result.status === "needs_review" && result.violations.map((violation) => violation.code)
    ).toEqual(["internal_link_not_offered"]);
  });

  it("regenerates when the first draft invents a link", async () => {
    const invented = `${goodArticle}\n\nSee [Made up](https://blog.test/made-up-post/).\n`;
    const llm = routedProvider(queues([invented, linked]));
    const application = await start(llm, on);
    seed("caching-strategies", "Caching strategies for busy APIs", { url: OFFERED });

    const result = await application.workflow.run({ topic: "Caching" });

    expect(result.status).toBe("awaiting_approval");
    expect(llm.calls("writer")).toBe(2);
    expect(llm.prompts.filter((entry) => entry.agent === "writer")[1]!.prompt).toContain(
      "internal_link_not_offered"
    );
  });

  it("resume and revise keep the links the writer was offered", async () => {
    const queue = queues();
    const llm = routedProvider({
      ...queue,
      planner: [new Error("planner down"), JSON.stringify(outline)]
    });
    const application = await start(llm, on);
    seed("caching-strategies", "Caching strategies for busy APIs", { url: OFFERED });

    await expect(application.workflow.run({ topic: "Caching" })).rejects.toThrow();
    // an article published after the failure is not offered to the resumed run's find_links step
    seed("cache-invalidation", "Cache invalidation patterns", { url: SECOND });
    const { workflowId } = (await application.listRuns()).find((run) => run.topic === "Caching")!;
    const resumed = await application.workflow.resume(workflowId);

    expect(resumed.status).toBe("awaiting_approval");
    expect(stepNames().filter((name) => name === "find_links")).toHaveLength(1);

    const pending = await application.workflow.revise(workflowId, {
      revisedBy: "ana",
      feedback: "tighter"
    });
    await pending.execute();
    expect(stepNames().filter((name) => name === "find_links")).toHaveLength(1);
    const writers = llm.prompts.filter((entry) => entry.agent === "writer");
    expect(writers.at(-1)!.prompt).toContain(OFFERED);
  });
});
