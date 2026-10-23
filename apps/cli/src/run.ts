import os from "node:os";

import { loadEnv } from "@openblog/config";
import { createApplication, type ApplicationOverrides } from "@openblog/app";
import { logger } from "@openblog/logger";

import { HELP, parseCommand, UsageError, type ParsedCommand } from "./args";
import { createDryRunPublisher, prepareDryRunWorkspace, type DryRunWorkspace } from "./dry-run";
import {
  EXIT,
  formatRunList,
  formatSummary,
  reportApprovalOutcome,
  reportRunOutcome,
  summarizeApproval,
  summarizeRun,
  type CliSummary
} from "./report";

export interface RunCliOptions {
  argv?: string[];
  env?: NodeJS.ProcessEnv;
  overrides?: ApplicationOverrides;
  /** Where results go; defaults to the process streams. */
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
}

/** Who is running the command, recorded as the approver. */
function currentUser(): string {
  try {
    return os.userInfo().username;
  } catch {
    return process.env.USER ?? "unknown";
  }
}

/** Parses arguments, builds the application and runs one command. Returns the exit code. */
export async function runCli(options: RunCliOptions = {}): Promise<number> {
  const stdout = options.stdout ?? ((text: string) => void process.stdout.write(`${text}\n`));
  const stderr = options.stderr ?? ((text: string) => void process.stderr.write(`${text}\n`));

  let command: ParsedCommand;
  try {
    command = parseCommand(options.argv ?? process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    stderr(`${error.message}\n\n${HELP}`);
    return EXIT.usage;
  }

  if (command.name === "help") {
    stdout(HELP);
    return EXIT.ok;
  }

  const { options: flags } = command;
  const emit = (summary: object, human: string): void =>
    stdout(flags.json ? JSON.stringify(summary) : human);
  let workspace: DryRunWorkspace | undefined;

  try {
    const source = { ...(options.env ?? process.env) };
    let config = loadEnv(source);
    let overrides = options.overrides;

    // --publisher wins over OPENBLOG_DEFAULT_PUBLISHER; a dry run needs a name for its stand-in.
    const publisherId = flags.publisher ?? config.OPENBLOG_DEFAULT_PUBLISHER;
    if (flags.publisher) {
      config = loadEnv({ ...source, OPENBLOG_DEFAULT_PUBLISHER: flags.publisher });
    }

    if (flags.dryRun && command.name !== "list") {
      const dryId = publisherId ?? "markdown";
      workspace = prepareDryRunWorkspace(config);
      config = loadEnv({
        ...source,
        OPENBLOG_DEFAULT_PUBLISHER: dryId,
        OPENBLOG_MEMORY_DB_PATH: workspace.dbPath
      });
      overrides = { ...overrides, publishers: [createDryRunPublisher(dryId)] };
    }

    const app = await createApplication(config, overrides);
    try {
      switch (command.name) {
        case "list": {
          const runs = await app.listRuns();
          emit({ command: "list", status: "ok", exitCode: EXIT.ok, runs }, formatRunList(runs));
          return EXIT.ok;
        }
        case "approve": {
          const result = await app.workflow.approve(command.workflowId, {
            approvedBy: currentUser(),
            overrideReason: flags.override
          });
          const code = reportApprovalOutcome(result, logger);
          const summary = summarizeApproval(result, flags.dryRun);
          emit(summary, formatSummary(summary));
          return code;
        }
        case "resume":
        case "generate": {
          const result =
            command.name === "resume"
              ? await app.workflow.resume(command.workflowId, { force: flags.force })
              : await app.workflow.run({ ...command.brief, force: flags.force });
          const code = reportRunOutcome(result, logger);
          const summary: CliSummary = summarizeRun(command.name, result, flags.dryRun);
          emit(summary, formatSummary(summary));
          return code;
        }
      }
      return EXIT.failed;
    } finally {
      await app.dispose();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof Error && "code" in error ? String(error.code) : "error";
    logger.error("Command failed", { command: command.name, errorCode: code, error: message });
    emit(
      { command: command.name, status: "error", exitCode: EXIT.failed, error: { code, message } },
      `error: ${message}`
    );
    return EXIT.failed;
  } finally {
    workspace?.cleanup();
  }
}
