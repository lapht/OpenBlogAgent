import { createHash } from "node:crypto";

export const PROMPT_AGENTS = [
  "planner",
  "writer",
  "editor",
  "seo",
  "classification",
  "review"
] as const;
export type PromptAgent = (typeof PROMPT_AGENTS)[number];

/** Operator-written instructions per agent; an agent without an entry keeps its built-in text. */
export type PromptOverrides = Partial<Record<PromptAgent, string>>;

const BRIEF_PLACEHOLDERS = [
  "brief.language",
  "brief.audience",
  "brief.tone",
  "brief.targetKeyword",
  "brief.secondaryKeywords",
  "brief.notes",
  "brief.minWords",
  "brief.maxWords"
] as const;

/** The placeholders each agent's override may use; anything else is rejected at startup. */
export const PROMPT_PLACEHOLDERS: Readonly<Record<PromptAgent, readonly string[]>> = {
  planner: ["topic", ...BRIEF_PLACEHOLDERS],
  writer: ["topic", "outline", ...BRIEF_PLACEHOLDERS],
  editor: [...BRIEF_PLACEHOLDERS],
  seo: ["outline", ...BRIEF_PLACEHOLDERS],
  classification: ["maxTags"],
  review: ["title", "metaDescription", "outline"]
};

/** Placeholders an override must contain: without them the agent would not know its subject. */
const REQUIRED_PLACEHOLDERS: Partial<Record<PromptAgent, readonly string[]>> = {
  planner: ["topic"],
  writer: ["topic"]
};

const PLACEHOLDER = /\{\{\s*([^{}]*?)\s*\}\}/g;

/** An override that cannot be used; `createApplication` fails with it before any run starts. */
export class PromptOverrideError extends Error {
  constructor(
    readonly agent: PromptAgent,
    message: string
  ) {
    super(message);
    this.name = "PromptOverrideError";
  }
}

/** Checks an override's text: not empty, only placeholders allowed for `agent`, all required ones present. */
export function validatePromptTemplate(agent: PromptAgent, template: string): void {
  if (template.trim().length === 0) {
    throw new PromptOverrideError(agent, `The ${agent} prompt override is empty`);
  }

  const allowed = PROMPT_PLACEHOLDERS[agent];
  const used = new Set<string>();
  for (const match of template.matchAll(PLACEHOLDER)) {
    const name = match[1]!;
    if (!allowed.includes(name)) {
      throw new PromptOverrideError(
        agent,
        `The ${agent} prompt override uses the unknown placeholder {{${name}}}; allowed: ${allowed.map((entry) => `{{${entry}}}`).join(", ")}`
      );
    }
    used.add(name);
  }

  if (template.replace(PLACEHOLDER, "").includes("{{")) {
    throw new PromptOverrideError(
      agent,
      `The ${agent} prompt override has a "{{" that does not start a placeholder like {{topic}}`
    );
  }

  for (const required of REQUIRED_PLACEHOLDERS[agent] ?? []) {
    if (!used.has(required)) {
      throw new PromptOverrideError(
        agent,
        `The ${agent} prompt override must contain {{${required}}}`
      );
    }
  }
}

/** Fills the placeholders of a validated template; a value that is absent renders as nothing. */
export function renderPromptTemplate(
  template: string,
  values: Readonly<Record<string, string | undefined>>
): string {
  return template.replace(PLACEHOLDER, (_match, name: string) => values[name] ?? "");
}

/** SHA-256 (hex) of a prompt as sent to the provider, to tell which text a step used. */
export function hashPrompt(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex");
}
