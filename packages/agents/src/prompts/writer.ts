import type { ArticleBrief } from "@openblog/types";

import { DEFAULT_ARTICLE_RULES } from "../quality";

import { briefLines } from "./brief";

export const WRITER_PROMPT_VERSION = "2";

export interface WriterPromptOptions {
  /** Problems found in a previous attempt, to be fixed by this one. */
  feedback?: string;
  brief?: ArticleBrief;
  /** Requested length; defaults to the quality gate's default range. */
  minWords?: number;
  maxWords?: number;
}

export function buildWriterPrompt(
  topic: string,
  outline: string[],
  options: WriterPromptOptions = {}
): string {
  const { feedback, brief } = options;
  const minWords = options.minWords ?? DEFAULT_ARTICLE_RULES.minWords;
  const maxWords = options.maxWords ?? DEFAULT_ARTICLE_RULES.maxWords;

  return [
    "You are a clear and concise technical blog writer.",
    `Write a Markdown article about: ${topic}`,
    "Requirements:",
    "- Do not include an H1 title.",
    "- Start directly with the introduction.",
    "- Use H2 sections aligned with the outline.",
    `- Keep the article between ${minWords} and ${maxWords} words.`,
    "- Write in a clear, practical, human tone.",
    "- Prefer short paragraphs and simple explanations.",
    "- Avoid unnecessary depth, filler, repetition, and academic style.",
    "- If the topic is technical, explain only what is useful to the reader.",
    "- End with a short practical conclusion.",
    ...briefLines(brief, ["language", "audience", "tone", "keywords", "notes"]),
    "Outline:",
    ...outline.map((section, index) => `${index + 1}. ${section}`),
    ...(feedback
      ? [
          "",
          "Your previous attempt was rejected by automatic checks. Write the article again and fix every problem below:",
          feedback
        ]
      : [])
  ].join("\n");
}
