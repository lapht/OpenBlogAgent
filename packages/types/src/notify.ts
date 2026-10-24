/** What can trigger a notification (`OPENBLOG_NOTIFY_EVENTS`). */
export const NOTIFY_EVENTS = [
  "awaiting_approval",
  "needs_review",
  "failed",
  "budget_exceeded",
  "published",
  "duplicate",
  "schedule_limit_reached"
] as const;

export type NotifyEvent = (typeof NOTIFY_EVENTS)[number];

/** The events sent when `OPENBLOG_NOTIFY_EVENTS` is not set: the ones that wait for a person. */
export const DEFAULT_NOTIFY_EVENTS: readonly NotifyEvent[] = [
  "awaiting_approval",
  "needs_review",
  "failed",
  "budget_exceeded"
];
