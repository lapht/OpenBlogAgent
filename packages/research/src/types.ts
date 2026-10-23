/** Stable codes of `FetchError`; callers branch on these, not on messages. */
export type FetchErrorCode =
  | "fetch_blocked"
  | "fetch_timeout"
  | "fetch_too_large"
  | "fetch_http_error"
  | "fetch_unsupported_type"
  | "fetch_network";

export class FetchError extends Error {
  public readonly code: FetchErrorCode;
  /** The requested URL without credentials and query string, safe to log. */
  public readonly url: string;
  public readonly status?: number;

  constructor(init: { code: FetchErrorCode; message: string; url: string; status?: number }) {
    super(init.message);
    this.name = "FetchError";
    this.code = init.code;
    this.url = init.url;
    this.status = init.status;
  }
}

export interface FetchRequest {
  url: string;
  signal?: AbortSignal;
}

export interface FetchedContent {
  /** The URL that was asked for. */
  url: string;
  /** The URL that answered, after redirects. */
  finalUrl: string;
  status: number;
  /** Media type without parameters, lowercase (`text/html`). */
  contentType: string;
  /** Size of the body in bytes. */
  size: number;
  /** The body decoded as text (charset of the response, UTF-8 when absent or unknown). */
  body: string;
}

/** Every research feature reads external content through this port and no other way. */
export interface ContentFetcher {
  fetch(request: FetchRequest): Promise<FetchedContent>;
}
