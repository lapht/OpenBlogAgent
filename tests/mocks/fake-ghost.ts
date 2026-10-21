import { createHmac } from "node:crypto";

import { vi } from "vitest";

export const GHOST_SITE = "https://blog.test";
export const GHOST_KEY_ID = "5f1c0b7e9d2a4c0001a2b3c4";
export const GHOST_SECRET = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
export const GHOST_ADMIN_KEY = `${GHOST_KEY_ID}:${GHOST_SECRET}`;

export interface FakeGhostPost {
  id: string;
  slug: string;
  status: string;
  url: string;
  title: string;
  updated_at: string;
  html: string;
  tags: Array<{ name: string }>;
}

export interface FakeGhostOptions {
  /** Status codes returned by the first POST/PUT calls, then the server recovers. */
  failWrites?: number[];
}

/** What a request's token proved, or why it was refused. */
export function verifyGhostToken(authorization: string | undefined) {
  const token = authorization?.match(/^Ghost (.+)$/)?.[1];
  const [header, payload, signature] = token?.split(".") ?? [];
  if (!header || !payload || !signature) return { valid: false as const };
  const expected = createHmac("sha256", Buffer.from(GHOST_SECRET, "hex"))
    .update(`${header}.${payload}`)
    .digest("base64url");
  return {
    valid: expected === signature,
    header: JSON.parse(Buffer.from(header, "base64url").toString()) as Record<string, unknown>,
    payload: JSON.parse(Buffer.from(payload, "base64url").toString()) as Record<string, unknown>
  };
}

/**
 * Stubs global `fetch` with a minimal Ghost Admin API (posts by slug, create, update) that checks the
 * JWT on every request. Any URL outside the site throws, so a test can never reach the network.
 */
export function stubGhost(options: FakeGhostOptions = {}) {
  const posts: FakeGhostPost[] = [];
  const requests: Array<{
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: { posts: Array<Record<string, unknown>> };
  }> = [];
  const failures = [...(options.failWrites ?? [])];
  let nextId = 1;

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const asPost = (post: FakeGhostPost) => ({
    id: post.id,
    slug: post.slug,
    status: post.status,
    url: post.url,
    updated_at: post.updated_at
  });

  const handler = async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (!url.startsWith(`${GHOST_SITE}/ghost/api/admin/`)) {
      throw new Error(`Unexpected network call to ${url}`);
    }
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ method, url, headers, body });

    if (!verifyGhostToken(headers.Authorization).valid) {
      return json({ errors: [{ message: "Invalid token" }] }, 401);
    }
    const parsed = new URL(url);
    const slugMatch = parsed.pathname.match(/\/posts\/slug\/([^/]+)\/$/);

    if (method === "GET" && slugMatch) {
      const post = posts.find((candidate) => candidate.slug === decodeURIComponent(slugMatch[1]!));
      return post
        ? json({ posts: [asPost(post)] })
        : json({ errors: [{ message: "Post not found." }] }, 404);
    }

    const failure = failures.shift();
    if (failure) return json({ errors: [{ message: "boom" }] }, failure);

    const sent = body?.posts?.[0] as Record<string, unknown> | undefined;
    if (method === "POST" && parsed.pathname.endsWith("/posts/")) {
      const post: FakeGhostPost = {
        id: `post${nextId++}`,
        slug: String(sent?.slug),
        status: String(sent?.status),
        url: `${GHOST_SITE}/${String(sent?.slug)}/`,
        title: String(sent?.title),
        updated_at: new Date(2026, 0, nextId).toISOString(),
        html: String(sent?.html),
        tags: (sent?.tags ?? []) as Array<{ name: string }>
      };
      posts.push(post);
      return json({ posts: [asPost(post)] }, 201);
    }

    const idMatch = parsed.pathname.match(/\/posts\/([^/]+)\/$/);
    if (method === "PUT" && idMatch) {
      const post = posts.find((candidate) => candidate.id === idMatch[1]);
      if (!post) return json({ errors: [{ message: "Post not found." }] }, 404);
      if (sent?.updated_at !== post.updated_at) {
        return json(
          { errors: [{ message: "Saving failed! Someone else is editing this post." }] },
          409
        );
      }
      post.title = String(sent?.title ?? post.title);
      post.html = String(sent?.html ?? post.html);
      post.status = String(sent?.status ?? post.status);
      post.tags = (sent?.tags ?? post.tags) as Array<{ name: string }>;
      post.updated_at = new Date(2026, 5, nextId++).toISOString();
      return json({ posts: [asPost(post)] });
    }

    return json({ errors: [{ message: "Not found" }] }, 404);
  };

  const fetchMock = vi.fn(handler);
  vi.stubGlobal("fetch", fetchMock);
  return { posts, requests, fetchMock };
}
