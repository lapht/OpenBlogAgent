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

function parseEditorOutput(raw: string): EditorOutput {
  const trimmed = raw.trim();

  const candidates = [
    trimmed,
    extractJsonFromFullMarkdownFence(trimmed),
    extractOuterJsonObject(trimmed)
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      return editorOutputSchema.parse(parsed);
    } catch {
      // Try next candidate
    }
  }

  throw new Error(`Editor agent did not return valid JSON. Received: ${raw}`);
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