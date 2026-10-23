import type { ContentFetcher } from "../types";

import { canonicalizeUrl, toIsoDate } from "./text";
import {
  SourceFormatError,
  type TopicSource,
  type TopicSourceConfig,
  type TopicSourceResult
} from "./types";
import { asArray, parseXml, textOf } from "./xml";

type Entry = TopicSourceResult["entries"][number];

/** Nesting of sitemap documents followed: an index, an index of indexes, then the sitemaps. */
export const MAX_SITEMAP_DEPTH = 3;
/** Child sitemaps read per source. */
export const MAX_CHILD_SITEMAPS = 20;
/** Entries kept per source. */
export const MAX_SITEMAP_ENTRIES = 1000;

const sameSite = (a: string, b: string): boolean =>
  new URL(a).hostname.replace(/^www\./i, "").toLowerCase() ===
  new URL(b).hostname.replace(/^www\./i, "").toLowerCase();

/** A readable title from the last path segment (`/blog/how-to-cache.html` -> `How to cache`). */
export function titleFromUrl(url: string): string | undefined {
  const segments = new URL(url).pathname.split("/").filter(Boolean);
  const last = segments[segments.length - 1];
  if (!last) {
    return undefined;
  }
  let decoded = last;
  try {
    decoded = decodeURIComponent(last);
  } catch {
    // keep the raw segment
  }
  const words = decoded
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[-_+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!words || /^\d+$/.test(words)) {
    return undefined;
  }
  return words[0].toUpperCase() + words.slice(1);
}

/** Reads an XML sitemap or a sitemap index (bounded depth, width and size). */
export class SitemapTopicSource implements TopicSource {
  constructor(public readonly config: TopicSourceConfig) {}

  async collect(fetcher: ContentFetcher): Promise<TopicSourceResult> {
    const entries: Entry[] = [];
    const warnings: string[] = [];
    let childSitemaps = 0;

    const read = async (url: string, depth: number): Promise<void> => {
      const page = await fetcher.fetch({ url });
      const document = parseXml(page.body);

      const urlset = document.urlset as Record<string, unknown> | undefined;
      if (urlset && typeof urlset === "object") {
        for (const node of asArray(urlset.url)) {
          if (entries.length >= MAX_SITEMAP_ENTRIES) {
            warnings.push(`Stopped at ${MAX_SITEMAP_ENTRIES} entries`);
            return;
          }
          const location = canonicalizeUrl(textOf(node.loc) ?? "");
          const title = location ? titleFromUrl(location) : undefined;
          if (location && title) {
            entries.push({ title, url: location, publishedAt: toIsoDate(textOf(node.lastmod)) });
          }
        }
        return;
      }

      const index = document.sitemapindex as Record<string, unknown> | undefined;
      if (index && typeof index === "object") {
        if (depth >= MAX_SITEMAP_DEPTH) {
          warnings.push(`Sitemap index below ${MAX_SITEMAP_DEPTH} levels was skipped`);
          return;
        }
        for (const node of asArray(index.sitemap)) {
          const location = canonicalizeUrl(textOf(node.loc) ?? "");
          if (!location) {
            continue;
          }
          if (!sameSite(location, this.config.url)) {
            warnings.push(`Skipped ${location}: different site than the index`);
            continue;
          }
          if (childSitemaps >= MAX_CHILD_SITEMAPS) {
            warnings.push(`Stopped after ${MAX_CHILD_SITEMAPS} child sitemaps`);
            return;
          }
          childSitemaps += 1;
          try {
            await read(location, depth + 1);
          } catch (error) {
            // One broken child does not discard the others.
            warnings.push(`${location}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        return;
      }

      throw new SourceFormatError("The document is not an XML sitemap or sitemap index");
    };

    await read(this.config.url, 1);
    return { entries, warnings };
  }
}
