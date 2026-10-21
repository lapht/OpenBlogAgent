import { logger } from "@openblog/logger";

import { ProviderError } from "./types";

export interface RequestPolicy {
  /** Per-attempt timeout in milliseconds. */
  timeoutMs?: number;
  /** Retries after the first attempt, only for retryable errors. */
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export const DEFAULT_TIMEOUT_MS = 120_000;
export const DEFAULT_MAX_RETRIES = 2;
export const DEFAULT_BASE_DELAY_MS = 500;
export const DEFAULT_MAX_DELAY_MS = 30_000;

const MAX_DETAILS_LENGTH = 500;

export interface RequestJsonOptions extends RequestPolicy {
  provider: string;
  url: string;
  init: RequestInit;
  signal?: AbortSignal;
  /** Strings (API keys) that must never appear in error details. */
  secrets?: Array<string | undefined>;
}

export async function requestJson(options: RequestJsonOptions): Promise<unknown> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;

  for (let attempt = 0; ; attempt++) {
    try {
      return await attemptRequest(options);
    } catch (error) {
      if (!(error instanceof ProviderError) || !error.retryable || attempt >= maxRetries) {
        throw error;
      }

      const delayMs =
        error.retryAfterMs !== undefined
          ? Math.min(error.retryAfterMs, maxDelayMs)
          : backoffDelay(attempt, baseDelayMs, maxDelayMs);

      logger.warn("LLM provider request failed, retrying", {
        provider: options.provider,
        kind: error.kind,
        status: error.status,
        attempt: attempt + 1,
        maxRetries,
        delayMs
      });

      await sleep(delayMs, options.signal, options.provider);
    }
  }
}

async function attemptRequest(options: RequestJsonOptions): Promise<unknown> {
  const { provider, signal } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (signal?.aborted) {
    throw abortedError(provider);
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = (): void => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const response = await fetch(options.url, { ...options.init, signal: controller.signal });
    const body = await response.text();

    if (!response.ok) {
      throw classifyHttpError(options, response, body);
    }

    try {
      return JSON.parse(body) as unknown;
    } catch {
      throw new ProviderError({
        kind: "invalid_response",
        message: `${provider} returned malformed JSON`,
        provider,
        retryable: false,
        details: sanitize(body, options.secrets)
      });
    }
  } catch (error) {
    if (error instanceof ProviderError) {
      throw error;
    }
    if (timedOut) {
      throw new ProviderError({
        kind: "timeout",
        message: `${provider} request timed out after ${timeoutMs}ms`,
        provider,
        retryable: true
      });
    }
    if (signal?.aborted) {
      throw abortedError(provider);
    }
    throw new ProviderError({
      kind: "network",
      message: `${provider} request failed: ${error instanceof Error ? error.message : String(error)}`,
      provider,
      retryable: true
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

function classifyHttpError(
  options: RequestJsonOptions,
  response: Response,
  body: string
): ProviderError {
  const { provider } = options;
  const status = response.status;
  const details = sanitize(body, options.secrets);
  const message = `${provider} request failed with status ${status}${details ? `: ${details}` : ""}`;
  const base = { provider, status, details, message };

  if (status === 401 || status === 402 || status === 403) {
    return new ProviderError({ ...base, kind: "auth", retryable: false });
  }
  if (status === 429) {
    return new ProviderError({
      ...base,
      kind: "rate_limited",
      retryable: true,
      retryAfterMs: parseRetryAfter(response.headers.get("retry-after"))
    });
  }
  if (status === 408) {
    return new ProviderError({ ...base, kind: "timeout", retryable: true });
  }
  if (status >= 500) {
    return new ProviderError({ ...base, kind: "server", retryable: true });
  }
  // Remaining 4xx (bad model, bad request, 404): retrying cannot help.
  return new ProviderError({ ...base, kind: "invalid_response", retryable: false });
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function backoffDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  return Math.round(exponential * (0.5 + Math.random() * 0.5));
}

function sanitize(body: string, secrets: Array<string | undefined> = []): string {
  let text = body.trim();
  for (const secret of secrets) {
    if (secret) {
      text = text.split(secret).join("[redacted]");
    }
  }
  return text.length > MAX_DETAILS_LENGTH ? `${text.slice(0, MAX_DETAILS_LENGTH)}…` : text;
}

function abortedError(provider: string): ProviderError {
  return new ProviderError({
    kind: "network",
    message: `${provider} request was aborted by the caller`,
    provider,
    retryable: false
  });
}

function sleep(ms: number, signal: AbortSignal | undefined, provider: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortedError(provider));
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortedError(provider));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
