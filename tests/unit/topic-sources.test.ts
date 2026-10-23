import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseCommand, UsageError } from "../../apps/cli/src/args";
import { runCli } from "../../apps/cli/src/run";
import { collectTopics } from "../../packages/app/src";
import {
  canonicalizeUrl,
  collectTopicCandidates,
  FetchError,
  parseFeed,
  parseSourcesFile,
  SitemapTopicSource,
  SourcesConfigError,
  titleFromUrl,
  urlKey,
  type ContentFetcher,
  type TopicSourceConfig
} from "../../packages/research/src";
import { loadEnv } from "../../packages/config/src";
import { normalizeTopic } from "../../packages/types/src";

const fixtureDir = path.resolve(__dirname, "../fixtures/research");
const fixture = (name: string) => fs.readFileSync(path.join(fixtureDir, name), "utf8");
const SOURCES_FILE = path.join(fixtureDir, "sources.yaml");

type Reply = string | Error;

/** A fetcher port that answers from a map; nothing touches the network. */
function fakeFetcher(replies: Record<string, Reply>): ContentFetcher & { requested: string[] } {
  const requested: string[] = [];
  return {
    requested,
    async fetch({ url }) {
      requested.push(url);
      const reply = replies[url];
      if (reply === undefined) {
        throw new FetchError({
          code: "fetch_http_error",
          message: "Server answered 404",
          url,
          status: 404
        });
      }
      if (reply instanceof Error) {
        throw reply;
      }
      return {
        url,
        finalUrl: url,
        status: 200,
        contentType: "application/xml",
        size: reply.length,
        body: reply
      };
    }
  };
}

const config = (overrides: Partial<TopicSourceConfig> = {}): TopicSourceConfig => ({
  name: "Source",
  type: "feed",
  url: "https://example.com/feed.xml",
  weight: 1,
  include: [],
  exclude: [],
  ...overrides
});

const allReplies = (): Record<string, Reply> => ({
  "https://example.com/feed.xml": fixture("rss.xml"),
  "https://other.example.org/atom.xml": fixture("atom.xml"),
  "https://docs.example.net/sitemap.xml": fixture("sitemap.xml")
});

describe("feed parsing", () => {
  it("reads RSS 2.0: canonical URLs, plain text, dates, guid fallback, skips incomplete items", () => {
    const entries = parseFeed(fixture("rss.xml"), "https://example.com/feed.xml");

    expect(entries).toEqual([
      {
        title: "Caching & Invalidation: A Field Guide",
        url: "https://example.com/posts/caching-guide",
        publishedAt: "2026-10-06T09:30:00.000Z",
        summary: 'How to cache without "surprises".'
      },
      {
        title: "Sourdough for Beginners",
        url: "https://example.com/posts/sourdough",
        publishedAt: "2026-09-30T08:00:00.000Z",
        summary: "Flour, water, patience."
      },
      {
        title: "No link here, only a permalink guid",
        url: "https://example.com/posts/guid-only",
        publishedAt: undefined
      },
      {
        title: "Sponsored: buy our thing",
        url: "https://example.com/posts/sponsored",
        publishedAt: undefined
      }
    ]);
  });

  it("reads Atom: alternate link, published before updated, html summary", () => {
    const entries = parseFeed(fixture("atom.xml"), "https://other.example.org/atom.xml");

    expect(entries).toEqual([
      {
        title: "Caching & Invalidation: a field guide",
        url: "https://www.example.com/posts/caching-guide",
        publishedAt: "2026-10-06T09:30:00.000Z",
        summary: "A longer summary from the Atom feed."
      },
      {
        title: "Rust Lifetimes Explained",
        url: "https://other.example.org/rust-lifetimes",
        publishedAt: "2026-10-01T12:00:00.000Z",
        summary: "Borrowing, & more."
      }
    ]);
  });

  it("reads RSS 1.0 (RDF)", () => {
    const rdf = `<?xml version="1.0"?>
      <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
        <channel><title>x</title></channel>
        <item><title>Old format</title><link>https://old.example.com/a</link><dc:date>2026-01-02</dc:date></item>
      </rdf:RDF>`;

    expect(parseFeed(rdf, "https://old.example.com/rss")).toEqual([
      {
        title: "Old format",
        url: "https://old.example.com/a",
        publishedAt: "2026-01-02T00:00:00.000Z"
      }
    ]);
  });

  it("rejects malformed XML and documents that are not feeds", () => {
    expect(() => parseFeed(fixture("malformed.xml"), "https://x.test/")).toThrow(/Malformed XML/);
    expect(() => parseFeed("<html><body>hi</body></html>", "https://x.test/")).toThrow(
      /not an RSS or Atom feed/
    );
  });
});

describe("sitemap parsing", () => {
  it("builds titles from paths and keeps lastmod; skips the homepage, numbers and other schemes", async () => {
    const source = new SitemapTopicSource(
      config({ type: "sitemap", url: "https://docs.example.net/sitemap.xml" })
    );
    const { entries, warnings } = await source.collect(fakeFetcher(allReplies()));

    expect(entries).toEqual([
      {
        title: "Getting started with queues",
        url: "https://docs.example.net/guides/getting-started-with-queues.html",
        publishedAt: "2026-09-15T00:00:00.000Z"
      },
      {
        title: "Error handling",
        url: "https://docs.example.net/guides/error_handling",
        publishedAt: "2026-08-01T10:00:00.000Z"
      }
    ]);
    expect(warnings).toEqual([]);
  });

  it("follows a sitemap index; a broken child and a foreign host become warnings", async () => {
    const source = new SitemapTopicSource(
      config({ type: "sitemap", url: "https://docs.example.net/index.xml" })
    );
    const fetcher = fakeFetcher({
      "https://docs.example.net/index.xml": fixture("sitemap-index.xml"),
      "https://docs.example.net/sitemap-posts.xml": fixture("sitemap-posts.xml")
    });
    const { entries, warnings } = await source.collect(fetcher);

    expect(entries.map((entry) => entry.title)).toEqual(["Zero downtime deploys"]);
    expect(warnings).toHaveLength(2);
    expect(warnings.join("\n")).toMatch(/sitemap-missing\.xml/);
    expect(warnings.join("\n")).toMatch(/different site/);
    expect(fetcher.requested).not.toContain("https://elsewhere.example.com/sitemap.xml");
  });

  it("bounds the depth of nested indexes", async () => {
    const index = (child: string) =>
      `<sitemapindex><sitemap><loc>https://docs.example.net/${child}.xml</loc></sitemap></sitemapindex>`;
    const fetcher = fakeFetcher({
      "https://docs.example.net/a.xml": index("b"),
      "https://docs.example.net/b.xml": index("c"),
      "https://docs.example.net/c.xml": index("d"),
      "https://docs.example.net/d.xml": fixture("sitemap-posts.xml")
    });
    const { entries, warnings } = await new SitemapTopicSource(
      config({ type: "sitemap", url: "https://docs.example.net/a.xml" })
    ).collect(fetcher);

    expect(entries).toEqual([]);
    expect(warnings.join("\n")).toMatch(/below 3 levels/);
    expect(fetcher.requested).not.toContain("https://docs.example.net/d.xml");
  });

  it("derives titles from the last path segment", () => {
    expect(titleFromUrl("https://a.test/blog/how-to-cache.html")).toBe("How to cache");
    expect(titleFromUrl("https://a.test/caf%C3%A9_au_lait")).toBe("Café au lait");
    expect(titleFromUrl("https://a.test/")).toBeUndefined();
    expect(titleFromUrl("https://a.test/2024")).toBeUndefined();
  });
});

describe("collection", () => {
  const sources = parseSourcesFile(fs.readFileSync(SOURCES_FILE, "utf8"));

  it("merges feeds and sitemaps, filters, collapses duplicates across sources and sorts newest first", async () => {
    const { candidates, sources: reports } = await collectTopicCandidates(
      sources,
      fakeFetcher(allReplies())
    );

    expect(reports.map((report) => [report.name, report.status, report.count])).toEqual([
      ["Example Blog", "ok", 3], // "Sponsored" excluded
      ["Other Blog", "ok", 2],
      ["Docs", "ok", 2] // only the /guides/ pages
    ]);
    expect(candidates.map((candidate) => candidate.title)).toEqual([
      "Caching & Invalidation: a field guide",
      "Rust Lifetimes Explained",
      "Sourdough for Beginners",
      "Getting started with queues",
      "Error handling",
      "No link here, only a permalink guid"
    ]);
  });

  it("collapses the same article listed by two sources and keeps the heavier source's entry", async () => {
    const { candidates } = await collectTopicCandidates(sources, fakeFetcher(allReplies()));
    const caching = candidates.filter((candidate) => /caching/i.test(candidate.title));

    expect(caching).toEqual([
      {
        title: "Caching & Invalidation: a field guide",
        url: "https://www.example.com/posts/caching-guide",
        source: "Other Blog",
        weight: 2,
        publishedAt: "2026-10-06T09:30:00.000Z",
        summary: "A longer summary from the Atom feed."
      }
    ]);
  });

  it("collapses entries with the same URL or the same normalized title, filling gaps from the loser", async () => {
    const feed = (items: string) => `<rss version="2.0"><channel>${items}</channel></rss>`;
    const fetcher = fakeFetcher({
      "https://a.test/feed": feed(
        `<item><title>Same   URL</title><link>http://a.test/post/?utm_campaign=x</link><description>From A</description></item>
         <item><title>  Same Title </title><link>https://a.test/one</link></item>`
      ),
      "https://b.test/feed": feed(
        `<item><title>Another title entirely</title><link>https://www.a.test/post</link><pubDate>2026-05-05</pubDate></item>
         <item><title>same title</title><link>https://b.test/two</link></item>`
      )
    });

    const { candidates } = await collectTopicCandidates(
      [
        config({ name: "A", url: "https://a.test/feed" }),
        config({ name: "B", url: "https://b.test/feed" })
      ],
      fetcher
    );

    expect(candidates).toHaveLength(2);
    const byUrl = candidates.find((candidate) => /\/post$/.test(candidate.url))!;
    // equal weights: the first source wins, and takes the date it lacked from the duplicate
    expect(byUrl).toMatchObject({
      source: "A",
      summary: "From A",
      publishedAt: "2026-05-05T00:00:00.000Z"
    });
    expect(candidates.some((candidate) => candidate.url === "https://a.test/one")).toBe(true);
  });

  it("reports unreachable, malformed and wrong-type sources without throwing, and keeps the rest", async () => {
    const fetcher = fakeFetcher({
      "https://ok.test/feed": fixture("rss.xml"),
      "https://broken.test/feed": fixture("malformed.xml"),
      "https://html.test/feed": "<html><body>not a feed</body></html>",
      "https://feed-as-sitemap.test/sitemap.xml": fixture("rss.xml"),
      "https://blocked.test/feed": new FetchError({
        code: "fetch_blocked",
        message: "points to a private or reserved address",
        url: "https://blocked.test/feed"
      })
    });

    const { candidates, sources: reports } = await collectTopicCandidates(
      [
        config({ name: "ok", url: "https://ok.test/feed" }),
        config({ name: "broken", url: "https://broken.test/feed" }),
        config({ name: "html", url: "https://html.test/feed" }),
        config({ name: "gone", url: "https://gone.test/feed" }),
        config({ name: "blocked", url: "https://blocked.test/feed" }),
        config({
          name: "wrong",
          type: "sitemap",
          url: "https://feed-as-sitemap.test/sitemap.xml"
        })
      ],
      fetcher
    );

    expect(candidates.length).toBeGreaterThan(0);
    expect(reports.map((report) => [report.name, report.status, report.error?.code])).toEqual([
      ["ok", "ok", undefined],
      ["broken", "failed", "invalid_feed"],
      ["html", "failed", "invalid_feed"],
      ["gone", "failed", "fetch_http_error"],
      ["blocked", "failed", "fetch_blocked"],
      ["wrong", "failed", "invalid_feed"]
    ]);
  });

  it("returns nothing, not an error, when every source fails", async () => {
    const result = await collectTopicCandidates([config()], fakeFetcher({}));
    expect(result.candidates).toEqual([]);
    expect(result.sources[0].status).toBe("failed");
  });
});

describe("URL handling", () => {
  it("canonicalizes: tracking parameters, fragment, trailing slash, default port, query order", () => {
    expect(canonicalizeUrl("HTTPS://Example.COM:443/a/b/?b=2&utm_source=x&a=1#top")).toBe(
      "https://example.com/a/b?a=1&b=2"
    );
    expect(canonicalizeUrl("https://example.com/")).toBe("https://example.com");
    expect(canonicalizeUrl("ftp://example.com/")).toBeUndefined();
    expect(canonicalizeUrl("nonsense")).toBeUndefined();
  });

  it("compares URLs ignoring scheme and www", () => {
    expect(urlKey("http://www.example.com/x/")).toBe(urlKey("https://example.com/x"));
    expect(urlKey("https://example.com/x")).not.toBe(urlKey("https://example.com/y"));
  });

  it("shares its title normalization with duplicate detection", () => {
    expect(normalizeTopic("  A   Title ")).toBe("a title");
  });
});

describe("sources file", () => {
  it("applies defaults and accepts YAML or JSON", () => {
    const expected = [
      { name: "A", type: "feed", url: "https://a.test/rss", weight: 1, include: [], exclude: [] }
    ];
    expect(
      parseSourcesFile("sources:\n  - {name: A, type: feed, url: 'https://a.test/rss'}")
    ).toEqual(expected);
    expect(
      parseSourcesFile(
        JSON.stringify({ sources: [{ name: "A", type: "feed", url: "https://a.test/rss" }] })
      )
    ).toEqual(expected);
  });

  it.each([
    ["not an object", "- just\n- a list"],
    ["no sources", "sources: []"],
    ["unknown type", "sources:\n  - {name: A, type: twitter, url: 'https://a.test'}"],
    ["non-http url", "sources:\n  - {name: A, type: feed, url: 'ftp://a.test/x'}"],
    ["unknown field", "sources:\n  - {name: A, type: feed, url: 'https://a.test', colour: red}"],
    ["negative weight", "sources:\n  - {name: A, type: feed, url: 'https://a.test', weight: -1}"],
    [
      "duplicate names",
      "sources:\n  - {name: A, type: feed, url: 'https://a.test'}\n  - {name: a, type: sitemap, url: 'https://b.test'}"
    ],
    ["invalid yaml", "sources: [unclosed"]
  ])("rejects %s", (_name, content) => {
    expect(() => parseSourcesFile(content, "test file")).toThrow(SourcesConfigError);
    expect(() => parseSourcesFile(content, "test file")).toThrow(/test file/);
  });
});

describe("collectTopics (application layer)", () => {
  it("needs the sources file", async () => {
    await expect(collectTopics(loadEnv({}), fakeFetcher({}))).rejects.toThrow(
      /OPENBLOG_RESEARCH_SOURCES_FILE is not set/
    );
  });

  it("names the file when it cannot be read", async () => {
    const missing = path.join(fixtureDir, "nope.yaml");
    await expect(
      collectTopics(loadEnv({ OPENBLOG_RESEARCH_SOURCES_FILE: missing }), fakeFetcher({}))
    ).rejects.toThrow(/nope\.yaml/);
  });
});

describe("research collect (CLI)", () => {
  const run = async (argv: string[], replies: Record<string, Reply>, env = {}) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runCli({
      argv,
      env: { OPENBLOG_RESEARCH_SOURCES_FILE: SOURCES_FILE, ...env },
      fetcher: fakeFetcher(replies),
      stdout: (text) => out.push(text),
      stderr: (text) => err.push(text)
    });
    return { code, out, err };
  };

  it("parses the command and refuses other subcommands", () => {
    expect(parseCommand(["research", "collect", "--json"])).toMatchObject({
      name: "research",
      action: "collect",
      options: { json: true }
    });
    expect(() => parseCommand(["research"])).toThrow(UsageError);
    expect(() => parseCommand(["research", "score"])).toThrow(UsageError);
    expect(() => parseCommand(["research", "collect", "extra"])).toThrow(UsageError);
  });

  it("prints a JSON summary with per-source results and candidates", async () => {
    const { code, out } = await run(["research", "collect", "--json"], allReplies());
    const summary = JSON.parse(out.at(-1)!);

    expect(code).toBe(0);
    expect(summary).toMatchObject({ command: "research collect", status: "ok", exitCode: 0 });
    expect(summary.sources).toHaveLength(3);
    expect(summary.candidates).toHaveLength(6);
    expect(summary.candidates[0]).toMatchObject({
      title: "Caching & Invalidation: a field guide",
      source: "Other Blog"
    });
  });

  it("prints a readable report, including failed sources, and still succeeds", async () => {
    const replies = allReplies();
    delete replies["https://other.example.org/atom.xml"];
    const { code, out } = await run(["research", "collect"], replies);

    expect(code).toBe(0);
    expect(out.join("\n")).toContain("Other Blog (feed): FAILED fetch_http_error");
    expect(out.join("\n")).toContain("Example Blog (feed): 3 entries");
    expect(out.join("\n")).toMatch(/Candidates \(\d+\):/);
  });

  it("fails (exit 1) when every source fails", async () => {
    const { code, out } = await run(["research", "collect", "--json"], {});
    expect(code).toBe(1);
    expect(JSON.parse(out.at(-1)!)).toMatchObject({ status: "failed", candidates: [] });
  });

  it("fails clearly when the sources file is not configured", async () => {
    const { code, out } = await run(
      ["research", "collect", "--json"],
      {},
      { OPENBLOG_RESEARCH_SOURCES_FILE: "" }
    );
    expect(code).toBe(1);
    expect(JSON.parse(out.at(-1)!).error.message).toMatch(/OPENBLOG_RESEARCH_SOURCES_FILE/);
  });
});
