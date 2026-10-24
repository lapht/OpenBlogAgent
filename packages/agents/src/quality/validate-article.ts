import { primaryLanguage } from "@openblog/types";

export type ViolationSeverity = "error" | "warning";

export type ViolationCode =
  | "word_count_too_short"
  | "word_count_too_long"
  | "h1_present"
  | "too_few_h2"
  | "outline_coverage_low"
  | "unbalanced_code_fence"
  | "placeholder_text"
  | "edit_too_short"
  | "edit_too_long"
  | "seo_title_missing"
  | "seo_title_too_long"
  | "seo_meta_missing"
  | "seo_meta_too_long"
  | "seo_slug_invalid"
  | "repeated_paragraph"
  | "keyword_missing_in_title"
  | "keyword_missing_in_meta"
  | "keyword_missing_in_h2"
  | "keyword_missing_in_intro"
  | "keyword_density_low"
  | "keyword_density_high"
  | "references_missing"
  | "reference_not_provided"
  | "internal_link_not_offered";

export interface ArticleViolation {
  code: ViolationCode;
  severity: ViolationSeverity;
  /** Human readable; also fed back to the model when regenerating. */
  message: string;
}

export interface ArticleValidationResult {
  /** True when there is no violation with severity `error`. */
  passed: boolean;
  violations: ArticleViolation[];
}

export interface ArticleValidationRules {
  minWords: number;
  maxWords: number;
  minH2: number;
  /** Fraction (0..1) of outline items that must match an H2 heading. */
  minOutlineCoverage: number;
  /** Minimum edited/draft word ratio; below it the edit looks truncated. */
  minEditRatio: number;
  /** Maximum edited/draft word ratio; above it the edit looks padded. */
  maxEditRatio: number;
  maxTitleLength: number;
  maxMetaDescriptionLength: number;
  /** Paragraphs shorter than this many words are ignored by the repetition check. */
  minRepeatedParagraphWords: number;
  /** Case-insensitive patterns (regular expression sources) that flag leftover text. */
  forbiddenPatterns: string[];
  /** Target keyword words as a fraction (0..1) of the article's words; below it the keyword is barely used. */
  minKeywordDensity: number;
  /** Above this fraction the keyword looks stuffed. */
  maxKeywordDensity: number;
}

/** Leftovers that look the same in every language. */
export const DEFAULT_PLACEHOLDER_PATTERNS: readonly string[] = [
  String.raw`\[\s*(?:\.{3}|…)\s*\]`,
  String.raw`\b(?:TODO|TBD|FIXME)\b`,
  String.raw`lorem ipsum`
];

/**
 * Placeholder and AI-disclaimer phrases that only make sense in one language, keyed by primary
 * language code. They apply to articles in that language only: an English phrase must not flag
 * an Italian article, and the other way round.
 */
export const LANGUAGE_PLACEHOLDER_PATTERNS: Readonly<Record<string, readonly string[]>> = {
  en: [
    String.raw`\[(?:insert|your|todo|tbd|placeholder)[^\]]*\]`,
    String.raw`\bas an ai\b`,
    String.raw`\bas a (?:large )?language model\b`,
    String.raw`\bi (?:cannot|can't|am unable to) (?:browse|access|provide)\b`
  ],
  it: [
    String.raw`\[(?:inserisci|inserire|il tuo|la tua|da completare|segnaposto)[^\]]*\]`,
    String.raw`\bcome (?:un'|una )?(?:ia|intelligenza artificiale)\b`,
    String.raw`\bcome (?:un )?modello (?:linguistico|di linguaggio)\b`,
    String.raw`\bnon (?:posso|sono in grado di) (?:navigare|accedere|fornire)\b`
  ]
};

export const DEFAULT_ARTICLE_RULES: ArticleValidationRules = {
  minWords: 1000,
  maxWords: 2200,
  minH2: 3,
  minOutlineCoverage: 0.6,
  minEditRatio: 0.7,
  maxEditRatio: 1.3,
  maxTitleLength: 60,
  maxMetaDescriptionLength: 155,
  minRepeatedParagraphWords: 8,
  forbiddenPatterns: [...DEFAULT_PLACEHOLDER_PATTERNS],
  minKeywordDensity: 0.005,
  maxKeywordDensity: 0.03
};

export interface ArticleValidationInput {
  /** The final article body (Markdown), after the editor. */
  article: string;
  /** The writer's draft; enables the editor length-ratio rule. */
  draft?: string;
  /** Planner outline; enables the outline coverage rule. */
  outline?: string[];
  /** SEO metadata; enables the title/meta/slug rules. */
  seo?: { title: string; metaDescription: string; slug: string };
  /** Target keyword (or phrase); enables the keyword rules. Matching ignores case and diacritics. */
  keyword?: string;
  /** Language of the article (`en`, `it`, `pt-BR`...); language-specific phrase rules follow it. Defaults to `en`. */
  language?: string;
  /**
   * The URLs the article was grounded in; enables the reference rules: the article must link to at
   * least one of them and to no other address.
   */
  sources?: string[];
  /**
   * Articles of the same site the writer was allowed to link to. A link to the site (an address on
   * one of `origins`, which also includes the offered links' own) that is not among `urls` is
   * invented.
   */
  internalLinks?: { urls: string[]; origins?: string[] };
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FENCE_PATTERN = /^\s*(```|~~~)/;

/**
 * Pure, deterministic validation of a generated article: no I/O, no LLM calls.
 * Rules whose input is absent are skipped.
 */
export function validateArticle(
  input: ArticleValidationInput,
  rules: Partial<ArticleValidationRules> = {}
): ArticleValidationResult {
  const config: ArticleValidationRules = { ...DEFAULT_ARTICLE_RULES, ...rules };
  const violations: ArticleViolation[] = [];
  const add = (code: ViolationCode, message: string, severity: ViolationSeverity = "error") =>
    violations.push({ code, severity, message });

  const { prose, headings, fencesBalanced } = analyze(input.article);
  const words = countWords(input.article);

  if (words < config.minWords) {
    add(
      "word_count_too_short",
      `The article has ${words} words; it must have at least ${config.minWords}.`
    );
  } else if (words > config.maxWords) {
    add(
      "word_count_too_long",
      `The article has ${words} words; it must have at most ${config.maxWords}.`
    );
  }

  if (headings.some((heading) => heading.level === 1)) {
    add("h1_present", "The article must not contain an H1 heading; start with the introduction.");
  }

  const h2 = headings.filter((heading) => heading.level === 2);
  if (h2.length < config.minH2) {
    add(
      "too_few_h2",
      `The article has ${h2.length} H2 sections; it needs at least ${config.minH2}.`
    );
  }

  if (input.outline && input.outline.length > 0) {
    const missing = input.outline.filter(
      (item) => !h2.some((heading) => headingMatches(heading.text, item))
    );
    const coverage = (input.outline.length - missing.length) / input.outline.length;
    if (coverage < config.minOutlineCoverage) {
      add(
        "outline_coverage_low",
        `Only ${Math.round(coverage * 100)}% of the outline is covered by H2 sections; missing: ${missing.join("; ")}.`
      );
    }
  }

  if (!fencesBalanced) {
    add("unbalanced_code_fence", "A Markdown code fence is opened but never closed.");
  }

  const placeholder = findForbidden(prose, [
    ...config.forbiddenPatterns,
    ...(LANGUAGE_PLACEHOLDER_PATTERNS[primaryLanguage(input.language ?? "en")] ?? [])
  ]);
  if (placeholder) {
    add(
      "placeholder_text",
      `The article contains placeholder or AI-disclaimer text: "${placeholder}".`
    );
  }

  if (input.draft !== undefined) {
    const draftWords = countWords(input.draft);
    if (draftWords > 0) {
      const ratio = words / draftWords;
      if (ratio < config.minEditRatio) {
        add(
          "edit_too_short",
          `The edited text has ${words} words against ${draftWords} in the draft; it looks truncated or summarized.`
        );
      } else if (ratio > config.maxEditRatio) {
        add(
          "edit_too_long",
          `The edited text has ${words} words against ${draftWords} in the draft; the edit should not add that much.`
        );
      }
    }
  }

  if (input.seo) {
    const title = input.seo.title.trim();
    const meta = input.seo.metaDescription.trim();
    if (title.length === 0) {
      add("seo_title_missing", "The SEO title is empty.");
    } else if (title.length > config.maxTitleLength) {
      add(
        "seo_title_too_long",
        `The SEO title has ${title.length} characters; the maximum is ${config.maxTitleLength}.`
      );
    }
    if (meta.length === 0) {
      add("seo_meta_missing", "The meta description is empty.");
    } else if (meta.length > config.maxMetaDescriptionLength) {
      add(
        "seo_meta_too_long",
        `The meta description has ${meta.length} characters; the maximum is ${config.maxMetaDescriptionLength}.`
      );
    }
    if (!SLUG_PATTERN.test(input.seo.slug)) {
      add("seo_slug_invalid", "The slug must be lowercase letters, digits and single hyphens.");
    }
  }

  const keyword = input.keyword ? normalizedTokens(input.keyword) : [];
  if (keyword.length > 0) {
    const label = `"${input.keyword!.trim()}"`;
    if (input.seo) {
      if (countPhrase(input.seo.title, keyword) === 0) {
        add("keyword_missing_in_title", `The SEO title does not contain the keyword ${label}.`);
      }
      if (countPhrase(input.seo.metaDescription, keyword) === 0) {
        add(
          "keyword_missing_in_meta",
          `The meta description does not contain the keyword ${label}.`
        );
      }
    }
    if (!h2.some((heading) => countPhrase(heading.text, keyword) > 0)) {
      add("keyword_missing_in_h2", `No H2 heading contains the keyword ${label}.`);
    }
    if (countPhrase(introduction(prose), keyword) === 0) {
      add("keyword_missing_in_intro", `The introduction does not contain the keyword ${label}.`);
    }

    const density = (countPhrase(prose, keyword) * keyword.length) / Math.max(words, 1);
    if (density < config.minKeywordDensity) {
      add(
        "keyword_density_low",
        `The keyword ${label} makes up ${formatPercent(density)} of the article; use it naturally to reach at least ${formatPercent(config.minKeywordDensity)}.`
      );
    } else if (density > config.maxKeywordDensity) {
      add(
        "keyword_density_high",
        `The keyword ${label} makes up ${formatPercent(density)} of the article; it looks stuffed, keep it under ${formatPercent(config.maxKeywordDensity)}.`
      );
    }
  }

  if (input.sources && input.sources.length > 0) {
    const allowed = new Set(
      [...input.sources, ...(input.internalLinks?.urls ?? [])].map(urlIdentity)
    );
    const linked = [...new Set(extractUrls(prose))];
    const invented = linked.filter((url) => !allowed.has(urlIdentity(url)));
    if (!linked.some((url) => input.sources!.map(urlIdentity).includes(urlIdentity(url)))) {
      add(
        "references_missing",
        `The article does not link to any of its sources; list the ones you used in a references section: ${input.sources.join(", ")}.`
      );
    }
    if (invented.length > 0) {
      add(
        "reference_not_provided",
        `The article links to addresses that are not among its sources: ${invented.slice(0, 3).join(", ")}. Link only to ${input.sources.join(", ")}.`
      );
    }
  }

  if (input.internalLinks) {
    const offered = new Set(input.internalLinks.urls.map(urlIdentity));
    const origins = new Set(
      [...input.internalLinks.urls, ...(input.internalLinks.origins ?? [])].map(originOf)
    );
    const allowedSources = new Set((input.sources ?? []).map(urlIdentity));
    const invented = [...new Set(extractUrls(prose))].filter(
      (url) =>
        origins.has(originOf(url)) &&
        !offered.has(urlIdentity(url)) &&
        !allowedSources.has(urlIdentity(url))
    );
    if (invented.length > 0) {
      add(
        "internal_link_not_offered",
        `The article links to pages of its own site that were not offered: ${invented.slice(0, 3).join(", ")}. ${
          input.internalLinks.urls.length > 0
            ? `Link only to ${input.internalLinks.urls.join(", ")}.`
            : "Remove those links."
        }`
      );
    }
  }

  const repeated = findRepeatedParagraph(prose, config.minRepeatedParagraphWords);
  if (repeated) {
    add("repeated_paragraph", `A paragraph is repeated: "${repeated}".`);
  }

  return { passed: !violations.some((v) => v.severity === "error"), violations };
}

/** Renders violations as a bullet list to put in a regeneration prompt. */
export function formatViolations(violations: readonly { code: string; message: string }[]): string {
  return violations.map((v) => `- [${v.code}] ${v.message}`).join("\n");
}

interface Heading {
  level: number;
  text: string;
}

/** Splits the article into prose (code blocks removed) and headings, tracking fence balance. */
function analyze(markdown: string): {
  prose: string;
  headings: Heading[];
  fencesBalanced: boolean;
} {
  const proseLines: string[] = [];
  const headings: Heading[] = [];
  let fence: string | undefined;

  for (const line of markdown.split(/\r?\n/)) {
    const marker = FENCE_PATTERN.exec(line)?.[1];
    if (marker) {
      if (fence === undefined) {
        fence = marker;
      } else if (fence === marker) {
        fence = undefined;
      }
      continue;
    }
    if (fence !== undefined) continue;

    proseLines.push(line);
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      headings.push({ level: heading[1]!.length, text: heading[2]! });
    }
  }

  return { prose: proseLines.join("\n"), headings, fencesBalanced: fence === undefined };
}

/** http(s) addresses in the text, without the punctuation that ends a sentence or a link. */
function extractUrls(text: string): string[] {
  return (text.match(/https?:\/\/[^\s<>"'`\])]+/gi) ?? []).map((url) =>
    url.replace(/[.,;:!?]+$/, "")
  );
}

/** `https://host:port` of an address, lowercase and without a leading `www.`; the text itself when it is not an address. */
function originOf(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol === "http:" ? "https:" : url.protocol}//${url.host.replace(/^www\./i, "").toLowerCase()}`;
  } catch {
    return value;
  }
}

/** Two addresses of the same page compare equal: scheme, `www.`, fragment, tracking and trailing slash ignored. */
export function urlIdentity(value: string): string {
  try {
    const url = new URL(value);
    const query = [...url.searchParams.entries()]
      .filter(([key]) => !/^utm_/i.test(key))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => `${key}=${val}`)
      .join("&");
    const path = url.pathname.replace(/\/+$/, "");
    return `${url.hostname.replace(/^www\./i, "").toLowerCase()}${path}${query ? `?${query}` : ""}`;
  } catch {
    return value;
  }
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function normalizedTokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

function tokens(text: string): string[] {
  return normalizedTokens(text).filter((token) => token.length > 2);
}

/** How many times the word sequence `phrase` occurs in `text`, whole words only. */
function countPhrase(text: string, phrase: readonly string[]): number {
  const words = normalizedTokens(text);
  let count = 0;
  for (let start = 0; start + phrase.length <= words.length; start += 1) {
    if (phrase.every((word, offset) => words[start + offset] === word)) {
      count += 1;
      start += phrase.length - 1;
    }
  }
  return count;
}

/** The prose before the first H2 heading (all of it when there is none), headings left out. */
function introduction(prose: string): string {
  const lines: string[] = [];
  for (const line of prose.split(/\r?\n/)) {
    if (/^#{2}\s/.test(line)) break;
    if (!/^#{1,6}\s/.test(line)) lines.push(line);
  }
  return lines.join("\n");
}

function formatPercent(fraction: number): string {
  return `${Number((fraction * 100).toFixed(2))}%`;
}

/** A heading covers an outline item when it shares at least half of the item's significant words. */
function headingMatches(heading: string, outlineItem: string): boolean {
  const wanted = tokens(outlineItem);
  if (wanted.length === 0) return true;
  const have = new Set(tokens(heading));
  return wanted.filter((token) => have.has(token)).length / wanted.length >= 0.5;
}

function findForbidden(prose: string, patterns: readonly string[]): string | undefined {
  for (const source of patterns) {
    const match = new RegExp(source, "i").exec(prose);
    if (match) return match[0];
  }
  return undefined;
}

function findRepeatedParagraph(prose: string, minWords: number): string | undefined {
  const seen = new Set<string>();
  for (const paragraph of prose.split(/\n\s*\n/)) {
    const text = paragraph.trim();
    if (text.startsWith("#") || countWords(text) < minWords) continue;
    const key = text.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) return text.length > 60 ? `${text.slice(0, 57)}...` : text;
    seen.add(key);
  }
  return undefined;
}
