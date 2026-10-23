import type { EditorialReviewInput } from "../review/agent";

import { renderPromptTemplate } from "./overrides";

export const REVIEW_PROMPT_VERSION = "1";

export function buildReviewPrompt(input: EditorialReviewInput, template?: string): string {
  return [
    ...(template !== undefined
      ? [
          renderPromptTemplate(template, {
            title: input.title,
            metaDescription: input.metaDescription,
            outline: input.outline.map((section) => `- ${section}`).join("\n")
          })
        ]
      : [
          "You are a strict editorial reviewer for a blog.",
          "Score the article below from 0 to 10 on each dimension. Use the whole range: 5 is mediocre, 8 is good, 10 is excellent."
        ]),
    "",
    "Dimensions:",
    "- seo: the title and meta description fit the content and are specific; keywords are used naturally.",
    "- readability: clear sentences, consistent tone, easy to follow.",
    "- structure: a logical flow with an introduction, well-ordered sections and a conclusion.",
    "- completeness: every outline section is covered with enough substance.",
    "- repetition: 10 means no repeated ideas or phrases, 0 means the text repeats itself heavily.",
    "",
    "Output rules:",
    "- Return valid JSON only.",
    "- Do not wrap the JSON in Markdown fences.",
    "- Scores are numbers between 0 and 10.",
    "- `rationale` is two or three sentences naming the main weaknesses (or why it is good).",
    "",
    "Return this exact JSON structure:",
    JSON.stringify(
      {
        scores: { seo: 0, readability: 0, structure: 0, completeness: 0, repetition: 0 },
        rationale: "Short explanation of the scores."
      },
      null,
      2
    ),
    "",
    `Title: ${input.title}`,
    `Meta description: ${input.metaDescription}`,
    "",
    "Outline:",
    ...input.outline.map((section) => `- ${section}`),
    "",
    "Article:",
    input.articleText
  ].join("\n");
}
