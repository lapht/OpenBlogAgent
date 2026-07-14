import { z } from "zod";

import type { TextGenerationProvider } from "@openblog/providers";

export const classificationOutputSchema = z.object({
  category: z.string(),
  tags: z.array(z.string())
});

export type ClassificationOutput = z.infer<typeof classificationOutputSchema>;

export interface ClassificationAgentInput {
  articleText: string;
  availableCategories: string[];
  availableTags?: string[];
  maxTags: number;
}

export interface ClassificationAgent {
  run(input: ClassificationAgentInput): Promise<ClassificationOutput>;
}

export function createClassificationAgent(provider: TextGenerationProvider): ClassificationAgent {
  return {
    async run(input: ClassificationAgentInput): Promise<ClassificationOutput> {
      const prompt = buildClassificationPrompt(input);
      const rawOutput = await provider.generate(prompt);
      return parseClassificationOutput(rawOutput, input.maxTags);
    }
  };
}

function buildClassificationPrompt(input: ClassificationAgentInput): string {
  return [
    "You are a content classification expert.",
    "Analyze the article and assign exactly one category and a small set of relevant tags.",
    "",
    "Classification rules:",
    "- Return valid JSON only.",
    "- Do not wrap the JSON in Markdown fences.",
    "- Do not add explanations outside the JSON.",
    "- category must be exactly one of the availableCategories provided below.",
    "- Do not invent a category.",
    `- tags must be an array with at most ${input.maxTags} items.`,
    "- Tags must be specific and relevant to the article.",
    "- Avoid duplicate tags.",
    "- Avoid overly generic tags such as 'blog', 'article', 'technology', 'news' unless they are truly central.",
    "- Prefer tags from availableTags when relevant, but you may return new tags if needed.",
    "",
    "Return this exact JSON structure:",
    JSON.stringify(
      {
        category: "One category from availableCategories",
        tags: ["Specific tag 1", "Specific tag 2"]
      },
      null,
      2
    ),
    "",
    "Available Categories:",
    ...input.availableCategories.map((category, index) => `${index + 1}. ${category}`),
    "",
    "Available Tags:",
    ...(input.availableTags?.length
      ? input.availableTags.map((tag, index) => `${index + 1}. ${tag}`)
      : ["No predefined tags available."]),
    "",
    "Article Text:",
    input.articleText
  ].join("\n");
}

function parseClassificationOutput(raw: string, maxTags: number): ClassificationOutput {
  const trimmed = raw.trim();

  const candidates = [
    trimmed,
    extractJsonFromFullMarkdownFence(trimmed),
    extractOuterJsonObject(trimmed)
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      const normalized = normalizeClassificationOutput(parsed, maxTags);
      return classificationOutputSchema.parse(normalized);
    } catch {
      // Try next candidate
    }
  }

  throw new Error(`Classification agent did not return valid JSON. Received: ${raw}`);
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

function normalizeClassificationOutput(
  parsed: Record<string, unknown>,
  maxTags: number
): ClassificationOutput {
  return {
    category: typeof parsed.category === "string" ? parsed.category.trim() : "",
    tags: normalizeTags(parsed.tags, maxTags)
  };
}

function normalizeTags(value: unknown, maxTags: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }

    const tag = item.trim();
    const key = tag.toLowerCase();

    if (!tag || seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(tag);

    if (normalized.length >= maxTags) {
      break;
    }
  }

  return normalized;
}