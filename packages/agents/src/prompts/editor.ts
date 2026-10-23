import type { EditorAgentInput } from "../editor/agent";

import { briefLines, briefValues, languageLines } from "./brief";
import { renderPromptTemplate } from "./overrides";

export const EDITOR_PROMPT_VERSION = "3";

export function buildEditorPrompt(input: EditorAgentInput, template?: string): string {
  return [
    ...(template !== undefined
      ? [renderPromptTemplate(template, briefValues(input.brief))]
      : [
          "You are an experienced editor.",
          "Improve the text for readability, tone consistency, and clarity.",
          "Remove redundancies and break up overly long sentences."
        ]),
    ...languageLines(input.brief, "The article is written in {language}; keep it in {language}."),
    ...briefLines(input.brief, ["audience", "tone", "keywords"]),
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
