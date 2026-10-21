import { loadEnv } from "@openblog/config";
import { createApplication, type ApplicationOverrides } from "@openblog/app";
import { logger } from "@openblog/logger";

import { reportRunOutcome } from "./report";

export function resolveTopic(
  argv: string[] = process.argv.slice(2),
  npmArgv: string | undefined = process.env.npm_config_argv
): string {
  const directTopic = argv.join(" ").trim();
  if (directTopic.length > 0) {
    return directTopic;
  }

  if (npmArgv) {
    try {
      const parsed = JSON.parse(npmArgv) as { original?: string[] };
      const originalArgs = parsed.original ?? [];
      const startIndex = originalArgs.findIndex((arg) => arg === "start");
      const topicFromNpm = originalArgs
        .slice(startIndex >= 0 ? startIndex + 1 : 0)
        .filter((arg) => arg !== "--")
        .join(" ")
        .trim();

      if (topicFromNpm.length > 0) {
        return topicFromNpm;
      }
    } catch (error) {
      logger.debug("Unable to parse npm argv", {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  throw new Error('Missing article topic. Example: npm start "AI agents in software development"');
}

export interface RunCliOptions {
  argv?: string[];
  env?: NodeJS.ProcessEnv;
  overrides?: ApplicationOverrides;
}

/** Parses arguments, builds the application and runs the workflow. Returns the exit code. */
export async function runCli(options: RunCliOptions = {}): Promise<number> {
  let topic = "";

  try {
    topic = resolveTopic(options.argv);
    const app = await createApplication(loadEnv(options.env), options.overrides);

    try {
      const result = await app.workflow.run({
        article: "",
        category: "",
        outline: [],
        tags: [],
        topic
      });

      return reportRunOutcome(result, logger);
    } finally {
      await app.dispose();
    }
  } catch (error) {
    logger.error("Article generation failed", {
      topic,
      error: error instanceof Error ? error.message : String(error)
    });
    return 1;
  }
}
