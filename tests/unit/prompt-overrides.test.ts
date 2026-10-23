import { describe, expect, it } from "vitest";

import {
  hashPrompt,
  PROMPT_PLACEHOLDERS,
  PromptOverrideError,
  renderPromptTemplate,
  validatePromptTemplate
} from "../../packages/agents/src/prompts/overrides";
import { buildClassificationPrompt } from "../../packages/agents/src/prompts/classification";
import { buildEditorPrompt } from "../../packages/agents/src/prompts/editor";
import { buildPlannerPrompt } from "../../packages/agents/src/prompts/planner";
import { buildReviewPrompt } from "../../packages/agents/src/prompts/review";
import { buildSeoPrompt } from "../../packages/agents/src/prompts/seo";
import { buildWriterPrompt } from "../../packages/agents/src/prompts/writer";

const brief = {
  topic: "Caching",
  language: "it",
  audience: "backend engineers",
  tone: "dry",
  targetKeyword: "caching",
  secondaryKeywords: ["ttl", "cdn"],
  notes: "No hype.",
  minWords: 500,
  maxWords: 900
};
const outline = ["Why caching matters", "Invalidation", "Conclusion"];

describe("built-in prompts", () => {
  // The snapshots were taken from the prompts as they were before overrides existed: without
  // OPENBLOG_PROMPTS_DIR nothing a model receives changes.
  it.each([
    ["topic only", undefined],
    ["full brief", brief]
  ])("are unchanged (%s)", (_name, input) => {
    expect({
      planner: buildPlannerPrompt("Caching", input),
      writer: buildWriterPrompt("Caching", outline, {
        brief: input,
        minWords: 500,
        maxWords: 900,
        feedback: "fix the length",
        reviewerFeedback: "shorter intro",
        previousArticle: "Old text"
      }),
      editor: buildEditorPrompt({ rawText: "Raw text", brief: input }),
      seo: buildSeoPrompt({ outline, articleText: "Text", brief: input }),
      classification: buildClassificationPrompt({
        articleText: "Text",
        availableCategories: ["News", "Guides"],
        availableTags: ["ai"],
        maxTags: 4
      }),
      review: buildReviewPrompt({
        outline,
        articleText: "Text",
        title: "A title",
        metaDescription: "A description"
      })
    }).toMatchSnapshot();
  });
});

describe("validatePromptTemplate", () => {
  it("accepts the placeholders of each agent, with or without spaces", () => {
    expect(() =>
      validatePromptTemplate(
        "planner",
        "Plan {{topic}} for {{ brief.audience }}, tone {{brief.tone}}"
      )
    ).not.toThrow();
    expect(() =>
      validatePromptTemplate("writer", "Write about {{topic}} following {{outline}}")
    ).not.toThrow();
    expect(() => validatePromptTemplate("editor", "Edit in a {{brief.tone}} tone")).not.toThrow();
    expect(() =>
      validatePromptTemplate("classification", "At most {{maxTags}} tags")
    ).not.toThrow();
    expect(() =>
      validatePromptTemplate("review", "Review {{title}}: {{metaDescription}}")
    ).not.toThrow();
    expect(() => validatePromptTemplate("seo", "No placeholders at all")).not.toThrow();
  });

  it("rejects an unknown placeholder and names the allowed ones", () => {
    const failure = () => validatePromptTemplate("editor", "Edit {{topic}}");
    expect(failure).toThrow(PromptOverrideError);
    expect(failure).toThrow(/unknown placeholder \{\{topic\}\}/);
    expect(failure).toThrow(/\{\{brief\.tone\}\}/);
    expect(() => validatePromptTemplate("planner", "Plan {{topic}} {{outline}}")).toThrow(
      /\{\{outline\}\}/
    );
  });

  it("rejects an empty file, a stray {{ and a missing {{topic}}", () => {
    expect(() => validatePromptTemplate("seo", "  \n")).toThrow(/empty/);
    expect(() => validatePromptTemplate("seo", "Use {{brief.tone")).toThrow(
      /does not start a placeholder/
    );
    expect(() => validatePromptTemplate("planner", "Plan something")).toThrow(
      /must contain \{\{topic\}\}/
    );
    expect(() => validatePromptTemplate("writer", "Write {{outline}}")).toThrow(
      /must contain \{\{topic\}\}/
    );
  });

  it("lets literal single and closing braces through", () => {
    expect(() => validatePromptTemplate("seo", 'Example: {"a": {"b": 1}}')).not.toThrow();
  });

  it("lists every agent's placeholders", () => {
    expect(Object.keys(PROMPT_PLACEHOLDERS).sort()).toEqual(
      ["classification", "editor", "planner", "review", "seo", "writer"].sort()
    );
  });
});

describe("renderPromptTemplate and hashPrompt", () => {
  it("fills values and renders what is absent as nothing", () => {
    expect(renderPromptTemplate("A {{x}} B {{ y }}C", { x: "1" })).toBe("A 1 B C");
  });

  it("hashes a prompt to a stable SHA-256 hex string", () => {
    expect(hashPrompt("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    expect(hashPrompt("abc")).not.toBe(hashPrompt("abd"));
  });
});

describe("prompts with an override", () => {
  it("planner: replaces the instructions, keeps the language, the brief and the JSON contract", () => {
    const prompt = buildPlannerPrompt(
      "Caching",
      brief,
      "House style: {{brief.tone}} for {{brief.audience}} on {{topic}}."
    );

    expect(prompt).toContain("House style: dry for backend engineers on Caching.");
    expect(prompt).toContain("Write the section titles in Italian (it).");
    expect(prompt).toContain("- Target keyword: caching");
    expect(prompt).toContain("Return valid JSON only.");
    expect(prompt).toContain('Use this exact shape: ["Section title", "Section title"]');
    expect(prompt).not.toContain("pragmatic content strategist");
    expect(prompt).not.toContain("Create 4 to 6 sections maximum.");
  });

  it("writer: keeps the requirements the quality gate checks, the outline and the feedback", () => {
    const prompt = buildWriterPrompt("Caching", outline, {
      brief,
      minWords: 500,
      maxWords: 900,
      feedback: "too short",
      template: "Write like a field guide about {{topic}}.\n{{outline}}"
    });

    expect(
      prompt.startsWith("Write like a field guide about Caching.\n1. Why caching matters")
    ).toBe(true);
    expect(prompt).toContain("- Do not include an H1 title.");
    expect(prompt).toContain("- Use H2 sections aligned with the outline.");
    expect(prompt).toContain("- Keep the article between 500 and 900 words.");
    expect(prompt).toContain("Outline:\n1. Why caching matters");
    expect(prompt).toContain("Your previous attempt was rejected by automatic checks");
    expect(prompt).not.toContain("clear and concise technical blog writer");
    expect(prompt).not.toContain("Prefer short paragraphs");
  });

  it("editor: keeps the output rules and the original text", () => {
    const prompt = buildEditorPrompt(
      { rawText: "Raw text", brief },
      "Edit for {{brief.audience}}."
    );

    expect(prompt.startsWith("Edit for backend engineers.")).toBe(true);
    expect(prompt).toContain("The article is written in Italian (it)");
    expect(prompt).toContain("Return valid JSON only.");
    expect(prompt).toContain('"editedText"');
    expect(prompt.endsWith("Original text:\nRaw text")).toBe(true);
    expect(prompt).not.toContain("experienced editor");
  });

  it("seo: keeps the length limits and the JSON structure", () => {
    const prompt = buildSeoPrompt(
      { outline, articleText: "Text", brief },
      "Optimize for {{brief.targetKeyword}}. Sections:\n{{outline}}"
    );

    expect(prompt.startsWith("Optimize for caching. Sections:\n1. Why caching matters")).toBe(true);
    expect(prompt).toContain("The title must be at most 60 characters.");
    expect(prompt).toContain('"metaDescription"');
    expect(prompt).not.toContain("You are an SEO expert.");
  });

  it("classification: keeps the category and tag rules", () => {
    const prompt = buildClassificationPrompt(
      { articleText: "Text", availableCategories: ["News"], maxTags: 3 },
      "Use at most {{maxTags}} tags."
    );

    expect(prompt.startsWith("Use at most 3 tags.")).toBe(true);
    expect(prompt).toContain("category must be exactly one of the availableCategories");
    expect(prompt).toContain("1. News");
    expect(prompt).not.toContain("content classification expert");
  });

  it("review: keeps the dimensions and the score shape", () => {
    const prompt = buildReviewPrompt(
      { outline, articleText: "Text", title: "A title", metaDescription: "A description" },
      "Be harsh about {{title}}."
    );

    expect(prompt.startsWith("Be harsh about A title.")).toBe(true);
    expect(prompt).toContain("- repetition: 10 means no repeated ideas");
    expect(prompt).toContain('"scores"');
    expect(prompt).not.toContain("strict editorial reviewer");
  });

  it("renders brief fields the brief does not set as nothing", () => {
    expect(
      buildPlannerPrompt("Caching", { topic: "Caching" }, "[{{brief.tone}}] {{topic}}")
    ).toContain("[] Caching");
  });
});
