import type { EditorAgentInput } from "../editor/agent";

export const EDITOR_PROMPT_VERSION = "1";

export function buildEditorPrompt(input: EditorAgentInput): string {
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
