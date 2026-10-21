import { z } from "zod";

import type { TextGenerationProvider } from "@openblog/providers";

import { buildClassificationPrompt } from "../prompts/classification";
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
