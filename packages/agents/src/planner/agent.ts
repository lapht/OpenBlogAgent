import { z } from "zod";

import type { TextGenerationProvider } from "@openblog/providers";
import type { ArticleBrief } from "@openblog/types";

import { buildPlannerPrompt } from "../prompts/planner";
import type { SourceNote } from "../prompts/sources";
import { generateStructured, type StructuredOutputOptions } from "../structured-output";

export const plannerOutlineSchema = z.array(z.string().trim().min(1)).min(3);

export interface PlannerAgentInput {
  topic: string;
  brief?: ArticleBrief;
  /** Text read from the brief's source pages; the outline should cover what they say. */
  sources?: SourceNote[];
}

export interface PlannerAgent {
  /** The exact prompt `run` sends, so callers can record it. */
  buildPrompt(input: PlannerAgentInput): string;
  run(input: PlannerAgentInput): Promise<string[]>;
}

export function createPlannerAgent(
  provider: TextGenerationProvider,
  options: StructuredOutputOptions = {}
): PlannerAgent {
  return {
    buildPrompt: (input) =>
      buildPlannerPrompt(input.topic, input.brief, options.promptTemplate, input.sources),
    run(input: PlannerAgentInput): Promise<string[]> {
      return generateStructured(provider, {
        ...options,
        prompt: buildPlannerPrompt(input.topic, input.brief, options.promptTemplate, input.sources),
        schema: plannerOutlineSchema,
        shape: "array",
        label: "Planner"
      });
    }
  };
}
