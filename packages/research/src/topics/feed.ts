import type { ContentFetcher } from "../types";

import { canonicalizeUrl, toIsoDate, toPlainText } from "./text";
import {
  SourceFormatError,
  type TopicSource,
  type TopicSourceConfig,
  type TopicSourceResult
} from "./types";
import { asArray, parseXml, textOf } from "./xml";

type Entry = TopicSourceResult["entries"][number];

const MAX_SUMMARY_LENGTH = 500;

/** Reads RSS 2.0, RSS 1.0 (RDF) and Atom feeds. */
export class FeedTopicSource implements TopicSource {
  constructor(public readonly config: TopicSourceConfig) {}

  async collect(fetcher: ContentFetcher): Promise<TopicSourceResult> {
    const page = await fetcher.fetch({ url: this.config.url });
    return { entries: parseFeed(page.body, page.finalUrl), warnings: [] };
  }
}

/** Entries of a feed document; throws `SourceFormatError` when it is not a feed. */
export function parseFeed(xml: string, baseUrl: string): Entry[] {
  const document = parseXml(xml);

  const rss = document.rss as Record<string, unknown> | undefined;
  const channel = rss?.channel;
  if (rss && channel) {
    return asArray(asArray(channel)[0]?.item).flatMap((item) => fromRssItem(item, baseUrl));
  }

  const rdf = document["rdf:RDF"] as Record<string, unknown> | undefined;
  if (rdf) {
    return asArray(rdf.item).flatMap((item) => fromRssItem(item, baseUrl));
  }

  const atom = document.feed as Record<string, unknown> | undefined;
  if (atom && typeof atom === "object") {
    return asArray(atom.entry).flatMap((entry) => fromAtomEntry(entry, baseUrl));
  }

  throw new SourceFormatError("The document is not an RSS or Atom feed");
}

function resolve(value: string | undefined, baseUrl: string): string | undefined {
  if (!value) {
    return undefined;
  }
  try {
    return canonicalizeUrl(new URL(value, baseUrl).toString());
  } catch {
    return undefined;
  }
}

function build(
  title: string | undefined,
  url: string | undefined,
  date: unknown,
  summary: string | undefined
): Entry[] {
  const cleanTitle = title ? toPlainText(title) : "";
  if (!cleanTitle || !url) {
    return [];
  }
  const cleanSummary = summary ? toPlainText(summary, MAX_SUMMARY_LENGTH) : "";
  return [
    {
      title: cleanTitle,
      url,
      publishedAt: toIsoDate(date),
      ...(cleanSummary ? { summary: cleanSummary } : {})
    }
  ];
}

function fromRssItem(item: Record<string, unknown>, baseUrl: string): Entry[] {
  const guid = item.guid;
  const guidIsLink =
    typeof guid === "string" ||
    (typeof guid === "object" && guid !== null && !Array.isArray(guid)
      ? (guid as Record<string, unknown>)["@_isPermaLink"] !== "false"
      : false);
  const link = textOf(item.link) ?? (guidIsLink ? textOf(guid) : undefined);
  return build(
    textOf(item.title),
    resolve(link, baseUrl),
    item.pubDate ?? item["dc:date"],
    textOf(item.description) ?? textOf(item["content:encoded"])
  );
}

function fromAtomEntry(entry: Record<string, unknown>, baseUrl: string): Entry[] {
  const links = asArray(entry.link);
  const alternate =
    links.find((link) => link["@_rel"] === "alternate") ??
    links.find((link) => link["@_rel"] === undefined);
  return build(
    textOf(entry.title),
    resolve(alternate ? (alternate["@_href"] as string | undefined) : undefined, baseUrl),
    entry.published ?? entry.updated,
    textOf(entry.summary) ?? textOf(entry.content)
  );
}
