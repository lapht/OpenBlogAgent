import { z } from "zod";

import type { TextGenerationProvider } from "@openblog/providers";

export const editorOutputSchema = z.object({
  editedText: z.string(),
  changesSummary: z.string()
});

export type EditorOutput = z.infer<typeof editorOutputSchema>;

export interface EditorAgentInput {
  rawText: string;
}

export interface EditorAgent {
  run(input: EditorAgentInput): Promise<EditorOutput>;
}

export function createEditorAgent(provider: TextGenerationProvider): EditorAgent {
  return {
    async run(input: EditorAgentInput): Promise<EditorOutput> {
      const prompt = buildEditorPrompt(input);
      const rawOutput = await provider.generate(prompt);
      return parseEditorOutput(rawOutput);
    }
  };
}

function buildEditorPrompt(input: EditorAgentInput): string {
  return [
    "You are an experienced editor. Improve the text for readability, tone consistency, and clarity.",
    "Remove redundancies and break up overly long sentences.",
    "",
    "Original text:",
    input.rawText,
    "",
    "Return valid JSON only with this exact structure:",
    JSON.stringify(editorOutputSchema.shape, null, 2)
  ].join("\n");
}

function parseEditorOutput(raw: string): EditorOutput {
  const trimmed = raw.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch?.[1]?.trim() ?? trimmed;
  const startIndex = candidate.indexOf("{");
  const endIndex = candidate.lastIndexOf("}");

  if (startIndex < 0 || endIndex < 0) {
    throw new Error("Editor agent did not return valid JSON");
  }

  const parsed = JSON.parse(candidate.slice(startIndex, endIndex + 1));
  return editorOutputSchema.parse(parsed);
}