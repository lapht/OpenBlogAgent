import fs from "node:fs";
import { parseArgs } from "node:util";

import {
  articleBriefSchema,
  candidateBriefSchema,
  formatBriefIssues,
  type ArticleBrief,
  type CandidateBrief
} from "@openblog/types";
import { parse as parseYaml } from "yaml";

export const COMMANDS = [
  "generate",
  "resume",
  "approve",
  "reject",
  "revise",
  "list",
  "research",
  "topics",
  "schedule"
] as const;
export type CommandName = (typeof COMMANDS)[number];

export interface CliOptions {
  dryRun: boolean;
  force: boolean;
  json: boolean;
  publisher?: string;
  /** Reason for approving an article that failed the quality gate. */
  override?: string;
  /** Why an article is rejected (reject only). */
  reason?: string;
  /** What the writer should change (revise only). */
  feedback?: string;
  /** Mark runs abandoned by a dead process as interrupted before listing (list only). */
  recoverStale: boolean;
  /** Read the research sources before picking a candidate (schedule run-once only). */
  collect: boolean;
  /** Make the candidate's proposed keyword and angle part of its brief (topics accept only). */
  useEnrichment: boolean;
  /** How many candidates to enrich (topics enrich only). */
  top?: number;
}

export const CANDIDATE_STATUS_FLAGS = ["new", "accepted", "dropped", "used"] as const;
export type CandidateStatusFlag = (typeof CANDIDATE_STATUS_FLAGS)[number];

export type ParsedCommand =
  | { name: "help"; options: CliOptions }
  | { name: "generate"; topic: string; brief: ArticleBrief; options: CliOptions }
  | { name: "resume"; workflowId: string; options: CliOptions }
  | { name: "approve"; workflowId: string; options: CliOptions }
  | { name: "reject"; workflowId: string; reason: string; options: CliOptions }
  | { name: "revise"; workflowId: string; feedback: string; options: CliOptions }
  | { name: "list"; options: CliOptions }
  | { name: "research"; action: "collect"; options: CliOptions }
  | { name: "schedule"; action: "run-once"; options: CliOptions }
  | { name: "topics"; action: "list"; status?: CandidateStatusFlag; options: CliOptions }
  | { name: "topics"; action: "accept"; id: string; brief?: CandidateBrief; options: CliOptions }
  | { name: "topics"; action: "drop"; id: string; reason?: string; options: CliOptions }
  | { name: "topics"; action: "enrich"; id?: string; options: CliOptions }
  | {
      name: "topics";
      action: "generate";
      id: string;
      /** Brief fields from `--brief` and the flags; they win over the ones stored on accept. */
      brief: CandidateBrief;
      options: CliOptions;
    };

/** Bad command line: the CLI prints the message with the usage and exits 64. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export const HELP = `Usage: openblog <command> [options]

Commands:
  generate [topic]     Generate an article about <topic> and publish it as the policy allows
  resume <id>          Continue a failed or interrupted run from its last good step
  approve <id>         Publish a stored article live (--override "reason" if it failed the gate)
  reject <id>          Close a stored article as rejected (--reason "why"); terminal
  revise <id>          Send a stored article back to the writer (--feedback "what to change")
  list                 Show the most recent runs (--recover-stale marks abandoned runs interrupted)
  research collect     Read the feeds and sitemaps of OPENBLOG_RESEARCH_SOURCES_FILE, score the candidates and store them
  topics list          Show the topic backlog, best score first (--status new|accepted|dropped|used)
  topics enrich [<id>] Ask the model for an angle, title and keyword (<id>, or the best --top N new candidates)
  topics accept <id>   Approve a candidate for generation (brief options store a brief with it)
  topics drop <id>     Drop a candidate (--reason "why")
  topics generate <id> Generate an article from a candidate (brief options override the stored brief)
  schedule run-once    Do the next unit of work for cron: pick the best accepted candidate and run it (--collect first)

Options:
  --dry-run            Run everything except the publish call; nothing is stored or published
  --publisher <id>     Publisher to use instead of OPENBLOG_DEFAULT_PUBLISHER (markdown, wordpress)
  --force              Generate even if the topic, slug or title was already published
  --override <reason>  Approve an article that did not pass the quality gate (approve only)
  --reason <text>      Why the article is rejected (reject only, required)
  --feedback <text>    What the writer should change (revise only, required)
  --status <status>    Only candidates in this status (topics list only)
  --top <n>            How many candidates to enrich (topics enrich only)
  --use-enrichment     Put the proposed keyword and angle in the brief (topics accept only)
  --collect            Read the research sources first (schedule run-once only)
  --recover-stale      Mark runs idle for OPENBLOG_RUN_STALE_AFTER_MINUTES as interrupted (list only)
  --json               Print one JSON summary object on stdout; logs always go to stderr

Brief options (generate, topics accept and topics generate; each overrides the same field of --brief):
  --brief <file>       YAML or JSON file with the brief: topic, language, audience, tone,
                       targetKeyword, secondaryKeywords, minWords, maxWords, notes
  --language <code>    Language of the article, e.g. en or it
  --audience <text>    Who the article is for
  --tone <text>        Tone of voice
  --keyword <text>     Target keyword
  --min-words <n>      Minimum article length in words
  --max-words <n>      Maximum article length in words
  --notes <text>       Editorial notes for the writers
  --source <url>       Ground the article in this page and list it as a reference (repeatable, up to 5)
  -h, --help           Show this help

Exit codes:
  0   ok (published, or stored and waiting for approval)
  1   failed
  2   needs review (quality gate rejected the article)
  3   duplicate (topic, slug or title already published)
  10  schedule run-once: nothing accepted to generate
  11  schedule run-once: a daily limit or the time window stopped it
  12  schedule run-once: another run-once holds the lock
  64  usage error
`;

/** Parses the arguments after the executable name. Throws `UsageError` when they are invalid. */
export function parseCommand(argv: string[]): ParsedCommand {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        "dry-run": { type: "boolean" },
        force: { type: "boolean" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
        publisher: { type: "string" },
        override: { type: "string" },
        reason: { type: "string" },
        feedback: { type: "string" },
        status: { type: "string" },
        collect: { type: "boolean" },
        top: { type: "string" },
        "use-enrichment": { type: "boolean" },
        "recover-stale": { type: "boolean" },
        brief: { type: "string" },
        language: { type: "string" },
        audience: { type: "string" },
        tone: { type: "string" },
        keyword: { type: "string" },
        "min-words": { type: "string" },
        "max-words": { type: "string" },
        notes: { type: "string" },
        source: { type: "string", multiple: true }
      }
    });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }

  const { values, positionals } = parsed;
  const options: CliOptions = {
    dryRun: values["dry-run"] ?? false,
    force: values.force ?? false,
    json: values.json ?? false,
    publisher: values.publisher,
    override: values.override,
    reason: values.reason,
    feedback: values.feedback,
    recoverStale: values["recover-stale"] ?? false,
    collect: values.collect ?? false,
    useEnrichment: values["use-enrichment"] ?? false
  };

  if (values.help) {
    return { name: "help", options };
  }

  const [name, ...rest] = positionals;
  if (!name) {
    throw new UsageError("Missing command");
  }
  if (!COMMANDS.includes(name as CommandName)) {
    throw new UsageError(`Unknown command "${name}"`);
  }
  if (options.publisher !== undefined && !options.publisher.trim()) {
    throw new UsageError("--publisher needs a publisher id");
  }
  if (options.override !== undefined && (name !== "approve" || !options.override.trim())) {
    throw new UsageError("--override takes a reason and only applies to approve");
  }
  if (
    options.reason !== undefined &&
    name !== "reject" &&
    !(name === "topics" && rest[0] === "drop")
  ) {
    throw new UsageError("--reason only applies to reject and topics drop");
  }
  if (options.feedback !== undefined && name !== "revise") {
    throw new UsageError("--feedback only applies to revise");
  }
  if (options.recoverStale && name !== "list") {
    throw new UsageError("--recover-stale only applies to list");
  }
  if (options.force && name !== "generate" && name !== "resume") {
    throw new UsageError("--force only applies to generate and resume");
  }

  const briefFlags = BRIEF_FLAGS.filter((flag) => values[flag] !== undefined);
  const takesBrief =
    name === "generate" || (name === "topics" && (rest[0] === "accept" || rest[0] === "generate"));
  if (!takesBrief && briefFlags.length > 0) {
    throw new UsageError(`--${briefFlags[0]} only applies to generate and topics accept|generate`);
  }
  if (options.useEnrichment && !(name === "topics" && rest[0] === "accept")) {
    throw new UsageError("--use-enrichment only applies to topics accept");
  }
  if (values.top !== undefined && !(name === "topics" && rest[0] === "enrich")) {
    throw new UsageError("--top only applies to topics enrich");
  }
  if (options.collect && name !== "schedule") {
    throw new UsageError("--collect only applies to schedule run-once");
  }
  if (values.status !== undefined && !(name === "topics" && rest[0] === "list")) {
    throw new UsageError("--status only applies to topics list");
  }

  switch (name as CommandName) {
    case "generate": {
      const brief = buildBrief(rest.join(" ").trim(), values);
      return { name: "generate", topic: brief.topic, brief, options };
    }
    case "resume":
    case "approve": {
      if (rest.length !== 1) {
        throw new UsageError(`${name} takes exactly one workflow id`);
      }
      return { name: name as "resume" | "approve", workflowId: rest[0]!, options };
    }
    case "reject":
    case "revise": {
      if (rest.length !== 1) {
        throw new UsageError(`${name} takes exactly one workflow id`);
      }
      if (name === "reject") {
        if (!options.reason?.trim()) {
          throw new UsageError('reject needs --reason "why the article is rejected"');
        }
        return { name: "reject", workflowId: rest[0]!, reason: options.reason.trim(), options };
      }
      if (!options.feedback?.trim()) {
        throw new UsageError('revise needs --feedback "what the writer should change"');
      }
      return { name: "revise", workflowId: rest[0]!, feedback: options.feedback.trim(), options };
    }
    case "research": {
      if (rest.length !== 1 || rest[0] !== "collect") {
        throw new UsageError("research takes one subcommand: collect");
      }
      return { name: "research", action: "collect", options };
    }
    case "schedule": {
      if (rest.length !== 1 || rest[0] !== "run-once") {
        throw new UsageError("schedule takes one subcommand: run-once");
      }
      return { name: "schedule", action: "run-once", options };
    }
    case "topics": {
      const [action, ...args] = rest;
      switch (action) {
        case "list": {
          if (args.length > 0) throw new UsageError("topics list takes no arguments");
          if (
            values.status !== undefined &&
            !CANDIDATE_STATUS_FLAGS.includes(values.status as CandidateStatusFlag)
          ) {
            throw new UsageError(`--status must be one of ${CANDIDATE_STATUS_FLAGS.join(", ")}`);
          }
          return {
            name: "topics",
            action: "list",
            status: values.status as CandidateStatusFlag | undefined,
            options
          };
        }
        case "enrich": {
          if (args.length > 1) throw new UsageError("topics enrich takes at most one candidate id");
          if (args.length === 1 && values.top !== undefined) {
            throw new UsageError("give a candidate id or --top, not both");
          }
          if (args.length === 0 && values.top === undefined) {
            throw new UsageError("topics enrich needs a candidate id or --top <n>");
          }
          if (values.top !== undefined) {
            if (!/^\d+$/.test(values.top) || Number(values.top) < 1) {
              throw new UsageError(`--top needs a positive whole number, got "${values.top}"`);
            }
            options.top = Number(values.top);
          }
          return { name: "topics", action: "enrich", id: args[0], options };
        }
        case "accept":
        case "drop":
        case "generate": {
          if (args.length !== 1) {
            throw new UsageError(`topics ${action} takes exactly one candidate id`);
          }
          const id = args[0]!;
          if (action === "drop") {
            return {
              name: "topics",
              action,
              id,
              reason: options.reason?.trim() || undefined,
              options
            };
          }
          const brief = buildCandidateBrief(values);
          return action === "accept"
            ? {
                name: "topics",
                action,
                id,
                brief: Object.keys(brief).length > 0 ? brief : undefined,
                options
              }
            : { name: "topics", action, id, brief, options };
        }
        default:
          throw new UsageError("topics takes one subcommand: list, accept, drop or generate");
      }
    }
    case "list": {
      if (rest.length > 0) {
        throw new UsageError("list takes no arguments");
      }
      return { name: "list", options };
    }
  }
}

const BRIEF_FLAGS = [
  "brief",
  "language",
  "audience",
  "tone",
  "keyword",
  "min-words",
  "max-words",
  "notes",
  "source"
] as const;

type BriefFlagValues = Partial<Record<Exclude<(typeof BRIEF_FLAGS)[number], "source">, string>> & {
  source?: string[];
};

function readBriefFile(file: string): Record<string, unknown> {
  let content: string;
  try {
    content = fs.readFileSync(file, "utf8");
  } catch (error) {
    throw new UsageError(
      `Cannot read the brief file ${file}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  let data: unknown;
  try {
    // YAML is a superset of JSON, so one parser reads both.
    data = parseYaml(content);
  } catch (error) {
    throw new UsageError(
      `The brief file ${file} is not valid YAML or JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new UsageError(`The brief file ${file} must contain an object with the brief fields`);
  }
  return data as Record<string, unknown>;
}

function wordCount(flag: string, value: string): number {
  if (!/^\d+$/.test(value.trim())) {
    throw new UsageError(`--${flag} needs a whole number of words, got "${value}"`);
  }
  return Number(value);
}

/** The brief fields from `--brief` and the flags, topic not included. */
function briefFieldsFromValues(values: BriefFlagValues): Record<string, unknown> {
  const fromFlags = {
    language: values.language,
    audience: values.audience,
    tone: values.tone,
    targetKeyword: values.keyword,
    minWords:
      values["min-words"] === undefined ? undefined : wordCount("min-words", values["min-words"]),
    maxWords:
      values["max-words"] === undefined ? undefined : wordCount("max-words", values["max-words"]),
    notes: values.notes,
    sources: values.source
  };
  const override = Object.fromEntries(
    Object.entries(fromFlags).filter(([, value]) => value !== undefined)
  );
  return { ...(values.brief ? readBriefFile(values.brief) : {}), ...override };
}

/** The brief of `generate`: the file first, then the flags and the topic on top of it. */
function buildBrief(topicArgument: string, values: BriefFlagValues): ArticleBrief {
  const candidate = {
    ...briefFieldsFromValues(values),
    ...(topicArgument ? { topic: topicArgument } : {})
  };

  if (candidate.topic === undefined) {
    throw new UsageError('Missing article topic. Example: openblog generate "Why caching matters"');
  }
  const parsed = articleBriefSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new UsageError(`Invalid brief: ${formatBriefIssues(parsed.error)}`);
  }
  return parsed.data;
}

/** Brief fields for a topic candidate: the topic is the candidate's own title, so a file's is ignored. */
function buildCandidateBrief(values: BriefFlagValues): CandidateBrief {
  const fields = briefFieldsFromValues(values);
  delete fields.topic;
  const parsed = candidateBriefSchema.safeParse(fields);
  if (!parsed.success) {
    throw new UsageError(`Invalid brief: ${formatBriefIssues(parsed.error)}`);
  }
  return parsed.data;
}
