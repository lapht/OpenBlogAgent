import { afterAll, describe, expect, it } from "vitest";

import { logger } from "../../packages/logger/src";
import {
  basicAuthHeader,
  createPublishersFromConfig,
  normalizeWordPressEndpoint,
  type PublishArticle
} from "../../packages/publishers/src";
import { liveEnvAll, liveSlug } from "./env";

const env = liveEnvAll(
  "OPENBLOG_LIVE_WORDPRESS_ENDPOINT",
  "OPENBLOG_LIVE_WORDPRESS_USERNAME",
  "OPENBLOG_LIVE_WORDPRESS_APPLICATION_PASSWORD"
);

describe.skipIf(!env)("WordPress (live)", () => {
  const endpoint = normalizeWordPressEndpoint(env?.OPENBLOG_LIVE_WORDPRESS_ENDPOINT ?? "");
  const authorization = basicAuthHeader(
    env?.OPENBLOG_LIVE_WORDPRESS_USERNAME ?? "",
    env?.OPENBLOG_LIVE_WORDPRESS_APPLICATION_PASSWORD ?? ""
  );
  const slug = liveSlug();
  let createdId: number | undefined;

  afterAll(async () => {
    // Look the post up by slug as well: a failed assertion must not leave anything behind.
    const found = (await fetch(`${endpoint}/posts?slug=${slug}&status=any`, {
      headers: { Authorization: authorization }
    }).then((response) => response.json())) as Array<{ id: number }>;
    for (const id of new Set([createdId, ...found.map((post) => post.id)])) {
      if (id === undefined) continue;
      await fetch(`${endpoint}/posts/${id}?force=true`, {
        method: "DELETE",
        headers: { Authorization: authorization }
      });
    }
  });

  it("publishes a draft, finds it by slug and updates it in place", async () => {
    // Real taxonomy lookups, but nothing is created on the site (`allowCreate` stays false).
    const [publisher] = createPublishersFromConfig(
      {
        wordpress: {
          endpoint,
          username: env?.OPENBLOG_LIVE_WORDPRESS_USERNAME,
          applicationPassword: env?.OPENBLOG_LIVE_WORDPRESS_APPLICATION_PASSWORD,
          status: "draft"
        }
      },
      logger
    );
    if (!publisher) throw new Error("WordPress publisher was not built");
    const article: PublishArticle = {
      title: "OpenBlogAgent live smoke test",
      slug,
      summary: "Created by an automated test; safe to delete.",
      content: "# Live smoke test\n\nThis draft is removed automatically.",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tags: [],
      category: "Uncategorized",
      author: "OpenBlogAgent",
      language: "en",
      status: "draft",
      target: "wordpress"
    };

    const created = await publisher.publish(article);
    expect(created.error).toBeUndefined();
    expect(created.success).toBe(true);
    expect(created.metadata).toMatchObject({ slug, status: "draft", action: "created" });
    createdId = created.metadata?.id as number;

    expect(await publisher.findExisting?.({ slug })).toMatchObject({ id: String(createdId) });

    const updated = await publisher.publish({
      ...article,
      title: "OpenBlogAgent live smoke test v2"
    });
    expect(updated.metadata).toMatchObject({ id: createdId, action: "updated", status: "draft" });
  });
});
