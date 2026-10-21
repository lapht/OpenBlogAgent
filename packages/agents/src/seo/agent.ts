import { z } from "zod";

import type { TextGenerationProvider } from "@openblog/providers";

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

function buildSeoPrompt(input: SeoAgentInput): string {
  return [
    "You are an SEO expert.",
    "Analyze the article content and produce SEO-optimized metadata.",
    "",
    "Output rules:",
    "- Return valid JSON only.",
    "- Do not wrap the JSON in Markdown fences.",
    "- Do not add explanations outside the JSON.",
    "- The title must be at most 60 characters.",
    "- The metaDescription must be at most 155 characters.",
    "- The slug must be lowercase, URL-safe, and use hyphens instead of spaces.",
    "- The h1 is only a suggested WordPress title, not article content.",
    "- headings must contain only H2 and H3 items found or suggested from the article structure.",
    "",
    "Return this exact JSON structure:",
    JSON.stringify(
      {
        title: "SEO title, max 60 characters",
        metaDescription: "SEO meta description, max 155 characters",
        slug: "url-safe-slug",
        h1: "Suggested WordPress title",
        headings: [
          {
            level: "H2",
            text: "Section heading"
          }
        ]
      },
      null,
      2
    ),
    "",
    "Article Outline:",
    ...input.outline.map((s, i) => `${i + 1}. ${s}`),
    "",
    "Article Text:",
    input.articleText
  ].join("\n");
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
