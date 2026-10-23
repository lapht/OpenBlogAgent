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

  describe("target keyword", () => {
    const keywordCodes = (input: ArticleValidationInput, rules = {}, keyword = "caching") =>
      codes({ ...input, keyword }, { minWords: 1, ...rules }).filter((code) =>
        code.startsWith("keyword_")
      );
    // The fixture repeats its section names in every sentence: "caching" is about 1.4% of it.
    const optimized = goodArticle;
    const seo = { ...goodSeo, metaDescription: "Caching explained: how to cache well." };

    it("adds no violations without a keyword", () => {
      expect(codes({ article: goodArticle, seo: goodSeo }, { minWords: 1 })).toEqual([]);
      expect(codes({ article: goodArticle, seo: goodSeo, keyword: "  " }, { minWords: 1 })).toEqual(
        []
      );
    });

    it("passes an article that targets the keyword everywhere", () => {
      expect(keywordCodes({ article: optimized, seo })).toEqual([]);
    });

    it("flags a keyword missing from the title, the meta description, the H2 headings and the introduction", () => {
      const article = optimized
        .replace("Caching is one of", "A cache is one of")
        .replace("## Why caching matters", "## Why speed matters");
      expect(
        keywordCodes({
          article,
          seo: { ...seo, title: "Fast services", metaDescription: "How to cache well." }
        })
      ).toEqual(
        expect.arrayContaining([
          "keyword_missing_in_title",
          "keyword_missing_in_meta",
          "keyword_missing_in_h2",
          "keyword_missing_in_intro"
        ])
      );
    });

    it("flags a keyword that is barely used and one that is stuffed", () => {
      expect(keywordCodes({ article: goodArticle, seo }, {}, "conclusion")).toContain(
        "keyword_density_low"
      );
      expect(keywordCodes({ article: `${optimized}\n\n${"caching ".repeat(60)}`, seo })).toEqual([
        "keyword_density_high"
      ]);
    });

    it("honors the configured density range", () => {
      expect(
        keywordCodes({ article: goodArticle, seo }, { minKeywordDensity: 0 }, "conclusion")
      ).not.toContain("keyword_density_low");
      expect(keywordCodes({ article: optimized, seo }, { maxKeywordDensity: 0.005 })).toEqual([
        "keyword_density_high"
      ]);
    });

    it("matches whole words, ignoring case and diacritics", () => {
      const article = "Il caffè è importante.\n\n## Perché il CAFFE conta\n\nIl caffe è buono.";
      const accented = {
        title: "Guida al Caffè",
        metaDescription: "Tutto sul caffe.",
        slug: "caffe"
      };
      const loose = { minKeywordDensity: 0, maxKeywordDensity: 1 };
      expect(
        codes({ article, seo: accented, keyword: "caffe" }, { minWords: 1, minH2: 0, ...loose })
      ).toEqual([]);
      expect(
        codes(
          { article: "Il caffeina.\n\n## Caffeinato", keyword: "caffe" },
          { minWords: 1, minH2: 0, ...loose }
        )
      ).toEqual(expect.arrayContaining(["keyword_missing_in_h2", "keyword_missing_in_intro"]));
    });

    it("counts a multi-word keyword once per phrase", () => {
      const article = "Web caching basics.\n\n## Why web caching matters\n\nWeb caching helps.";
      const input = {
        article,
        keyword: "Web Caching",
        seo: { title: "Web caching", metaDescription: "Web caching", slug: "a" }
      };
      expect(codes(input, { minWords: 1, minH2: 0, maxKeywordDensity: 1 })).toEqual([]);
      expect(codes(input, { minWords: 1, minH2: 0, maxKeywordDensity: 0.5 })).toEqual([
        "keyword_density_high"
      ]);
    });
  });

  it("formats violations for a regeneration prompt", () => {
    const { violations } = validateArticle({ article: tooShortArticle });
    expect(formatViolations(violations)).toMatch(/^- \[word_count_too_short\] /);
  });
  describe("language-specific phrase rules", () => {
    const withPhrase = (phrase: string) => `${goodArticle}\n\n${phrase}`;
    const english = "As a large language model, I cannot browse the web.";
    const italian = "Come modello linguistico, non posso navigare sul web.";

    it("flags English phrases in English articles, by default and by language code", () => {
      expect(codes({ article: withPhrase(english) })).toContain("placeholder_text");
      expect(codes({ article: withPhrase(english), language: "en" })).toContain("placeholder_text");
      expect(codes({ article: withPhrase(english), language: "en-GB" })).toContain(
        "placeholder_text"
      );
    });

    it("flags Italian phrases in Italian articles", () => {
      expect(codes({ article: withPhrase(italian), language: "it" })).toContain("placeholder_text");
      expect(
        codes({ article: withPhrase("[inserisci il titolo qui]"), language: "it-IT" })
      ).toContain("placeholder_text");
    });

    it("does not apply English phrase rules to an Italian article", () => {
      expect(codes({ article: withPhrase(english), language: "it" })).not.toContain(
        "placeholder_text"
      );
    });

    it("does not apply Italian phrase rules to an English article", () => {
      expect(codes({ article: withPhrase(italian), language: "en" })).not.toContain(
        "placeholder_text"
      );
    });

    it("keeps the language-neutral rules for every language", () => {
      for (const language of ["en", "it", "ja"]) {
        expect(codes({ article: withPhrase("TODO scrivere"), language })).toContain(
          "placeholder_text"
        );
        expect(codes({ article: withPhrase("Lorem ipsum dolor"), language })).toContain(
          "placeholder_text"
        );
      }
    });

    it("keeps the other rules for non-English articles", () => {
      expect(codes({ article: tooShortArticle, language: "it" })).toContain("word_count_too_short");
      expect(codes({ article: `# Titolo\n\n${goodArticle}`, language: "it" })).toContain(
        "h1_present"
      );
    });

    it("matches outline items to headings with accents and non-Latin scripts", () => {
      const outline = ["Perché la cache è importante", "Стратегии кэширования", "キャッシュの戦略"];
      const article = `${goodArticle}\n\n## Perché la cache è importante\n\nTesto.\n\n## Стратегии кэширования\n\nТекст.\n\n## キャッシュの戦略\n\nテキスト。`;
      const result = validateArticle(
        { article, outline },
        { minWords: 1, maxWords: 100000, minOutlineCoverage: 1 }
      );
      expect(result.violations.map((violation) => violation.code)).not.toContain(
        "outline_coverage_low"
      );
    });
  });
});
