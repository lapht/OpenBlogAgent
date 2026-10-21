import dotenv from "dotenv";
import type { ZodIssue } from "zod";

import { envSchema, type EnvSchema } from "./schema";

dotenv.config();

/**
 * Describes an issue by variable name and expected shape only. Zod's default
 * messages can embed the received value (e.g. invalid enum), which could leak a
 * secret, so the received value is never included.
 */
const describeIssue = (issue: ZodIssue): string => {
  const name = issue.path.join(".") || "(root)";

  switch (issue.code) {
    case "invalid_enum_value":
      return `${name}: must be one of ${issue.options.join(", ")}`;
    case "invalid_type":
      return issue.received === "undefined"
        ? `${name}: is required`
        : `${name}: expected ${issue.expected}`;
    default:
      return `${name}: invalid value`;
  }
};

export const loadEnv = (input: NodeJS.ProcessEnv = process.env): EnvSchema => {
  const parsed = envSchema.safeParse(input);

  if (!parsed.success) {
    throw new Error(
      `Invalid environment configuration: ${parsed.error.issues.map(describeIssue).join("; ")}`
    );
  }

  return parsed.data;
};
