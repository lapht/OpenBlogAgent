import { afterAll, describe, expect, it } from "vitest";

import { logger } from "../../packages/logger/src";
import {
  GhostPublisher,
  createGhostToken,
  ghostAdminBase,
  GHOST_ACCEPT_VERSION,
  type PublishArticle
} from "../../packages/publishers/src";
import { liveEnvAll, liveSlug } from "./env";

const env = liveEnvAll("OPENBLOG_LIVE_GHOST_ENDPOINT", "OPENBLOG_LIVE_GHOST_ADMIN_API_KEY");

describe.skipIf(!env)("Ghost (live)", () => {
  const endpoint = env?.OPENBLOG_LIVE_GHOST_ENDPOINT ?? "";
  const apiKey = env?.OPENBLOG_LIVE_GHOST_ADMIN_API_KEY ?? "";
  const base = ghostAdminBase(endpoint);
  const slug = liveSlug();
  const headers = () => ({
    "Accept-Version": GHOST_ACCEPT_VERSION,
    Authorization: `Ghost ${createGhostToken(apiKey)}`
  });

  afterAll(async () => {
    // Delete by slug, so a failed assertion cannot leave the draft behind.
    const response = await fetch(`${base}/posts/slug/${slug}/`, { headers: headers() });
    if (!response.ok) return;
    const { posts } = (await response.json()) as { posts: Array<{ id: string }> };
    for (const post of posts) {
      await fetch(`${base}/posts/${post.id}/`, { method: "DELETE", headers: headers() });
    }
  });

  it("publishes a draft, finds it by slug and updates it in place", async () => {
    const publisher = new GhostPublisher({ endpoint, apiKey, status: "draft" }, logger);
    const article: PublishArticle = {
      title: "OpenBlogAgent live smoke test",
      slug,
      summary: "Created by an automated test; safe to delete.",
      content: "# Live smoke test\n\nThis draft is removed automatically.",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tags: ["openblog-live-test"],
      category: "openblog-live-test",
      author: "OpenBlogAgent",
      language: "en",
      status: "draft",
      target: "ghost"
    };

    const created = await publisher.publish(article);
    expect(created.error).toBeUndefined();
    expect(created.success).toBe(true);
    expect(created.metadata).toMatchObject({ slug, status: "draft", action: "created" });
    const id = created.metadata?.id as string;

    expect(await publisher.findExisting?.({ slug })).toMatchObject({ id });

    const updated = await publisher.publish({
      ...article,
      title: "OpenBlogAgent live smoke test v2"
    });
    expect(updated.metadata).toMatchObject({ id, action: "updated", status: "draft" });
  });
});
