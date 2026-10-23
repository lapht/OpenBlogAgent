import { z } from "zod";

import type { TextGenerationProvider } from "@openblog/providers";
import type { ArticleBrief } from "@openblog/types";

import { buildEditorPrompt } from "../prompts/editor";
import { generateStructured, type StructuredOutputOptions } from "../structured-output";

export const editorOutputSchema = z.object({
  editedText: z.string().trim().min(1, "editedText must not be empty"),
  changesSummary: z.string()
});

export type EditorOutput = z.infer<typeof editorOutputSchema>;

export interface EditorAgentInput {
  rawText: string;
  brief?: ArticleBrief;
}

export interface EditorAgent {
  run(input: EditorAgentInput): Promise<EditorOutput>;
}

export function createEditorAgent(
  provider: TextGenerationProvider,
  options: StructuredOutputOptions = {}
): EditorAgent {
  return {
    run(input: EditorAgentInput): Promise<EditorOutput> {
      return generateStructured(provider, {
        ...options,
        prompt: buildEditorPrompt(input),
        schema: editorOutputSchema,
        label: "Editor agent"
      });
    }
  };
}
