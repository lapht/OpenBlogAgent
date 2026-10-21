import { z } from "zod";

import type { TextGenerationProvider } from "@openblog/providers";

import { buildSeoPrompt } from "../prompts/seo";
import { generateStructured, type StructuredOutputOptions } from "../structured-output";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const slugSchema = z
  .string()
  .transform(normalizeSlug)
  .pipe(
    z
      .string()
      .min(1, "slug must not be empty")
      .regex(SLUG_PATTERN, "slug must be lowercase letters, digits and hyphens")
  );

export const seoOutputSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "title must not be empty")
    .max(60, "title must be at most 60 characters"),
  metaDescription: z
    .string()
    .trim()
    .min(1, "metaDescription must not be empty")
    .max(155, "metaDescription must be at most 155 characters"),
  slug: slugSchema,
  h1: z.string().trim().min(1, "h1 must not be empty"),
  headings: z.array(
    z.object({
      level: z.enum(["H2", "H3"]),
      text: z.string().trim().min(1, "heading text must not be empty")
    })
  )
});

export type SeoOutput = z.infer<typeof seoOutputSchema>;

export interface SeoAgentInput {
  outline: string[];
  articleText: string;
}

export interface SeoAgent {
  run(input: SeoAgentInput): Promise<SeoOutput>;
}

export function createSeoAgent(
  provider: TextGenerationProvider,
  options: StructuredOutputOptions = {}
): SeoAgent {
  return {
    run(input: SeoAgentInput): Promise<SeoOutput> {
      return generateStructured(provider, {
        ...options,
        prompt: buildSeoPrompt(input),
        schema: seoOutputSchema,
        label: "SEO agent"
      });
    }
  };
}

function normalizeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
