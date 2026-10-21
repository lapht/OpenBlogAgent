import { describe, expect, it } from "vitest";

import {
  DEFAULT_ARTICLE_RULES,
  formatViolations,
  validateArticle,
  type ArticleValidationInput,
  type ViolationCode
} from "../../packages/agents/src/quality";
import {
  buildArticle,
  fixtureOutline,
  goodArticle,
  placeholderArticle,
  tooShortArticle,
  truncatedArticle
} from "../fixtures/articles";

const goodSeo = {
  title: "Caching made simple",
  metaDescription: "How to cache well.",
  slug: "caching-made-simple"
};

const codes = (input: ArticleValidationInput, rules = {}) =>
  validateArticle(input, rules).violations.map((v) => v.code);

describe("validateArticle", () => {
  it("passes a good article with every optional input", () => {
    const result = validateArticle({
      article: goodArticle,
      draft: goodArticle,
      outline: fixtureOutline,
      seo: goodSeo
    });

    expect(result).toEqual({ passed: true, violations: [] });
  });

  const failing: Array<[ViolationCode, ArticleValidationInput]> = [
    ["word_count_too_short", { article: tooShortArticle }],
    ["word_count_too_long", { article: buildArticle(12) }],
    ["h1_present", { article: `# Title\n\n${goodArticle}` }],
    ["too_few_h2", { article: `${goodArticle.replace(/^## /gm, "### ")}` }],
    [
      "outline_coverage_low",
      { article: goodArticle, outline: ["Quantum gravity", "Medieval farming", "Jazz"] }
    ],
    ["unbalanced_code_fence", { article: `${goodArticle}\n\n\`\`\`ts\nconst a = 1;` }],
    ["placeholder_text", { article: placeholderArticle }],
    ["edit_too_short", { article: truncatedArticle, draft: goodArticle }],
    ["edit_too_long", { article: `${goodArticle}\n\n${buildArticle(2)}`, draft: goodArticle }],
    ["seo_title_missing", { article: goodArticle, seo: { ...goodSeo, title: " " } }],
    ["seo_title_too_long", { article: goodArticle, seo: { ...goodSeo, title: "x".repeat(61) } }],
    ["seo_meta_missing", { article: goodArticle, seo: { ...goodSeo, metaDescription: "" } }],
    [
      "seo_meta_too_long",
      { article: goodArticle, seo: { ...goodSeo, metaDescription: "x".repeat(156) } }
    ],
    ["seo_slug_invalid", { article: goodArticle, seo: { ...goodSeo, slug: "Not A Slug" } }],
    [
      "repeated_paragraph",
      {
        article: `${goodArticle}\n\nThis paragraph is long enough to count as one.\n\nThis paragraph is long enough to count as one.`
      }
    ]
  ];

  it.each(failing)("flags %s", (code, input) => {
    const result = validateArticle(input, {
      minWords: code === "word_count_too_short" ? 1000 : 100
    });
    expect(result.violations.map((v) => v.code)).toContain(code);
    expect(result.passed).toBe(false);
  });

  it("flags a truncated editor output", () => {
    expect(codes({ article: truncatedArticle, draft: goodArticle }, { minWords: 1 })).toContain(
      "edit_too_short"
    );
  });

  it("ignores headings, placeholders and fences inside code blocks", () => {
    const article = `${goodArticle}\n\n\`\`\`md\n# Not a heading\nTODO inside code\n\`\`\``;
    expect(validateArticle({ article })).toEqual({ passed: true, violations: [] });
  });

  it("honors configurable thresholds", () => {
    expect(codes({ article: goodArticle }, { maxWords: 500 })).toContain("word_count_too_long");
    expect(codes({ article: goodArticle }, { minH2: 10 })).toContain("too_few_h2");
    expect(codes({ article: goodArticle }, { forbiddenPatterns: ["caching"] })).toContain(
      "placeholder_text"
    );
    expect(DEFAULT_ARTICLE_RULES.minWords).toBeLessThan(DEFAULT_ARTICLE_RULES.maxWords);
  });

  it("formats violations for a regeneration prompt", () => {
    const { violations } = validateArticle({ article: tooShortArticle });
    expect(formatViolations(violations)).toMatch(/^- \[word_count_too_short\] /);
  });
});
