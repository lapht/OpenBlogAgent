import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logger } from "../../packages/logger/src";
import {
  WordPressCategoryProvider,
  WordPressTagProvider,
  type TaxonomyProviderConfig
} from "../../packages/publishers/src";

const ENDPOINT = "https://example.com/wp-json/wp/v2";

type Term = { id: number; name: string };

/** In-memory fake of the WordPress terms endpoints, with pagination and creation. */
function fakeWordPress(initial: { categories?: Term[]; tags?: Term[] }) {
  const store = { categories: [...(initial.categories ?? [])], tags: [...(initial.tags ?? [])] };
  let nextId = 1000;
  const calls: { method: string; url: string }[] = [];

  const mock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const method = init?.method ?? "GET";
    calls.push({ method, url: input });
    const kind = url.pathname.endsWith("/tags") ? "tags" : "categories";

    if (method === "POST") {
      const { name } = JSON.parse(String(init?.body));
      const term = { id: nextId++, name };
      store[kind].push(term);
      return { ok: true, status: 201, headers: new Headers(), json: async () => term };
    }

    const perPage = Number(url.searchParams.get("per_page"));
    const page = Number(url.searchParams.get("page") ?? "1");
    const slice = store[kind].slice((page - 1) * perPage, page * perPage);
    return {
      ok: true,
      status: 200,
      headers: new Headers({ "X-WP-TotalPages": String(Math.ceil(store[kind].length / perPage)) }),
      json: async () => slice
    };
  });
  vi.stubGlobal("fetch", mock);
  return { mock, calls, store };
}

function options(overrides: Partial<TaxonomyProviderConfig> = {}) {
  return {
    endpoint: ENDPOINT,
    username: "user",
    applicationPassword: "app pass",
    logger,
    config: {
      allowCreate: false,
      defaultCategory: "Uncategorized",
      maxTags: 5,
      cacheTtlSeconds: 300,
      ...overrides
    }
  };
}

describe("WordPress taxonomy providers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe("tags", () => {
    it("POSTs to <endpoint>/tags and uses the new id", async () => {
      const { calls } = fakeWordPress({ tags: [] });
      const provider = new WordPressTagProvider(options({ allowCreate: true }));

      const [tag] = await provider.resolveMany(["Brand New"]);

      expect(tag).toEqual({ id: 1000, name: "Brand New" });
      expect(calls.find((c) => c.method === "POST")?.url).toBe(`${ENDPOINT}/tags`);
    });

    it("does not re-create or lose terms on a second resolve in the same run", async () => {
      const { calls, store } = fakeWordPress({ tags: [{ id: 1, name: "existing" }] });
      const provider = new WordPressTagProvider(options({ allowCreate: true }));

      const first = await provider.resolveMany(["existing", "fresh"]);
      const second = await provider.resolveMany(["existing", "fresh"]);

      expect(second).toEqual(first);
      expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
      expect(store.tags).toHaveLength(2);
    });

    it("skips unknown tags without creating them when creation is disabled", async () => {
      const { calls } = fakeWordPress({ tags: [{ id: 1, name: "known" }] });
      const provider = new WordPressTagProvider(options({ allowCreate: false }));

      const tags = await provider.resolveMany(["known", "unknown"]);

      expect(tags).toEqual([{ id: 1, name: "known" }]);
      expect(calls.some((c) => c.method === "POST")).toBe(false);
    });

    it("matches case-insensitively, trimmed and HTML-entity-decoded", async () => {
      fakeWordPress({ tags: [{ id: 3, name: "R&amp;D" }] });
      const provider = new WordPressTagProvider(options());

      expect(await provider.resolveMany(["  r&d "])).toEqual([{ id: 3, name: "R&D" }]);
    });

    it("dedupes and caps the number of tags", async () => {
      fakeWordPress({
        tags: ["a", "b", "c", "d"].map((name, index) => ({ id: index + 1, name }))
      });
      const provider = new WordPressTagProvider(options({ maxTags: 2 }));

      const tags = await provider.resolveMany(["A", "a", "b", "c", "d"]);

      expect(tags.map((t) => t.id)).toEqual([1, 2]);
    });

    it("refetches after the cache TTL expires", async () => {
      const { mock } = fakeWordPress({ tags: [{ id: 1, name: "a" }] });
      const provider = new WordPressTagProvider(options({ cacheTtlSeconds: 60 }));

      await provider.list();
      await provider.list();
      expect(mock).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(61_000);
      await provider.list();
      expect(mock).toHaveBeenCalledTimes(2);
    });
  });

  describe("pagination", () => {
    it("matches terms across 250 terms on 3 pages", async () => {
      const tags = Array.from({ length: 250 }, (_, i) => ({ id: i + 1, name: `tag-${i + 1}` }));
      const { mock } = fakeWordPress({ tags });
      const provider = new WordPressTagProvider(options({ maxTags: 10 }));

      const resolved = await provider.resolveMany(["tag-1", "tag-150", "tag-250"]);

      expect(resolved.map((t) => t.id)).toEqual([1, 150, 250]);
      expect(mock).toHaveBeenCalledTimes(3);
      expect(await provider.list()).toHaveLength(250);
    });
  });

  describe("categories", () => {
    const categories = [
      { id: 1, name: "Uncategorized" },
      { id: 2, name: "News &amp; Views" }
    ];

    it("returns a matching category", async () => {
      fakeWordPress({ categories });
      const provider = new WordPressCategoryProvider(options());
      expect(await provider.resolve("news & views")).toEqual({ id: 2, name: "News & Views" });
    });

    it("falls back to the default category and never creates, even with allowCreate", async () => {
      const { calls } = fakeWordPress({ categories });
      const provider = new WordPressCategoryProvider(options({ allowCreate: true }));

      expect(await provider.resolve("Nonexistent")).toEqual({ id: 1, name: "Uncategorized" });
      expect(calls.some((c) => c.method === "POST")).toBe(false);
    });

    it("fails when neither the category nor the default exists", async () => {
      const { calls } = fakeWordPress({ categories: [{ id: 2, name: "News" }] });
      const provider = new WordPressCategoryProvider(options({ allowCreate: true }));

      await expect(provider.resolve("Nonexistent")).rejects.toThrow(/default category/);
      expect(calls.some((c) => c.method === "POST")).toBe(false);
    });
  });
});
