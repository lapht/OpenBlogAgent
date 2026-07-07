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
    "You are an SEO expert. Analyze the article content and produce SEO-optimized metadata.",
    "",
    "Article Outline:",
    ...input.outline.map((s, i) => `${i + 1}. ${s}`),
    "",
    "Article Text:",
    input.articleText,
    "",
    "Return valid JSON only with this exact structure:",
    JSON.stringify(seoOutputSchema.shape, null, 2),
    "",
    "Important:",
    "- headings must be an array of objects like {\"level\": \"H2\", \"text\": \"Section title\"}",
    "- title must be at most 60 characters",
    "- metaDescription must be at most 155 characters"
  ].join("\n");
}

function parseSeoOutput(raw: string): SeoOutput {
  const trimmed = raw.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch?.[1]?.trim() ?? trimmed;
  const startIndex = candidate.indexOf("{");
  const endIndex = candidate.lastIndexOf("}");

  if (startIndex < 0 || endIndex < 0) {
    throw new Error("SEO agent did not return valid JSON");
  }

  const parsed = JSON.parse(candidate.slice(startIndex, endIndex + 1)) as Record<string, unknown>;
  const normalized: Record<string, unknown> = {
    ...parsed,
    title: typeof parsed.title === "string" ? parsed.title.trim().slice(0, 60) : "",
    metaDescription:
      typeof parsed.metaDescription === "string"
        ? parsed.metaDescription.trim().slice(0, 155)
        : "",
    slug: typeof parsed.slug === "string" ? parsed.slug.trim() : "",
    h1: typeof parsed.h1 === "string" ? parsed.h1.trim() : "",
    headings: normalizeHeadings(parsed.headings)
  };

  return seoOutputSchema.parse(normalized);
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

      return [{ level: level === "H3" ? "H3" : "H2", text }];
    }

    return [];
  });
}