import type { ArticleBrief } from "@openblog/types";

import { DEFAULT_ARTICLE_RULES } from "../quality";

import { briefLines, briefValues, languageLines } from "./brief";
import { renderPromptTemplate } from "./overrides";
import {
  internalLinkLines,
  referenceRequirementLines,
  sourceNoteLines,
  type SourceNote
} from "./sources";

export const WRITER_PROMPT_VERSION = "3";

export interface WriterPromptOptions {
  /** Problems found in a previous attempt, to be fixed by this one. */
  feedback?: string;
  brief?: ArticleBrief;
  /** What a human reviewer asks to change in `previousArticle` (a revision). */
  reviewerFeedback?: string;
  /** The version the reviewer read. */
  previousArticle?: string;
  /** Requested length; defaults to the quality gate's default range. */
  minWords?: number;
  maxWords?: number;
  /** Text read from the brief's source pages; the article is grounded in it and lists it as references. */
  sources?: SourceNote[];
  /** Published articles of the same site the article may link to. */
  internalLinks?: { title: string; url: string }[];
  /** Operator override of the style instructions; the requirements the quality gate enforces stay. */
  template?: string;
}

export function buildWriterPrompt(
  topic: string,
  outline: string[],
  options: WriterPromptOptions = {}
): string {
  const { feedback, brief, reviewerFeedback, previousArticle, sources, internalLinks } = options;
  const minWords = options.minWords ?? DEFAULT_ARTICLE_RULES.minWords;
  const maxWords = options.maxWords ?? DEFAULT_ARTICLE_RULES.maxWords;

  const structure = [
    "- Do not include an H1 title.",
    "- Start directly with the introduction.",
    "- Use H2 sections aligned with the outline.",
    `- Keep the article between ${minWords} and ${maxWords} words.`
  ];
  const context = [
    ...languageLines(
      brief,
      "- Write the whole article in {language}, including headings. Keep code, commands and proper names as they are."
    ),
    ...briefLines(brief, ["audience", "tone", "keywords", "notes"]),
    ...sourceNoteLines(sources),
    ...referenceRequirementLines(sources, brief?.language),
    ...internalLinkLines(internalLinks)
  ];
  const head =
    options.template !== undefined
      ? [
          renderPromptTemplate(options.template, {
            topic,
            outline: outline.map((section, index) => `${index + 1}. ${section}`).join("\n"),
            ...briefValues(brief)
          }),
          "Requirements:",
          ...structure
        ]
      : [
          "You are a clear and concise technical blog writer.",
          `Write a Markdown article about: ${topic}`,
          "Requirements:",
          ...structure,
          "- Write in a clear, practical, human tone.",
          "- Prefer short paragraphs and simple explanations.",
          "- Avoid unnecessary depth, filler, repetition, and academic style.",
          "- If the topic is technical, explain only what is useful to the reader.",
          "- End with a short practical conclusion."
        ];

  return [
    ...head,
    ...context,
    "Outline:",
    ...outline.map((section, index) => `${index + 1}. ${section}`),
    ...(reviewerFeedback
      ? [
          "",
          "A human reviewer read the previous version of this article and asks for changes. Write the whole article again and apply every change below:",
          reviewerFeedback,
          ...(previousArticle ? ["", "Previous version:", previousArticle] : [])
        ]
      : []),
    ...(feedback
      ? [
          "",
          "Your previous attempt was rejected by automatic checks. Write the article again and fix every problem below:",
          feedback
        ]
      : [])
  ].join("\n");
}
