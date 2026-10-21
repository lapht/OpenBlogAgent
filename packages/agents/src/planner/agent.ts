import { z } from "zod";

import type { TextGenerationProvider } from "@openblog/providers";

import { buildPlannerPrompt } from "../prompts/planner";
import { generateStructured, type StructuredOutputOptions } from "../structured-output";

export const plannerOutlineSchema = z.array(z.string().trim().min(1)).min(3);

export interface PlannerAgentInput {
  topic: string;
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
    buildPrompt: (input) => buildPlannerPrompt(input.topic),
    run(input: PlannerAgentInput): Promise<string[]> {
      return generateStructured(provider, {
        ...options,
        prompt: buildPlannerPrompt(input.topic),
        schema: plannerOutlineSchema,
        shape: "array",
        label: "Planner"
      });
    }
  };
}
