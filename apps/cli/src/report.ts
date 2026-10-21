import type { ArticleWorkflowResult } from "@openblog/graph";
import type { ILogger } from "@openblog/logger";

/** Logs the outcome of a run and returns the process exit code: 0 only when the article was published. */
export function reportRunOutcome(
  result: ArticleWorkflowResult,
  logger: Pick<ILogger, "info" | "error">
): number {
  if (result.status !== "published") {
    logger.error("Article generation failed", {
      topic: result.topic,
      status: result.status,
      failedStep: result.failure?.step,
      errorCode: result.failure?.code,
      error: result.failure?.message ?? `Run ended with status ${result.status}`
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
