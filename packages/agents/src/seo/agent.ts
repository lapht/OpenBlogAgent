import { z } from "zod";

import type { TextGenerationProvider } from "@openblog/providers";

export const seoOutputSchema = z.object({
  title: z.string().max(60),
  metaDescription: z.string().max(155),
  slug: z.string(),
  h1: z.string(),
  headings: z.array(
    z.object({
      level: z.enum(["H2", "H3"]),
      text: z.string()
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

export function createSeoAgent(provider: TextGenerationProvider): SeoAgent {
  return {
    async run(input: SeoAgentInput): Promise<SeoOutput> {
      const prompt = buildSeoPrompt(input);
      const rawOutput = await provider.generate(prompt);
      return parseSeoOutput(rawOutput);
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

function parseSeoOutput(raw: string): SeoOutput {
  const trimmed = raw.trim();

  const candidates = [
    trimmed,
    extractJsonFromFullMarkdownFence(trimmed),
    extractOuterJsonObject(trimmed)
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      const normalized = normalizeSeoOutput(parsed);
      return seoOutputSchema.parse(normalized);
    } catch {
      // Try next candidate
    }
  }

  throw new Error(`SEO agent did not return valid JSON. Received: ${raw}`);
}

function extractJsonFromFullMarkdownFence(text: string): string | null {
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1]?.trim() ?? null;
}

function extractOuterJsonObject(text: string): string | null {
  const startIndex = text.indexOf("{");
  const endIndex = text.lastIndexOf("}");

  if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) {
    return null;
  }

  return text.slice(startIndex, endIndex + 1);
}

function normalizeSeoOutput(parsed: Record<string, unknown>): SeoOutput {
  return {
    title:
      typeof parsed.title === "string"
        ? parsed.title.trim().slice(0, 60)
        : "",
    metaDescription:
      typeof parsed.metaDescription === "string"
        ? parsed.metaDescription.trim().slice(0, 155)
        : "",
    slug:
      typeof parsed.slug === "string"
        ? normalizeSlug(parsed.slug)
        : "",
    h1:
      typeof parsed.h1 === "string"
        ? parsed.h1.trim()
        : "",
    headings: normalizeHeadings(parsed.headings)
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

function normalizeHeadings(value: unknown): Array<{ level: "H2" | "H3"; text: string }> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((heading) => {
    if (typeof heading === "string") {
      const text = heading.trim();
      return text ? [{ level: "H2" as const, text }] : [];
    }

    if (heading && typeof heading === "object") {
      const candidate = heading as Record<string, unknown>;

      const text = typeof candidate.text === "string" ? candidate.text.trim() : "";
      const level = typeof candidate.level === "string" ? candidate.level.toUpperCase() : "H2";

      if (!text) {
        return [];
      }

      return [
        {
          level: level === "H3" ? "H3" : "H2",
          text
        }
      ];
    }

    return [];
  });
}