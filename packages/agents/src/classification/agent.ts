import { z } from "zod";

import type { TextGenerationProvider } from "@openblog/providers";

import { generateStructured, type StructuredOutputOptions } from "../structured-output";

export const classificationOutputSchema = z.object({
  category: z.string().trim().min(1, "category must not be empty"),
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

export function createClassificationAgent(
  provider: TextGenerationProvider,
  options: StructuredOutputOptions = {}
): ClassificationAgent {
  return {
    run(input: ClassificationAgentInput): Promise<ClassificationOutput> {
      return generateStructured(provider, {
        ...options,
        prompt: buildClassificationPrompt(input),
        schema: classificationOutputSchema,
        label: "Classification agent",
        check: (output) => checkClassification(output, input)
      });
    }
  };
}

function checkClassification(
  output: ClassificationOutput,
  input: ClassificationAgentInput
): ClassificationOutput {
  const category = input.availableCategories.find(
    (candidate) => candidate.trim().toLowerCase() === output.category.toLowerCase()
  );

  if (!category) {
    throw new Error(
      `category "${output.category}" is not allowed; it must be exactly one of: ${input.availableCategories.join(", ")}`
    );
  }

  const seen = new Set<string>();
  const tags: string[] = [];

  for (const raw of output.tags) {
    const tag = raw.trim();
    const key = tag.toLowerCase();

    if (tag && !seen.has(key)) {
      seen.add(key);
      tags.push(tag);
    }
  }

  return { category, tags: tags.slice(0, input.maxTags) };
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
