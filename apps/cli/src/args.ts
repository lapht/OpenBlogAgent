import { parseArgs } from "node:util";

export const COMMANDS = ["generate", "resume", "approve", "list"] as const;
export type CommandName = (typeof COMMANDS)[number];

export interface CliOptions {
  dryRun: boolean;
  force: boolean;
  json: boolean;
  publisher?: string;
  /** Reason for approving an article that failed the quality gate. */
  override?: string;
}

export type ParsedCommand =
  | { name: "help"; options: CliOptions }
  | { name: "generate"; topic: string; options: CliOptions }
  | { name: "resume"; workflowId: string; options: CliOptions }
  | { name: "approve"; workflowId: string; options: CliOptions }
  | { name: "list"; options: CliOptions };

/** Bad command line: the CLI prints the message with the usage and exits 64. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export const HELP = `Usage: openblog <command> [options]

Commands:
  generate <topic>     Generate an article about <topic> and publish it as the policy allows
  resume <id>          Continue a failed run from its last good step
  approve <id>         Publish a stored article live (--override "reason" if it failed the gate)
  list                 Show the most recent runs

Options:
  --dry-run            Run everything except the publish call; nothing is stored or published
  --publisher <id>     Publisher to use instead of OPENBLOG_DEFAULT_PUBLISHER (markdown, wordpress)
  --force              Generate even if the topic, slug or title was already published
  --override <reason>  Approve an article that did not pass the quality gate (approve only)
  --json               Print one JSON summary object on stdout; logs always go to stderr
  -h, --help           Show this help

Exit codes:
  0   ok (published, or stored and waiting for approval)
  1   failed
  2   needs review (quality gate rejected the article)
  3   duplicate (topic, slug or title already published)
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
        override: { type: "string" }
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
    override: values.override
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
  if (options.force && name !== "generate" && name !== "resume") {
    throw new UsageError("--force only applies to generate and resume");
  }

  switch (name as CommandName) {
    case "generate": {
      const topic = rest.join(" ").trim();
      if (!topic) {
        throw new UsageError(
          'Missing article topic. Example: openblog generate "Why caching matters"'
        );
      }
      return { name: "generate", topic, options };
    }
    case "resume":
    case "approve": {
      if (rest.length !== 1) {
        throw new UsageError(`${name} takes exactly one workflow id`);
      }
      return { name: name as "resume" | "approve", workflowId: rest[0]!, options };
    }
    case "list": {
      if (rest.length > 0) {
        throw new UsageError("list takes no arguments");
      }
      return { name: "list", options };
    }
  }
}
