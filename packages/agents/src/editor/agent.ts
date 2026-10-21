import { z } from "zod";

import type { TextGenerationProvider } from "@openblog/providers";

import { generateStructured, type StructuredOutputOptions } from "../structured-output";

export const editorOutputSchema = z.object({
  editedText: z.string().trim().min(1, "editedText must not be empty"),
  changesSummary: z.string()
});

export type EditorOutput = z.infer<typeof editorOutputSchema>;

export interface EditorAgentInput {
  rawText: string;
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

function buildEditorPrompt(input: EditorAgentInput): string {
  return [
    "You are an experienced editor.",
    "Improve the text for readability, tone consistency, and clarity.",
    "Remove redundancies and break up overly long sentences.",
    "",
    "Output rules:",
    "- Return valid JSON only.",
    "- Do not wrap the JSON in Markdown fences.",
    "- Do not add explanations outside the JSON.",
    "- The `editedText` field may contain Markdown content.",
    "- Preserve useful Markdown formatting such as headings, lists, quotes, and code blocks.",
    "- Escape all double quotes inside JSON string values.",
    "",
    "Return this exact JSON structure:",
    JSON.stringify(
      {
        editedText: "The edited article text in Markdown.",
        changesSummary: "Short summary of the changes made."
      },
      null,
      2
    ),
    "",
    "Original text:",
    input.rawText
  ].join("\n");
}
