import { randomUUID } from "node:crypto";
import os from "node:os";

import type { EnvSchema } from "@openblog/config";
import type { ArticleGenerationWorkflow, ArticleWorkflowResult, MemoryPort } from "@openblog/graph";
import type { ILogger } from "@openblog/logger";
import type { Notifier } from "@openblog/notify";
import type { CandidateRecord, SchedulerStore } from "@openblog/storage";
import { articleBriefSchema, formatBriefIssues } from "@openblog/types";

import type { CollectOutcome, ResearchService } from "./research";

const LOCK_NAME = "schedule-run-once";
const DAY_MS = 86_400_000;

export type LimitReason = "outside_window" | "max_runs_per_day" | "max_cost_per_day";

interface Common {
  /** Runs found abandoned by a dead process and marked `interrupted`. */
  recovered: string[];
  /** Present when `collect` was asked for. */
  collected?: CollectOutcome["counts"];
}

export type RunOnceOutcome =
  | (Common & { status: "ran"; candidate: CandidateRecord; result: ArticleWorkflowResult })
  | (Common & { status: "nothing_to_do" })
  | (Common & { status: "limit_reached"; reason: LimitReason; detail: string })
  | { status: "locked"; owner: string; expiresAt: string; recovered: string[] };

export interface RunOnceOptions {
  /** Read the research sources first, so new candidates can be picked. */
  collect?: boolean;
}

/** The next unit of work of an automatic pipeline, safe to call from cron. */
export interface SchedulerService {
  runOnce(options?: RunOnceOptions): Promise<RunOnceOutcome>;
}

export interface SchedulerServiceOptions {
  config: EnvSchema;
  store: SchedulerStore;
  research: ResearchService;
  workflow: ArticleGenerationWorkflow;
  memory?: MemoryPort;
  logger: ILogger;
  /** Told when a daily limit stops a run; the notifier decides whether it sends that event. */
  notifier?: Notifier;
  /** The clock for the lock, the limits and the window (tests). */
  clock?: () => Date;
  /** Who holds the lock; defaults to `host:pid:random`, new for every call. */
  owner?: string;
}

/** Whether `now` (local time) is inside `HH:MM-HH:MM`; a window that ends before it starts crosses midnight. */
export function inWindow(window: string, now: Date): boolean {
  const [start, end] = window.split("-").map((part) => {
    const [hours, minutes] = part.split(":").map(Number);
    return hours! * 60 + minutes!;
  }) as [number, number];
  const minute = now.getHours() * 60 + now.getMinutes();
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

export function createSchedulerService(options: SchedulerServiceOptions): SchedulerService {
  const { config, store, research, workflow, memory, logger } = options;
  const clock = options.clock ?? (() => new Date());

  /** The first limit that forbids starting a run now, if any. */
  function limitHit(now: Date): { reason: LimitReason; detail: string } | undefined {
    const window = config.OPENBLOG_SCHEDULE_ALLOWED_WINDOW;
    if (window && !inWindow(window, now)) {
      return {
        reason: "outside_window",
        detail: `It is outside OPENBLOG_SCHEDULE_ALLOWED_WINDOW ${window}`
      };
    }
    const maxRuns = config.OPENBLOG_SCHEDULE_MAX_RUNS_PER_DAY;
    const maxCost = config.OPENBLOG_SCHEDULE_MAX_COST_PER_DAY;
    if (maxRuns === undefined && maxCost === undefined) {
      return undefined;
    }
    const used = store.usageSince(new Date(now.getTime() - DAY_MS));
    if (maxRuns !== undefined && used.runs >= maxRuns) {
      return {
        reason: "max_runs_per_day",
        detail: `${used.runs} runs in the last 24 hours; the limit is ${maxRuns}`
      };
    }
    if (maxCost !== undefined && used.costUsd >= maxCost) {
      return {
        reason: "max_cost_per_day",
        detail: `$${used.costUsd.toFixed(4)} spent in the last 24 hours; the limit is $${maxCost}`
      };
    }
    return undefined;
  }

  return {
    async runOnce({ collect = false } = {}) {
      // Unique per call, so two calls in one process exclude each other like two processes do.
      const owner = options.owner ?? `${os.hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
      const ttlMs = config.OPENBLOG_SCHEDULE_LOCK_TTL_MINUTES * 60_000;
      const lock = store.acquireLock(LOCK_NAME, owner, ttlMs, clock());
      if (!lock.acquired) {
        logger.warn("Scheduler is locked by another process", {
          owner: lock.owner,
          expiresAt: lock.expiresAt
        });
        return { status: "locked", owner: lock.owner, expiresAt: lock.expiresAt, recovered: [] };
      }

      try {
        const recovered =
          (await memory?.recoverStaleRuns?.(config.OPENBLOG_RUN_STALE_AFTER_MINUTES, clock())) ??
          [];
        if (recovered.length > 0) {
          logger.info("Recovered stale runs", { count: recovered.length, workflowIds: recovered });
        }
        const collected = collect ? (await research.collect()).counts : undefined;
        const common: Common = { recovered, ...(collected ? { collected } : {}) };

        const limit = limitHit(clock());
        if (limit) {
          logger.info("Scheduler limit reached", limit);
          // Being outside the window is the normal state of a night schedule, not news.
          if (limit.reason !== "outside_window") {
            await options.notifier
              ?.notify({
                event: "schedule_limit_reached",
                status: "limit_reached",
                errorCode: limit.reason,
                errorMessage: limit.detail
              })
              .catch(() => undefined);
          }
          return { ...common, status: "limit_reached", ...limit };
        }

        const [candidate] = research.list({ status: "accepted", limit: 1 });
        if (!candidate) {
          logger.info("Nothing accepted to generate");
          return { ...common, status: "nothing_to_do" };
        }

        const brief = articleBriefSchema.safeParse({
          ...candidate.brief,
          topic: candidate.title,
          // The page the candidate was found on grounds the article unless the brief names others.
          sources: (candidate.brief?.sources as string[] | undefined) ?? [candidate.url]
        });
        if (!brief.success) {
          throw new Error(
            `The stored brief of candidate ${candidate.id} is invalid: ${formatBriefIssues(brief.error)}`
          );
        }

        // Registered and marked first: a crash during the run leaves a resumable run, never a
        // candidate that would be picked again.
        const pending = await workflow.begin(brief.data);
        if (pending.workflowId) {
          research.markUsed(candidate.id, pending.workflowId);
        }
        logger.info("Scheduler started a run", {
          candidateId: candidate.id,
          score: candidate.score,
          workflowId: pending.workflowId
        });
        const result = await pending.execute();
        return { ...common, status: "ran", candidate, result };
      } finally {
        store.releaseLock(LOCK_NAME, owner);
      }
    }
  };
}
