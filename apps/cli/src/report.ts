import type { ApprovalResult, ArticleWorkflowResult } from "@openblog/graph";
import type { ILogger } from "@openblog/logger";

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
      approveWith: result.workflowId ? `npm start -- approve ${result.workflowId}` : undefined
    });
    return 0;
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
    return 1;
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
