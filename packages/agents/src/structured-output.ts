import { z } from "zod";

import type { TextGenerationProvider } from "@openblog/providers";

export const DEFAULT_STRUCTURED_MAX_ATTEMPTS = 3;

const MAX_RAW_RESPONSE_LENGTH = 2000;

export interface StructuredOutputOptions {
  /** Total attempts (first call + re-prompts) before giving up. */
  maxAttempts?: number;
}

export interface GenerateStructuredRequest<T> extends StructuredOutputOptions {
  prompt: string;
  system?: string;
  /** Validates and safely normalizes (trim, slugify, ...) the parsed JSON. */
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  /** Top-level JSON shape to look for in the reply. Defaults to "object". */
  shape?: "object" | "array";
  /** Name used in error messages, e.g. "SEO agent". */
  label: string;
  /** Extra checks the schema cannot express. Throw an Error to reject (the message is fed back). */
  check?: (value: T) => T;
  signal?: AbortSignal;
}

export class StructuredOutputError extends Error {
  public readonly attempts: number;
  public readonly lastError: string;
  /** Last raw model reply, truncated. */
  public readonly lastResponse: string;

  constructor(label: string, attempts: number, lastError: string, lastResponse: string) {
    super(
      `${label} did not return valid structured output after ${attempts} attempt(s): ${lastError}. Received: ${lastResponse}`
    );
    this.name = "StructuredOutputError";
    this.attempts = attempts;
    this.lastError = lastError;
    this.lastResponse = lastResponse;
  }
}

/** The single JSON extraction implementation: whole reply, fenced block, then outermost brackets. */
export function extractJsonCandidates(raw: string, shape: "object" | "array"): string[] {
  const trimmed = raw.trim();
  const [open, close] = shape === "object" ? ["{", "}"] : ["[", "]"];
  const candidates = [trimmed];

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fenced) {
    candidates.push(fenced);
  }

  for (const source of [...candidates]) {
    const start = source.indexOf(open);
    const end = source.lastIndexOf(close);
    if (start >= 0 && end > start) {
      candidates.push(source.slice(start, end + 1));
    }
  }

  return [...new Set(candidates)];
}

export async function generateStructured<T>(
  provider: TextGenerationProvider,
  request: GenerateStructuredRequest<T>
): Promise<T> {
  const maxAttempts = Math.max(1, request.maxAttempts ?? DEFAULT_STRUCTURED_MAX_ATTEMPTS);
  let prompt = request.prompt;
  let lastError = "";
  let lastResponse = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { text } = await provider.generate({
      prompt,
      system: request.system,
      signal: request.signal
    });
    lastResponse = truncate(text);

    const outcome = parseAndValidate(text, request);
    if (outcome.ok) {
      return outcome.value;
    }

    lastError = outcome.error;
    prompt = [
      request.prompt,
      "",
      "Your previous reply was rejected:",
      lastError,
      "",
      "Previous reply (truncated):",
      lastResponse,
      "",
      "Return a corrected reply as valid JSON only, following the same rules as above."
    ].join("\n");
  }

  throw new StructuredOutputError(request.label, maxAttempts, lastError, lastResponse);
}

type Outcome<T> = { ok: true; value: T } | { ok: false; error: string };

function parseAndValidate<T>(raw: string, request: GenerateStructuredRequest<T>): Outcome<T> {
  let error = `no JSON ${request.shape === "array" ? "array" : "object"} found in the reply`;

  for (const candidate of extractJsonCandidates(raw, request.shape ?? "object")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch (parseError) {
      error = `invalid JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`;
      continue;
    }

    const result = request.schema.safeParse(parsed);
    if (!result.success) {
      error = `schema validation failed: ${formatIssues(result.error)}`;
      continue;
    }

    try {
      return { ok: true, value: request.check ? request.check(result.data) : result.data };
    } catch (checkError) {
      error = checkError instanceof Error ? checkError.message : String(checkError);
    }
  }

  return { ok: false, error };
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "(root)"}: ${issue.message}`)
    .join("; ");
}

function truncate(text: string): string {
  return text.length > MAX_RAW_RESPONSE_LENGTH
    ? `${text.slice(0, MAX_RAW_RESPONSE_LENGTH)}…`
    : text;
}
