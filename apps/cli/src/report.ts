import type {
  ApprovalResult,
  ArticleWorkflowResult,
  RejectResult,
  StoredWorkflowSummary
} from "@openblog/graph";
import type { ILogger } from "@openblog/logger";
import type { TopicCollection } from "@openblog/research";
import type { ResolvedArticleBrief } from "@openblog/types";

/** Documented exit codes (see `--help`). */
export const EXIT = {
  ok: 0,
  failed: 1,
  needsReview: 2,
  duplicate: 3,
  usage: 64
} as const;

/** The stable object `--json` prints. Fields only get added, never renamed. */
export interface CliSummary {
  command: "generate" | "resume" | "revise" | "approve" | "reject";
  status: string;
  exitCode: number;
  dryRun: boolean;
  workflowId: string | null;
  topic: string | null;
  /** The brief the run followed, with its effective word range; null for `approve`. */
  brief: ResolvedArticleBrief | null;
  title: string | null;
  slug: string | null;
  publisherId: string | null;
  outputPath: string | null;
  remoteUrl: string | null;
  failure: { step: string; code: string; message: string } | null;
  violations: Array<{ code: string; severity: string; message: string }>;
  /** Editorial review (scores and rationale); null when the review is off or did not run. */
  review: { overall: number; scores: Record<string, number>; rationale: string } | null;
}

export interface ListSummary {
  command: "list";
  status: "ok";
  exitCode: 0;
  runs: StoredWorkflowSummary[];
}

export interface ErrorSummary {
  command: string;
  status: "error";
  exitCode: number;
  error: { code: string; message: string };
}

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

export function exitCodeForRun(result: ArticleWorkflowResult): number {
  switch (result.status) {
    case "published":
    case "awaiting_approval":
      return EXIT.ok;
    case "needs_review":
      return EXIT.needsReview;
    case "duplicate":
      return EXIT.duplicate;
    default:
      return EXIT.failed;
  }
}

export function summarizeRun(
  command: "generate" | "resume" | "revise",
  result: ArticleWorkflowResult,
  dryRun: boolean
): CliSummary {
  const full = result.status === "duplicate" ? undefined : result;
  return {
    command,
    status: result.status,
    exitCode: exitCodeForRun(result),
    dryRun,
    workflowId: result.workflowId ?? null,
    topic: result.topic,
    brief: result.brief,
    title: full?.seoOutput?.title ?? null,
    slug: full?.seoOutput?.slug ?? null,
    publisherId: full?.publishResult?.publisherId ?? null,
    outputPath: full?.publishResult?.outputPath ?? null,
    remoteUrl: text(full?.publishResult?.metadata?.link),
    failure: result.failure ?? null,
    violations: result.status === "needs_review" ? result.violations : [],
    review: full?.review ?? null
  };
}

export function summarizeApproval(result: ApprovalResult, dryRun: boolean): CliSummary {
  return {
    command: "approve",
    status: result.status,
    exitCode: result.status === "published" ? EXIT.ok : EXIT.failed,
    dryRun,
    workflowId: result.workflowId,
    topic: null,
    brief: null,
    title: result.title,
    slug: result.slug,
    publisherId: result.publishResult.publisherId,
    outputPath: result.publishResult.outputPath ?? null,
    remoteUrl: text(result.publishResult.metadata?.link),
    failure: result.failure ?? null,
    violations: [],
    review: null
  };
}

export function summarizeRejection(result: RejectResult, dryRun: boolean): CliSummary {
  return {
    command: "reject",
    status: result.status,
    exitCode: EXIT.ok,
    dryRun,
    workflowId: result.workflowId,
    topic: null,
    brief: null,
    title: null,
    slug: null,
    publisherId: null,
    outputPath: null,
    remoteUrl: null,
    failure: null,
    violations: [],
    review: null
  };
}

/** The brief on one line: its set fields and the word range the run was held to. */
function formatBrief(brief: ResolvedArticleBrief): string {
  const { minWords, maxWords, ...rest } = brief;
  return [
    ...Object.entries(rest)
      .filter(([key]) => key !== "topic")
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`),
    `words=${minWords}-${maxWords}`
  ].join(" ");
}

/** Short human-readable result for stdout when `--json` is not used. */
export function formatSummary(summary: CliSummary): string {
  const lines = [
    `${summary.dryRun ? "[dry run] " : ""}${summary.command}: ${summary.status}`,
    summary.workflowId && `workflow: ${summary.workflowId}`,
    summary.brief && `brief: ${formatBrief(summary.brief)}`,
    summary.title && `title: ${summary.title}`,
    summary.slug && `slug: ${summary.slug}`,
    summary.outputPath && `file: ${summary.outputPath}`,
    summary.remoteUrl && `url: ${summary.remoteUrl}`,
    summary.failure &&
      `failure: ${summary.failure.step}/${summary.failure.code}: ${summary.failure.message}`,
    summary.review && `review: ${summary.review.overall}/10 - ${summary.review.rationale}`,
    ...summary.violations.map((violation) => `violation: ${violation.code}: ${violation.message}`)
  ];
  return lines.filter(Boolean).join("\n");
}

export interface ResearchSummary {
  command: "research collect";
  status: "ok" | "failed";
  exitCode: number;
  sources: TopicCollection["sources"];
  candidates: TopicCollection["candidates"];
}

/** `ok` when at least one source answered; one failing source never fails the collection. */
export function summarizeCollection(collection: TopicCollection): ResearchSummary {
  const failed =
    collection.sources.length > 0 && collection.sources.every((s) => s.status === "failed");
  return {
    command: "research collect",
    status: failed ? "failed" : "ok",
    exitCode: failed ? EXIT.failed : EXIT.ok,
    sources: collection.sources,
    candidates: collection.candidates
  };
}

export function formatCollection(collection: TopicCollection): string {
  const sources = collection.sources.map((source) => {
    const outcome =
      source.status === "ok"
        ? `${source.count} entries`
        : `FAILED ${source.error?.code}: ${source.error?.message}`;
    const warnings = source.warnings.map((warning) => `\n    warning: ${warning}`).join("");
    return `  ${source.name} (${source.type}): ${outcome}${warnings}`;
  });
  const candidates = collection.candidates.map(
    (candidate) =>
      `- ${candidate.title}\n  ${candidate.url}  [${candidate.source}${candidate.publishedAt ? `, ${candidate.publishedAt.slice(0, 10)}` : ""}]`
  );
  return [
    "Sources:",
    ...sources,
    "",
    `Candidates (${collection.candidates.length}):`,
    ...(candidates.length > 0 ? candidates : ["  none"])
  ].join("\n");
}

export function formatRunList(runs: StoredWorkflowSummary[]): string {
  if (runs.length === 0) {
    return "No runs stored yet.";
  }
  return runs
    .map(
      (run) =>
        [
          run.workflowId,
          run.status.padEnd(17),
          run.createdAt,
          `${run.totalTokens} tok`.padStart(12),
          `$${run.costUsd.toFixed(4)}`.padStart(9),
          (run.review ? `review ${run.review.overall}` : "").padEnd(11),
          run.topic
        ].join("  ") +
        (run.failedStep ? `  [${run.failedStep}${run.errorCode ? `/${run.errorCode}` : ""}]` : "")
    )
    .join("\n");
}

/** Logs the outcome of `approve` and returns the exit code: 0 only when the article went live. */
export function reportApprovalOutcome(
  result: ApprovalResult,
  logger: Pick<ILogger, "info" | "error">
): number {
  if (result.status !== "published") {
    logger.error("Approval failed: the article was not published", {
      workflowId: result.workflowId,
      slug: result.slug,
      errorCode: result.failure?.code,
      error: result.failure?.message
    });
    return 1;
  }

  logger.info("Article approved and published", {
    workflowId: result.workflowId,
    title: result.title,
    slug: result.slug,
    outputPath: result.publishResult.outputPath,
    remoteId: result.publishResult.metadata?.id,
    remoteUrl: result.publishResult.metadata?.link,
    remoteStatus: result.publishResult.metadata?.status
  });
  return 0;
}

/**
 * Logs the outcome of a run and returns the process exit code: 0 when the article was published or
 * is waiting for approval as the publication policy intends, 1 otherwise.
 */
export function reportRunOutcome(
  result: ArticleWorkflowResult,
  logger: Pick<ILogger, "info" | "error">
): number {
  if (result.status === "awaiting_approval") {
    logger.info("Article stored and waiting for approval; nothing is live yet", {
      topic: result.topic,
      slug: result.seoOutput.slug,
      workflowId: result.workflowId,
      draftOutputPath: result.publishResult?.outputPath,
      draftRemoteUrl: result.publishResult?.metadata?.link,
      approveWith: result.workflowId ? `openblog approve ${result.workflowId}` : undefined
    });
    return EXIT.ok;
  }

  if (result.status !== "published") {
    logger.error("Article generation failed", {
      topic: result.topic,
      status: result.status,
      failedStep: result.failure?.step,
      errorCode: result.failure?.code,
      error: result.failure?.message ?? `Run ended with status ${result.status}`,
      violations: result.status === "needs_review" ? result.violations : undefined
    });
    return exitCodeForRun(result);
  }

  logger.info("Workflow completed successfully", {
    topic: result.topic,
    title: result.seoOutput?.title,
    slug: result.seoOutput?.slug,
    publisherId: result.publishResult?.publisherId,
    outputPath: result.publishResult?.outputPath,
    remoteId: result.publishResult?.metadata?.id,
    remoteUrl: result.publishResult?.metadata?.link,
    remoteStatus: result.publishResult?.metadata?.status
  });

  logger.info("Article saved", {
    outputFilePath: result.publishResult?.outputPath,
    topic: result.topic,
    slug: result.seoOutput?.slug,
    publisherId: result.publishResult?.publisherId
  });

  return 0;
}
