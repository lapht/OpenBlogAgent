import type { SeoAgentInput } from "../seo/agent";

import { briefLines } from "./brief";

export const SEO_PROMPT_VERSION = "2";

export function buildSeoPrompt(input: SeoAgentInput): string {
  return [
    "You are an SEO expert.",
    "Analyze the article content and produce SEO-optimized metadata.",
    ...briefLines(input.brief, ["language", "audience", "keywords"]),
    "",
    "Output rules:",
    "- Return valid JSON only.",
    "- Do not wrap the JSON in Markdown fences.",
    "- Do not add explanations outside the JSON.",
    "- The title must be at most 60 characters.",
    "- The metaDescription must be at most 155 characters.",
    "- The slug must be lowercase, URL-safe, and use hyphens instead of spaces.",
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
