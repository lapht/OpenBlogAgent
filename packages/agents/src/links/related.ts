import { titleTokens } from "@openblog/types";

/** An article already published on the target, as far as linking to it needs. */
export interface PublishedArticle {
  workflowId: string;
  title: string;
  slug: string | null;
  category: string | null;
  tags: string[];
  /** Public address of the post. */
  url: string;
}

/** An article the writer may link to. */
export interface InternalLink {
  workflowId: string;
  title: string;
  url: string;
}

export interface RelatedQuery {
  topic: string;
  targetKeyword?: string;
  secondaryKeywords?: string[];
  outline?: string[];
}

const TITLE_POINTS = 3;
const TAG_POINTS = 2;
const SLUG_POINTS = 1;
const CATEGORY_POINTS = 1;
/** A title or tag word in common is the least that makes two articles related. */
const MIN_SCORE = 2;

const shared = (query: Set<string>, tokens: Set<string>): number => {
  let count = 0;
  for (const token of tokens) {
    if (query.has(token)) count += 1;
  }
  return count;
};

/**
 * The published articles most related to what is about to be written, from word overlap alone:
 * the topic, keywords and outline against each article's title (3 points per shared word), tags
 * (2), slug (1) and category (1). Deterministic; ties keep the order given (newest first). An
 * article needs at least a title or tag word in common to be offered.
 */
export function selectRelatedArticles(
  query: RelatedQuery,
  articles: readonly PublishedArticle[],
  max: number
): InternalLink[] {
  if (max <= 0) {
    return [];
  }
  const words = new Set<string>();
  for (const text of [
    query.topic,
    query.targetKeyword ?? "",
    ...(query.secondaryKeywords ?? []),
    ...(query.outline ?? [])
  ]) {
    for (const token of titleTokens(text)) words.add(token);
  }

  return articles
    .map((article, index) => {
      const titleHits = shared(words, titleTokens(article.title));
      const tagHits = shared(words, titleTokens(article.tags.join(" ")));
      const score =
        TITLE_POINTS * titleHits +
        TAG_POINTS * tagHits +
        SLUG_POINTS * shared(words, titleTokens((article.slug ?? "").replaceAll("-", " "))) +
        CATEGORY_POINTS * shared(words, titleTokens(article.category ?? ""));
      return { article, score, index, related: titleHits + tagHits > 0 };
    })
    .filter((entry) => entry.related && entry.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, max)
    .map(({ article }) => ({
      workflowId: article.workflowId,
      title: article.title,
      url: article.url
    }));
}
