import os from "node:os";

import { loadEnv } from "@openblog/config";
import {
  BacklogError,
  createApplication,
  ResearchError,
  type Application,
  type ApplicationOverrides,
  type ResearchService
} from "@openblog/app";
import { logger } from "@openblog/logger";
import { articleBriefSchema, formatBriefIssues } from "@openblog/types";

import { HELP, parseCommand, UsageError, type ParsedCommand } from "./args";
import { createDryRunPublisher, prepareDryRunWorkspace, type DryRunWorkspace } from "./dry-run";
import {
  EXIT,
  formatCandidate,
  formatCandidates,
  formatResearch,
  formatRunList,
  formatSummary,
  reportApprovalOutcome,
  reportRunOutcome,
  summarizeApproval,
  summarizeResearch,
  summarizeRejection,
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

function requireResearch(app: Application): ResearchService {
  if (!app.research) {
    throw new ResearchError(
      "backlog_unavailable",
      "The topic backlog needs the SQLite memory store"
    );
  }
  return app.research;
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

    if (flags.dryRun && command.name !== "list" && command.name !== "topics") {
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
          const recovered = flags.recoverStale ? await app.recoverStaleRuns() : [];
          if (flags.recoverStale) {
            logger.info("Recovered stale runs", {
              count: recovered.length,
              workflowIds: recovered
            });
          }
          const runs = await app.listRuns();
          emit({ command: "list", status: "ok", exitCode: EXIT.ok, runs }, formatRunList(runs));
          return EXIT.ok;
        }
        case "research": {
          const research = requireResearch(app);
          const summary = summarizeResearch(await research.collect());
          emit(summary, formatResearch(summary));
          return summary.exitCode;
        }
        case "topics": {
          const research = requireResearch(app);
          switch (command.action) {
            case "list": {
              const candidates = research.list({ status: command.status });
              emit(
                { command: "topics list", status: "ok", exitCode: EXIT.ok, candidates },
                formatCandidates(candidates)
              );
              return EXIT.ok;
            }
            case "accept": {
              const candidate = research.accept(command.id, {
                by: currentUser(),
                brief: command.brief
              });
              emit(
                { command: "topics accept", status: "ok", exitCode: EXIT.ok, candidate },
                formatCandidate(candidate)
              );
              return EXIT.ok;
            }
            case "drop": {
              const candidate = research.drop(command.id, {
                by: currentUser(),
                reason: command.reason
              });
              emit(
                { command: "topics drop", status: "ok", exitCode: EXIT.ok, candidate },
                formatCandidate(candidate)
              );
              return EXIT.ok;
            }
            case "generate": {
              const candidate = research.get(command.id);
              if (candidate.status === "used" || candidate.status === "dropped") {
                throw new BacklogError(
                  "invalid_state",
                  candidate.status === "used"
                    ? `Candidate ${candidate.id} already started run ${candidate.workflowId}`
                    : "A dropped candidate must be accepted first"
                );
              }
              const brief = articleBriefSchema.safeParse({
                ...candidate.brief,
                ...command.brief,
                topic: candidate.title
              });
              // The page the candidate was found on grounds the article unless the brief names others.
              const grounded = brief.success
                ? { ...brief.data, sources: brief.data.sources ?? [candidate.url] }
                : undefined;
              if (!brief.success) {
                throw new BacklogError(
                  "invalid_input",
                  `Invalid brief: ${formatBriefIssues(brief.error)}`
                );
              }
              const result = await app.workflow.run({ ...grounded!, force: flags.force });
              if (result.workflowId) {
                research.markUsed(candidate.id, result.workflowId);
              }
              const code = reportRunOutcome(result, logger);
              const summary: CliSummary = {
                ...summarizeRun("generate", result, flags.dryRun),
                candidateId: candidate.id
              };
              emit(summary, formatSummary(summary));
              return code;
            }
          }
          return EXIT.failed;
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
        case "reject": {
          const result = await app.workflow.reject(command.workflowId, {
            rejectedBy: currentUser(),
            reason: command.reason
          });
          logger.info("Article rejected", { workflowId: result.workflowId });
          const summary = summarizeRejection(result, flags.dryRun);
          emit(summary, formatSummary(summary));
          return EXIT.ok;
        }
        case "resume":
        case "revise":
        case "generate": {
          let result;
          if (command.name === "resume") {
            result = await app.workflow.resume(command.workflowId, { force: flags.force });
          } else if (command.name === "revise") {
            const revision = await app.workflow.revise(command.workflowId, {
              revisedBy: currentUser(),
              feedback: command.feedback
            });
            result = await revision.execute();
          } else {
            result = await app.workflow.run({ ...command.brief, force: flags.force });
          }
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
