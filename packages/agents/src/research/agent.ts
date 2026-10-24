import { z } from "zod";

import type { TextGenerationProvider } from "@openblog/providers";

import { buildResearchPrompt } from "../prompts/research";
import { generateStructured, type StructuredOutputOptions } from "../structured-output";

const text = (max: number) => z.string().trim().min(1).max(max);

/** What the model proposes for a topic candidate. */
export const topicIdeaSchema = z.object({
  angle: text(600),
  workingTitle: text(120),
  targetKeyword: text(100),
  motivation: text(400)
});

export type TopicIdea = z.infer<typeof topicIdeaSchema>;

export interface TopicIdeaInput {
  title: string;
  summary?: string;
  source: string;
  /** Language the proposal is written in. */
  language?: string;
}

export interface ResearchAgent {
  run(input: TopicIdeaInput): Promise<TopicIdea>;
}

export function createResearchAgent(
  provider: TextGenerationProvider,
  options: Pick<StructuredOutputOptions, "maxAttempts"> = {}
): ResearchAgent {
  return {
    run(input) {
      return generateStructured(provider, {
        ...options,
        prompt: buildResearchPrompt(input),
        schema: topicIdeaSchema,
        label: "Research agent"
      });
    }
  };
}
