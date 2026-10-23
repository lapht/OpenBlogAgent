import type { ClassificationAgentInput } from "../classification/agent";

import { renderPromptTemplate } from "./overrides";

export const CLASSIFICATION_PROMPT_VERSION = "1";

export function buildClassificationPrompt(
  input: ClassificationAgentInput,
  template?: string
): string {
  return [
    ...(template !== undefined
      ? [renderPromptTemplate(template, { maxTags: String(input.maxTags) })]
      : [
          "You are a content classification expert.",
          "Analyze the article and assign exactly one category and a small set of relevant tags."
        ]),
    "",
    "Classification rules:",
    "- Return valid JSON only.",
    "- Do not wrap the JSON in Markdown fences.",
    "- Do not add explanations outside the JSON.",
    "- category must be exactly one of the availableCategories provided below.",
    "- Do not invent a category.",
    `- tags must be an array with at most ${input.maxTags} items.`,
    "- Tags must be specific and relevant to the article.",
    "- Avoid duplicate tags.",
    "- Avoid overly generic tags such as 'blog', 'article', 'technology', 'news' unless they are truly central.",
    "- Prefer tags from availableTags when relevant, but you may return new tags if needed.",
    "",
    "Return this exact JSON structure:",
    JSON.stringify(
      {
        category: "One category from availableCategories",
        tags: ["Specific tag 1", "Specific tag 2"]
      },
      null,
      2
    ),
    "",
    "Available Categories:",
    ...input.availableCategories.map((category, index) => `${index + 1}. ${category}`),
    "",
    "Available Tags:",
    ...(input.availableTags?.length
      ? input.availableTags.map((tag, index) => `${index + 1}. ${tag}`)
      : ["No predefined tags available."]),
    "",
    "Article Text:",
    input.articleText
  ].join("\n");
}
