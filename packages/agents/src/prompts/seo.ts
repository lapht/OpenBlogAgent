import type { SeoAgentInput } from "../seo/agent";

import { briefLines, briefValues, languageLines } from "./brief";
import { renderPromptTemplate } from "./overrides";

export const SEO_PROMPT_VERSION = "3";

export function buildSeoPrompt(input: SeoAgentInput, template?: string): string {
  return [
    ...(template !== undefined
      ? [
          renderPromptTemplate(template, {
            outline: input.outline.map((section, index) => `${index + 1}. ${section}`).join("\n"),
            ...briefValues(input.brief)
          })
        ]
      : [
          "You are an SEO expert.",
          "Analyze the article content and produce SEO-optimized metadata."
        ]),
    ...languageLines(
      input.brief,
      "The article is written in {language}: write the title, metaDescription, h1 and heading texts in {language}."
    ),
    ...briefLines(input.brief, ["audience", "keywords"]),
    "",
    "Output rules:",
    "- Return valid JSON only.",
    "- Do not wrap the JSON in Markdown fences.",
    "- Do not add explanations outside the JSON.",
    "- The title must be at most 60 characters.",
    "- The metaDescription must be at most 155 characters.",
    "- The slug must be lowercase ASCII (a-z, 0-9 and hyphens only) whatever the language: drop accents and transliterate special characters.",
    "- The h1 is only a suggested WordPress title, not article content.",
    "- headings must contain only H2 and H3 items found or suggested from the article structure.",
    "",
    "Return this exact JSON structure:",
    JSON.stringify(
      {
        title: "SEO title, max 60 characters",
        metaDescription: "SEO meta description, max 155 characters",
        slug: "url-safe-slug",
        h1: "Suggested WordPress title",
        headings: [
          {
            level: "H2",
            text: "Section heading"
          }
        ]
      },
      null,
      2
    ),
    "",
    "Article Outline:",
    ...input.outline.map((s, i) => `${i + 1}. ${s}`),
    "",
    "Article Text:",
    input.articleText
  ].join("\n");
}
