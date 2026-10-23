import { parse as parseYaml } from "yaml";
import { z } from "zod";

import type { TopicSourceConfig } from "./types";

const keywords = z.array(z.string().trim().min(1)).default([]);

const sourceSchema = z
  .object({
    name: z.string().trim().min(1),
    type: z.enum(["feed", "sitemap"]),
    url: z
      .string()
      .trim()
      .url()
      .refine((value) => /^https?:\/\//i.test(value), "must be an http or https URL"),
    weight: z.number().min(0).max(10).default(1),
    include: keywords,
    exclude: keywords
  })
  .strict();

const sourcesFileSchema = z
  .object({ sources: z.array(sourceSchema).min(1) })
  .strict()
  .superRefine((file, context) => {
    const seen = new Set<string>();
    file.sources.forEach((source, index) => {
      const key = source.name.toLowerCase();
      if (seen.has(key)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sources", index, "name"],
          message: `duplicate source name "${source.name}"`
        });
      }
      seen.add(key);
    });
  });

/** The sources file is unusable; the message names every problem. */
export class SourcesConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourcesConfigError";
  }
}

/**
 * Parses the content of a sources file (YAML or JSON): `{ sources: [{ name, type, url, weight?,
 * include?, exclude? }] }`. `label` names the file in error messages.
 */
export function parseSourcesFile(content: string, label = "sources file"): TopicSourceConfig[] {
  let data: unknown;
  try {
    // YAML is a superset of JSON, so one parser reads both.
    data = parseYaml(content);
  } catch (error) {
    throw new SourcesConfigError(
      `${label} is not valid YAML or JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const parsed = sourcesFileSchema.safeParse(data);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new SourcesConfigError(`${label} is invalid: ${issues}`);
  }
  return parsed.data.sources;
}
