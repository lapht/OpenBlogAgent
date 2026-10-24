import type { ContentFetcher } from "../types";

import { extractReadableText, htmlToText } from "./extract";

/** What was read from one source page. */
export interface SourceDocument {
  /** The address that was asked for; the article lists this one. */
  url: string;
  /** The address that answered, after redirects. */
  finalUrl: string;
  title?: string;
  /** Readable text, at most `maxChars` long. */
  text: string;
  /** The page had more text than `maxChars`. */
  truncated: boolean;
}

export interface SourceReader {
  read(url: string, options: { maxChars: number; signal?: AbortSignal }): Promise<SourceDocument>;
}

/** Pages with less readable text than this are treated as empty (script-rendered, blocked, redirects). */
export const MIN_SOURCE_CHARS = 200;

export class SourceReadError extends Error {
  readonly code = "source_empty";

  constructor(message: string) {
    super(message);
    this.name = "SourceReadError";
  }
}

/** Cuts at a paragraph, else a sentence, else a word boundary in the last fifth of the budget. */
export function truncateText(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }
  const head = text.slice(0, maxChars);
  const floor = Math.floor(maxChars * 0.8);
  const cut = Math.max(head.lastIndexOf("\n\n"), head.lastIndexOf(". "), head.lastIndexOf(" "));
  return {
    text: `${head.slice(0, cut > floor ? cut + 1 : maxChars).trimEnd()} […]`,
    truncated: true
  };
}

/** Reads source pages through the safe fetcher; nothing else touches the network. */
export function createSourceReader(fetcher: ContentFetcher): SourceReader {
  return {
    async read(url, { maxChars, signal }) {
      const page = await fetcher.fetch({ url, signal });
      const extracted =
        page.contentType === "text/plain"
          ? { text: page.body.trim() }
          : page.contentType === "text/html" || page.contentType === "application/xhtml+xml"
            ? extractReadableText(page.body)
            : { text: htmlToText(page.body) };

      if (extracted.text.length < MIN_SOURCE_CHARS) {
        throw new SourceReadError(
          `${url} has no readable text (${extracted.text.length} characters); it may need scripts to render`
        );
      }
      const { text, truncated } = truncateText(extracted.text, maxChars);
      return {
        url,
        finalUrl: page.finalUrl,
        ...("title" in extracted && extracted.title ? { title: extracted.title } : {}),
        text,
        truncated
      };
    }
  };
}
