import type { ArticleBrief } from "@openblog/types";

import { briefLines, languageLines } from "./brief";

export const PLANNER_PROMPT_VERSION = "3";

export function buildPlannerPrompt(topic: string, brief?: ArticleBrief): string {
  return [
    "You are a pragmatic content strategist.",
    `Create a simple and practical article outline for the topic: ${topic}`,
    ...languageLines(brief, "Write the section titles in {language}."),
    ...briefLines(brief, ["audience", "tone", "keywords", "notes"]),
    "Return valid JSON only.",
    'Use this exact shape: ["Section title", "Section title"]',
    "Create 4 to 6 sections maximum.",
    "Avoid overly broad, academic, or redundant sections.",
    "The outline should be suitable for a clear blog post, not a long-form essay.",
    "Include an introduction and a conclusion through the section titles."
  ].join("\n");
}
