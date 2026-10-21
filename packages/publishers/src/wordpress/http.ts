export type WordPressErrorCode =
  | "auth_failed"
  | "forbidden"
  | "invalid_request"
  | "server_error"
  | "network_error"
  | "timeout"
  | "unexpected_response";

export class WordPressRequestError extends Error {
  constructor(
    readonly code: WordPressErrorCode,
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "WordPressRequestError";
  }
}

export const DEFAULT_WORDPRESS_TIMEOUT_MS = 15_000;

const REST_BASE_SUFFIX = "/wp-json/wp/v2";

/** Trims slashes and a trailing `/posts` so `<endpoint>/<resource>` is always well formed. */
export function normalizeWordPressEndpoint(endpoint: string): string {
  return endpoint
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/posts$/i, "")
    .replace(/\/+$/, "");
}

export function isWordPressRestBase(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.pathname.replace(/\/+$/, "").endsWith(REST_BASE_SUFFIX)
    );
  } catch {
    return false;
  }
}

export function basicAuthHeader(username: string, applicationPassword: string): string {
  return `Basic ${Buffer.from(`${username}:${applicationPassword}`).toString("base64")}`;
}

export function classifyWordPressStatus(status: number): WordPressErrorCode {
  if (status === 401) return "auth_failed";
  if (status === 403) return "forbidden";
  if (status >= 500) return "server_error";
  if (status >= 400) return "invalid_request";
  return "unexpected_response";
}

/** `fetch` with a timeout; network failures and non-2xx statuses become `WordPressRequestError`. */
export async function wordpressFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number = DEFAULT_WORDPRESS_TIMEOUT_MS
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new WordPressRequestError(
        "timeout",
        `WordPress request timed out after ${timeoutMs}ms`
      );
    }
    const reason = error instanceof Error ? error.message : "unknown error";
    throw new WordPressRequestError("network_error", `WordPress request failed: ${reason}`);
  }

  if (!response.ok) {
    throw new WordPressRequestError(
      classifyWordPressStatus(response.status),
      `WordPress request failed with status ${response.status}`,
      response.status
    );
  }
  return response;
}
