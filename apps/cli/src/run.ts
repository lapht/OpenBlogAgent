import os from "node:os";

import { loadEnv } from "@openblog/config";
import { createApplication, type ApplicationOverrides } from "@openblog/app";
import { logger } from "@openblog/logger";

import { reportApprovalOutcome, reportRunOutcome } from "./report";

export const FORCE_FLAG = "--force";
export const APPROVE_COMMAND = "approve";
export const OVERRIDE_FLAG = "--override";

export interface ApproveArgs {
  workflowId: string;
  overrideReason?: string;
}

/**
 * Parses `approve <workflowId> [--override "reason"]`; undefined when argv is not an approve
 * command (so the arguments are a topic). Throws when the command is incomplete.
 */
export function parseApproveArgs(argv: string[]): ApproveArgs | undefined {
  if (argv[0] !== APPROVE_COMMAND) {
    return undefined;
  }
  const rest = argv.slice(1);
  const overrideIndex = rest.indexOf(OVERRIDE_FLAG);
  const overrideReason =
    overrideIndex >= 0
      ? rest
          .slice(overrideIndex + 1)
          .join(" ")
          .trim()
      : undefined;
  const workflowId = (overrideIndex >= 0 ? rest.slice(0, overrideIndex) : rest).join(" ").trim();

  if (!workflowId) {
    throw new Error(
      'Missing workflow id. Example: npm start -- approve <workflowId> [--override "reason"]'
    );
  }
  if (overrideIndex >= 0 && !overrideReason) {
    throw new Error(`${OVERRIDE_FLAG} needs a reason`);
  }
  return { workflowId, overrideReason };
}

/** Who is running the command, recorded as the approver. */
function currentUser(): string {
  try {
    return os.userInfo().username;
  } catch {
    return process.env.USER ?? "unknown";
  }
}

/** True when `--force` is among the arguments (generate even if the topic is a duplicate). */
export function hasForceFlag(argv: string[] = process.argv.slice(2)): boolean {
  return argv.includes(FORCE_FLAG);
}

export function resolveTopic(
  argv: string[] = process.argv.slice(2),
  npmArgv: string | undefined = process.env.npm_config_argv
): string {
  const directTopic = argv
    .filter((arg) => arg !== FORCE_FLAG)
    .join(" ")
    .trim();
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
        .filter((arg) => arg !== "--" && arg !== FORCE_FLAG)
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
    const approve = parseApproveArgs(options.argv ?? process.argv.slice(2));
    if (approve) {
      const app = await createApplication(loadEnv(options.env), options.overrides);
      try {
        const result = await app.workflow.approve(approve.workflowId, {
          approvedBy: currentUser(),
          overrideReason: approve.overrideReason
        });
        return reportApprovalOutcome(result, logger);
      } finally {
        await app.dispose();
      }
    }

    topic = resolveTopic(options.argv);
    const app = await createApplication(loadEnv(options.env), options.overrides);

    try {
      const result = await app.workflow.run({ topic, force: hasForceFlag(options.argv) });

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
