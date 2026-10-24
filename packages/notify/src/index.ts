import { logger as defaultLogger, type ILogger } from "@openblog/logger";
import { DEFAULT_NOTIFY_EVENTS, type NotifyEvent } from "@openblog/types";

/** What happened to a run (or to the scheduler), as handed to a notifier. */
export interface RunNotification {
  event: NotifyEvent;
  /** Absent for events that belong to no run (`schedule_limit_reached`). */
  workflowId?: string;
  topic?: string;
  title?: string;
  /** Run status at that moment (`awaiting_approval`, `failed`...). */
  status: string;
  errorCode?: string;
  errorMessage?: string;
}

/** Tells a person that a run needs them. Never throws into the run: failures are logged inside. */
export interface Notifier {
  notify(notification: RunNotification): Promise<void>;
}

export type WebhookFormat = "generic" | "slack" | "discord";

export interface WebhookNotifierOptions {
  /** The webhook address. It is a secret (Slack and Discord put the token in the path): never logged. */
  url: string;
  /** Only these events are sent. Defaults to the ones that wait for a person. */
  events?: readonly NotifyEvent[];
  format?: WebhookFormat;
  /** Public address of the server, to link `GET /runs/{id}` from the message (`https://host:3000`). */
  baseUrl?: string;
  /** Per attempt. Defaults to 10 seconds. */
  timeoutMs?: number;
  /** Attempts in total, retried on network errors, timeouts, 429 and 5xx. Defaults to 3. */
  maxAttempts?: number;
  baseDelayMs?: number;
  logger?: ILogger;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  clock?: () => Date;
}

const HEADLINES: Record<NotifyEvent, string> = {
  awaiting_approval: "An article is waiting for approval",
  needs_review: "An article failed the quality gate and needs review",
  failed: "A run failed",
  budget_exceeded: "A run stopped: its budget was exceeded",
  published: "An article was published",
  duplicate: "A run was stopped as a duplicate",
  schedule_limit_reached: "The scheduler did not start a run: a limit was reached"
};

const MAX_ERROR_LENGTH = 300;
const DISCORD_LIMIT = 1900;

const truncate = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** The address of a run in the API (`GET /runs/{id}`), when the server's public address is known. */
export function runUrl(baseUrl: string | undefined, workflowId: string | undefined): string | null {
  if (!baseUrl || !workflowId) {
    return null;
  }
  return `${baseUrl.replace(/\/+$/, "")}/runs/${encodeURIComponent(workflowId)}`;
}

function describe(notification: RunNotification, url: string | null): string {
  const subject = notification.title ?? notification.topic;
  return [
    `${HEADLINES[notification.event]}${subject ? `: ${subject}` : ""}`,
    ...(notification.errorMessage
      ? [
          `Reason: ${notification.errorCode ? `${notification.errorCode}: ` : ""}${truncate(notification.errorMessage, MAX_ERROR_LENGTH)}`
        ]
      : []),
    ...(notification.workflowId ? [`Run: ${notification.workflowId}`] : []),
    ...(url ? [url] : [])
  ].join("\n");
}

/** The JSON body for a format. The generic one has a stable shape; fields are only added. */
export function buildPayload(
  notification: RunNotification,
  format: WebhookFormat,
  options: { baseUrl?: string; occurredAt: Date }
): Record<string, unknown> {
  const url = runUrl(options.baseUrl, notification.workflowId);
  if (format === "slack") {
    return { text: describe(notification, url) };
  }
  if (format === "discord") {
    return { content: truncate(describe(notification, url), DISCORD_LIMIT) };
  }
  return {
    source: "openblog",
    event: notification.event,
    workflowId: notification.workflowId ?? null,
    topic: notification.topic ?? null,
    title: notification.title ?? null,
    status: notification.status,
    errorCode: notification.errorCode ?? null,
    errorMessage: notification.errorMessage
      ? truncate(notification.errorMessage, MAX_ERROR_LENGTH)
      : null,
    url,
    occurredAt: options.occurredAt.toISOString()
  };
}

const retryable = (status: number): boolean => status === 429 || status >= 500;

/**
 * Posts a JSON message to a webhook (generic, Slack or Discord body). Retries a bounded number of
 * times; when delivery still fails it logs the host and the reason and returns, so a broken webhook
 * never changes the run. The URL itself is never logged or put in an error.
 */
export function createWebhookNotifier(options: WebhookNotifierOptions): Notifier {
  const events = new Set(options.events ?? DEFAULT_NOTIFY_EVENTS);
  const format = options.format ?? "generic";
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const baseDelayMs = options.baseDelayMs ?? 500;
  const logger = options.logger ?? defaultLogger;
  const send = options.fetch ?? fetch;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const clock = options.clock ?? (() => new Date());
  const host = (() => {
    try {
      return new URL(options.url).host;
    } catch {
      return "invalid-url";
    }
  })();

  /** A failure reason without the address: runtime errors can quote the URL they were called with. */
  const reasonOf = (error: unknown): string => {
    const raw = error instanceof Error ? error.message : String(error);
    return raw.split(options.url).join("[webhook]");
  };

  async function attempt(
    body: string
  ): Promise<{ ok: true } | { ok: false; retry: boolean; reason: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await send(options.url, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "OpenBlogAgent" },
        body,
        signal: controller.signal
      });
      // The body is not read: it may echo the request, and nothing in it is needed.
      void response.body?.cancel().catch(() => undefined);
      if (response.ok) {
        return { ok: true };
      }
      return { ok: false, retry: retryable(response.status), reason: `HTTP ${response.status}` };
    } catch (error) {
      const timedOut = controller.signal.aborted;
      return {
        ok: false,
        retry: true,
        reason: timedOut ? `timed out after ${timeoutMs}ms` : reasonOf(error)
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async notify(notification) {
      if (!events.has(notification.event)) {
        return;
      }
      const body = JSON.stringify(
        buildPayload(notification, format, { baseUrl: options.baseUrl, occurredAt: clock() })
      );

      for (let number = 1; number <= maxAttempts; number++) {
        const result = await attempt(body);
        if (result.ok) {
          logger.info("Notification sent", {
            event: notification.event,
            workflowId: notification.workflowId,
            host
          });
          return;
        }
        if (!result.retry || number === maxAttempts) {
          logger.warn("Notification failed", {
            event: notification.event,
            workflowId: notification.workflowId,
            host,
            attempts: number,
            reason: result.reason
          });
          return;
        }
        await sleep(baseDelayMs * 2 ** (number - 1));
      }
    }
  };
}
