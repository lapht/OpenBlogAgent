import { createHmac } from "node:crypto";

export type GhostErrorCode =
  | "auth_failed"
  | "forbidden"
  | "invalid_request"
  | "server_error"
  | "network_error"
  | "timeout"
  | "unexpected_response";

export class GhostRequestError extends Error {
  constructor(
    readonly code: GhostErrorCode,
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "GhostRequestError";
  }
}

export const DEFAULT_GHOST_TIMEOUT_MS = 15_000;

/** Admin API tokens may live at most five minutes. */
const TOKEN_LIFETIME_SECONDS = 300;

/** Version of the Admin API the payloads are written for. */
export const GHOST_ACCEPT_VERSION = "v5.0";

const base64url = (value: Buffer | string): string => Buffer.from(value).toString("base64url");

/** An Admin API key is `<id>:<secret>`, the secret being hex. */
export function parseGhostAdminKey(apiKey: string): { id: string; secret: Buffer } | undefined {
  const [id, secret, ...rest] = apiKey.trim().split(":");
  if (
    !id ||
    !secret ||
    rest.length > 0 ||
    secret.length % 2 !== 0 ||
    !/^[0-9a-f]+$/i.test(secret)
  ) {
    return undefined;
  }
  return { id, secret: Buffer.from(secret, "hex") };
}

/** Signs the short-lived HS256 JWT the Admin API expects in `Authorization: Ghost <token>`. */
export function createGhostToken(apiKey: string, now: Date = new Date()): string {
  const key = parseGhostAdminKey(apiKey);
  if (!key) {
    throw new GhostRequestError(
      "auth_failed",
      "The Ghost Admin API key must look like <id>:<secret>"
    );
  }
  const issuedAt = Math.floor(now.getTime() / 1000);
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT", kid: key.id }));
  const payload = base64url(
    JSON.stringify({ iat: issuedAt, exp: issuedAt + TOKEN_LIFETIME_SECONDS, aud: "/admin/" })
  );
  const signature = createHmac("sha256", key.secret).update(`${header}.${payload}`).digest();
  return `${header}.${payload}.${base64url(signature)}`;
}

/** `<site>/ghost/api/admin` for a site URL, tolerating a trailing slash or an already complete URL. */
export function ghostAdminBase(endpoint: string): string {
  const site = endpoint
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/ghost(\/api(\/admin)?)?$/i, "");
  return `${site}/ghost/api/admin`;
}

export function isGhostEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function classifyGhostStatus(status: number): GhostErrorCode {
  if (status === 401) return "auth_failed";
  if (status === 403) return "forbidden";
  if (status >= 500) return "server_error";
  if (status >= 400) return "invalid_request";
  return "unexpected_response";
}

/** Ghost explains failures as `{ errors: [{ message }] }`; its text never contains the key. */
async function errorDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { errors?: Array<{ message?: unknown }> };
    const message = body.errors?.[0]?.message;
    return typeof message === "string" ? `: ${message}` : "";
  } catch {
    return "";
  }
}

/**
 * `fetch` with a timeout. Network failures and non-2xx statuses become `GhostRequestError`, except
 * the statuses in `allow`, which are returned for the caller to interpret (a 404 lookup).
 */
export async function ghostFetch(
  url: string,
  init: RequestInit,
  options: { timeoutMs?: number; allow?: number[] } = {}
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_GHOST_TIMEOUT_MS;
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new GhostRequestError("timeout", `Ghost request timed out after ${timeoutMs}ms`);
    }
    const reason = error instanceof Error ? error.message : "unknown error";
    throw new GhostRequestError("network_error", `Ghost request failed: ${reason}`);
  }

  if (!response.ok && !options.allow?.includes(response.status)) {
    throw new GhostRequestError(
      classifyGhostStatus(response.status),
      `Ghost request failed with status ${response.status}${await errorDetail(response)}`,
      response.status
    );
  }
  return response;
}
