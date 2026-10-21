import { afterEach, describe, expect, it, vi } from "vitest";

import { logger } from "../../packages/logger/src";
import {
  GhostPublisher,
  createGhostToken,
  createPublishersFromConfig,
  ghostAdminBase,
  type PublishArticle
} from "../../packages/publishers/src";
import {
  GHOST_ADMIN_KEY,
  GHOST_KEY_ID,
  GHOST_SITE,
  stubGhost,
  verifyGhostToken
} from "../mocks/fake-ghost";

const article: PublishArticle = {
  title: "Hello",
  slug: "hello",
  summary: "Summary",
  content: "# Hello\n\nSome **bold** text.\n\n<script>alert(1)</script>",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  tags: ["ai", "news"],
  category: "News",
  author: "OpenBlogAgent",
  language: "en",
  target: "ghost"
};

const publisher = (overrides: Partial<ConstructorParameters<typeof GhostPublisher>[0]> = {}) =>
  new GhostPublisher({ endpoint: GHOST_SITE, apiKey: GHOST_ADMIN_KEY, ...overrides }, logger);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Ghost Admin API token", () => {
  it("is an HS256 JWT for the key id, valid for five minutes, audience /admin/", () => {
    const now = new Date("2026-03-01T10:00:00.000Z");
    const token = createGhostToken(GHOST_ADMIN_KEY, now);

    const checked = verifyGhostToken(`Ghost ${token}`);
    expect(checked.valid).toBe(true);
    expect(checked.header).toEqual({ alg: "HS256", typ: "JWT", kid: GHOST_KEY_ID });
    const iat = Math.floor(now.getTime() / 1000);
    expect(checked.payload).toEqual({ iat, exp: iat + 300, aud: "/admin/" });
  });

  it("is not accepted when signed with another secret", () => {
    const token = createGhostToken(`${GHOST_KEY_ID}:${"ab".repeat(32)}`);
    expect(verifyGhostToken(`Ghost ${token}`).valid).toBe(false);
  });

  it("builds the Admin API base from a site URL", () => {
    for (const endpoint of [
      "https://blog.test",
      "https://blog.test/",
      "https://blog.test/ghost/api/admin/"
    ]) {
      expect(ghostAdminBase(endpoint)).toBe("https://blog.test/ghost/api/admin");
    }
  });
});

describe("Ghost publisher", () => {
  it("creates a draft with slug, sanitized HTML and tags", async () => {
    const ghost = stubGhost();

    const result = await publisher().publish({ ...article, status: "draft" });

    expect(result).toMatchObject({
      success: true,
      publisherId: "ghost",
      metadata: {
        id: "post1",
        link: `${GHOST_SITE}/hello/`,
        status: "draft",
        slug: "hello",
        action: "created"
      }
    });
    const write = ghost.requests.find((request) => request.method === "POST")!;
    expect(write.url).toBe(`${GHOST_SITE}/ghost/api/admin/posts/?source=html`);
    expect(write.headers["Accept-Version"]).toMatch(/^v5/);
    const sent = write.body!.posts[0]!;
    expect(sent).toMatchObject({
      title: "Hello",
      slug: "hello",
      status: "draft",
      custom_excerpt: "Summary",
      // The category is the primary tag.
      tags: [{ name: "News" }, { name: "ai" }, { name: "news" }]
    });
    expect(sent.html).toContain("<h1>Hello</h1>");
    expect(sent.html).toContain("<strong>bold</strong>");
    expect(sent.html).not.toContain("<script");
  });

  it("is a draft unless the article asks to be published", async () => {
    const ghost = stubGhost();

    await publisher().publish(article);
    expect(ghost.posts[0]!.status).toBe("draft");

    const live = stubGhost();
    await publisher().publish({ ...article, status: "publish" });
    expect(live.posts[0]!.status).toBe("published");
  });

  it("updates instead of duplicating when published again", async () => {
    const ghost = stubGhost();
    const first = await publisher().publish({ ...article, status: "draft" });
    const second = await publisher().publish({
      ...article,
      title: "Hello again",
      status: "draft"
    });

    expect(first.metadata?.action).toBe("created");
    expect(second).toMatchObject({
      success: true,
      metadata: { id: "post1", action: "updated" }
    });
    expect(ghost.posts).toHaveLength(1);
    expect(ghost.posts[0]!.title).toBe("Hello again");
  });

  it("keeps a live post live when a draft update arrives, and publishes a draft on request", async () => {
    const ghost = stubGhost();
    await publisher().publish({ ...article, status: "publish" });

    const draftUpdate = await publisher().publish({ ...article, status: "draft" });
    expect(draftUpdate.metadata?.status).toBe("published");
    const put = ghost.requests.filter((request) => request.method === "PUT")[0]!;
    expect(put.body!.posts[0]).not.toHaveProperty("status");

    const ghost2 = stubGhost();
    await publisher().publish({ ...article, status: "draft" });
    const live = await publisher().publish({ ...article, status: "publish" });
    expect(live.metadata?.status).toBe("published");
    expect(ghost2.posts).toHaveLength(1);
  });

  it("finds an existing post by slug for the duplicate policy", async () => {
    stubGhost();
    const ghostPublisher = publisher();
    expect(await ghostPublisher.findExisting({ slug: "hello" })).toBeNull();

    await ghostPublisher.publish(article);

    expect(await ghostPublisher.findExisting({ slug: "hello" })).toEqual({
      id: "post1",
      url: `${GHOST_SITE}/hello/`
    });
  });

  it("signs every request with a fresh valid token", async () => {
    const ghost = stubGhost();

    await publisher().publish(article);

    expect(ghost.requests.length).toBeGreaterThanOrEqual(2);
    for (const request of ghost.requests) {
      expect(verifyGhostToken(request.headers.Authorization).valid).toBe(true);
    }
  });

  it("reports distinct error codes and never claims success", async () => {
    stubGhost({ failWrites: [500] });
    const server = await publisher().publish(article);
    expect(server).toMatchObject({ success: false, error: { code: "server_error" } });
    expect(server.error?.details).toMatchObject({ status: 500 });

    stubGhost({ failWrites: [422] });
    expect(await publisher().publish(article)).toMatchObject({
      success: false,
      error: { code: "invalid_request" }
    });

    stubGhost({ failWrites: [401] });
    expect(await publisher().publish(article)).toMatchObject({
      success: false,
      error: { code: "auth_failed" }
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );
    expect(await publisher().publish(article)).toMatchObject({
      success: false,
      error: { code: "network_error" }
    });
  });

  it("fails on a response that is not a post", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === "GET"
          ? new Response("{}", { status: 404 })
          : new Response(JSON.stringify({ posts: [{ nope: true }] }), { status: 201 })
      )
    );

    expect(await publisher().publish(article)).toMatchObject({
      success: false,
      error: { code: "unexpected_response" }
    });
  });

  it("rejects missing or malformed settings without any request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const noKey = await publisher({ apiKey: undefined }).publish(article);
    const badKey = await publisher({ apiKey: "not-a-key" }).publish(article);
    const badUrl = await publisher({ endpoint: "ftp://blog.test" }).publish(article);

    for (const result of [noKey, badKey, badUrl]) {
      expect(result).toMatchObject({ success: false, error: { code: "validation_failed" } });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not leak the key into the error message or the log", async () => {
    stubGhost({ failWrites: [500] });
    const result = await publisher().publish(article);

    expect(JSON.stringify(result)).not.toContain("00112233445566778899");
  });
});

describe("publisher factory", () => {
  it("registers Ghost only when it is configured", () => {
    const without = createPublishersFromConfig({ markdown: { outputDir: "output" } }, logger);
    expect(without.map((p) => p.id)).toEqual(["markdown"]);

    const withGhost = createPublishersFromConfig(
      {
        markdown: { outputDir: "output" },
        ghost: { endpoint: GHOST_SITE, apiKey: GHOST_ADMIN_KEY }
      },
      logger
    );
    expect(withGhost.map((p) => p.id)).toEqual(["markdown", "ghost"]);
  });
});
