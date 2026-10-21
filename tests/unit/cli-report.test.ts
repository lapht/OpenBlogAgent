import { describe, expect, it } from "vitest";

import { reportRunOutcome } from "../../apps/cli/src/report";
import type { ArticleWorkflowResult } from "../../packages/graph/src/workflows/article-generation-workflow";

function capture() {
  const logs: Array<{ level: string; message: string; meta?: Record<string, unknown> }> = [];
  return {
    logs,
    logger: {
      info: (message: string, meta?: Record<string, unknown>) =>
        logs.push({ level: "info", message, meta }),
      error: (message: string, meta?: Record<string, unknown>) =>
        logs.push({ level: "error", message, meta })
    }
  };
}

const base = {
  article: "a",
  category: "General",
  editedText: "a",
  seoOutput: { title: "T", slug: "t" },
  tags: [],
  topic: "topic"
} as unknown as ArticleWorkflowResult;

describe("CLI run outcome", () => {
  it("exits non-zero, shows the reason and never logs 'Article saved' when publishing failed", () => {
    const { logs, logger } = capture();

    const code = reportRunOutcome(
      {
        ...base,
        status: "failed",
        failure: { step: "publisher", code: "validation_failed", message: "bad slug" },
        publishResult: { success: false, publisherId: "markdown", publisherName: "Markdown" }
      },
      logger
    );

    expect(code).toBe(1);
    expect(logs.map((entry) => entry.message)).not.toContain("Article saved");
    expect(logs[0]).toMatchObject({
      level: "error",
      meta: { failedStep: "publisher", errorCode: "validation_failed", error: "bad slug" }
    });
  });

  it("exits zero and logs 'Article saved' once published", () => {
    const { logs, logger } = capture();

    const code = reportRunOutcome(
      {
        ...base,
        status: "published",
        publishResult: {
          success: true,
          publisherId: "markdown",
          publisherName: "Markdown",
          outputPath: "output/articles/t.md"
        }
      },
      logger
    );

    expect(code).toBe(0);
    expect(logs.map((entry) => entry.message)).toContain("Article saved");
  });
});
