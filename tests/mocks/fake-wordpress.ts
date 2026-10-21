import { vi } from "vitest";

export const WORDPRESS_ENDPOINT = "https://blog.test/wp-json/wp/v2";

export interface FakePost {
  id: number;
  slug: string;
  status: string;
  link: string;
  title: string;
}

export interface FakeWordPressOptions {
  /** Status codes returned by the first POST/PUT calls, then the server recovers. */
  failWrites?: number[];
}

/**
 * Stubs global `fetch` with a minimal WordPress REST server (posts, plus a fixed News category and ai tag) and returns its state.
 * Any URL outside the WordPress endpoint throws, so a test can never reach the network.
 */
export function stubWordPress(options: FakeWordPressOptions = {}) {
  const posts: FakePost[] = [];
  const requests: Array<{ method: string; url: string; body?: Record<string, unknown> }> = [];
  const failures = [...(options.failWrites ?? [])];
  let nextId = 100;

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  const handler = async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (!url.startsWith(WORDPRESS_ENDPOINT)) {
      throw new Error(`Unexpected network call to ${url}`);
    }
    const body = init?.body
      ? (JSON.parse(String(init.body)) as Record<string, unknown>)
      : undefined;
    requests.push({ method, url, body });
    const parsed = new URL(url);

    if (method === "GET" && parsed.pathname.endsWith("/categories")) {
      return json([{ id: 1, name: "News", slug: "news" }]);
    }
    if (method === "GET" && parsed.pathname.endsWith("/tags")) {
      return json([{ id: 2, name: "ai", slug: "ai" }]);
    }
    if (method === "GET") {
      const slug = parsed.searchParams.get("slug");
      return json(posts.filter((post) => post.slug === slug));
    }

    const failure = failures.shift();
    if (failure) return json({ code: "boom" }, failure);

    if (method === "POST") {
      const post: FakePost = {
        id: nextId++,
        slug: String(body?.slug),
        status: String(body?.status),
        title: String(body?.title),
        link: `https://blog.test/${String(body?.slug)}`
      };
      posts.push(post);
      return json(post, 201);
    }

    const id = Number(parsed.pathname.split("/").pop());
    const post = posts.find((entry) => entry.id === id);
    if (!post) return json({ code: "not_found" }, 404);
    if (typeof body?.status === "string") post.status = body.status;
    return json(post);
  };

  vi.stubGlobal("fetch", vi.fn(handler));
  return { posts, requests, writes: () => requests.filter((request) => request.method !== "GET") };
}
