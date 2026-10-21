import { z } from "zod";

import type { TextGenerationProvider } from "@openblog/providers";

import { buildReviewPrompt } from "../prompts/review";
import { generateStructured, type StructuredOutputOptions } from "../structured-output";

/** The dimensions the reviewer scores, each from 0 (unusable) to 10 (publishable as is). */
export const REVIEW_DIMENSIONS = [
  "seo",
  "readability",
  "structure",
  "completeness",
  "repetition"
] as const;

const scoreSchema = z.number().min(0).max(10);

/** The model gives the scores and the rationale; the overall score is computed here, not trusted. */
export const editorialReviewSchema = z
  .object({
    scores: z.object({
      seo: scoreSchema,
      readability: scoreSchema,
      structure: scoreSchema,
      completeness: scoreSchema,
      /** 10 means no repetition. */
      repetition: scoreSchema
    }),
    rationale: z.string().trim().min(1, "rationale must not be empty")
  })
  .transform((review) => {
    const values = REVIEW_DIMENSIONS.map((dimension) => review.scores[dimension]);
    const overall = values.reduce((sum, value) => sum + value, 0) / values.length;
    return { ...review, overall: Math.round(overall * 10) / 10 };
  });

export type EditorialReview = z.infer<typeof editorialReviewSchema>;

export interface EditorialReviewInput {
  outline: string[];
  articleText: string;
  title: string;
  metaDescription: string;
}

export interface EditorialReviewAgent {
  run(input: EditorialReviewInput): Promise<EditorialReview>;
}

export function createEditorialReviewAgent(
  provider: TextGenerationProvider,
  options: StructuredOutputOptions = {}
): EditorialReviewAgent {
  return {
    run(input: EditorialReviewInput): Promise<EditorialReview> {
      return generateStructured(provider, {
        ...options,
        prompt: buildReviewPrompt(input),
        schema: editorialReviewSchema,
        label: "Editorial review agent"
      });
    }
  };
}
