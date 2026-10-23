import type { ArticleBrief } from "@openblog/types";

import { briefLines, briefValues, languageLines } from "./brief";
import { renderPromptTemplate } from "./overrides";

export const PLANNER_PROMPT_VERSION = "3";

/**
 * `template` is an operator override of the instructions (validated placeholders); the language,
 * brief and JSON contract lines stay in code and are always part of the prompt.
 */
export function buildPlannerPrompt(topic: string, brief?: ArticleBrief, template?: string): string {
  const context = [
    ...languageLines(brief, "Write the section titles in {language}."),
    ...briefLines(brief, ["audience", "tone", "keywords", "notes"])
  ];
  const contract = [
    "Return valid JSON only.",
    'Use this exact shape: ["Section title", "Section title"]'
  ];

  if (template !== undefined) {
    return [
      renderPromptTemplate(template, { topic, ...briefValues(brief) }),
      ...context,
      ...contract
    ].join("\n");
  }

  return [
    "You are a pragmatic content strategist.",
    `Create a simple and practical article outline for the topic: ${topic}`,
    ...context,
    ...contract,
    "Create 4 to 6 sections maximum.",
    "Avoid overly broad, academic, or redundant sections.",
    "The outline should be suitable for a clear blog post, not a long-form essay.",
    "Include an introduction and a conclusion through the section titles."
  ].join("\n");
}
