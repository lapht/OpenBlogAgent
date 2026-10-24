import { decodeEntities } from "../topics/text";

export interface ExtractedPage {
  title?: string;
  /** The page's own `rel=canonical` address, when it names an http(s) one. Informational only. */
  canonicalUrl?: string;
  /** Readable text: paragraphs separated by blank lines, headings as `## `, list items as `- `. */
  text: string;
}

const NOISE_BLOCKS = [
  "script",
  "style",
  "noscript",
  "svg",
  "template",
  "iframe",
  "form",
  "nav",
  "header",
  "footer",
  "aside",
  "button",
  "select",
  "dialog",
  "head",
  "title"
];

const stripBlocks = (html: string, tags: readonly string[]): string =>
  tags.reduce(
    (current, tag) =>
      current.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}\\s*>`, "gi"), " "),
    html
  );

const attribute = (tag: string, name: string): string | undefined =>
  new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i")
    .exec(tag)
    ?.slice(1)
    .find(Boolean);

function metaContent(html: string, key: string): string | undefined {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const name = (attribute(tag, "property") ?? attribute(tag, "name"))?.toLowerCase();
    if (name === key) {
      return attribute(tag, "content");
    }
  }
  return undefined;
}

function canonicalOf(html: string): string | undefined {
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (attribute(tag, "rel")?.toLowerCase().split(/\s+/).includes("canonical")) {
      const href = attribute(tag, "href");
      return href && /^https?:\/\//i.test(href) ? decodeEntities(href) : undefined;
    }
  }
  return undefined;
}

const textLength = (html: string): number => html.replace(/<[^>]*>/g, "").trim().length;

/** The main content: the longest `<article>`, else `<main>`, else `<body>`, else everything. */
function mainContent(html: string): string {
  const articles = html.match(/<article\b[^>]*>[\s\S]*?<\/article\s*>/gi) ?? [];
  if (articles.length > 0) {
    return articles.reduce((best, next) => (textLength(next) > textLength(best) ? next : best));
  }
  return (
    /<main\b[^>]*>([\s\S]*?)<\/main\s*>/i.exec(html)?.[1] ??
    /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(html)?.[1] ??
    html
  );
}

/** Tags to text with the structure a reader needs: paragraphs, headings and list items. */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<h[1-6]\b[^>]*>/gi, "\n\n## ")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(
      /<\/(?:p|div|section|article|h[1-6]|li|ul|ol|tr|table|blockquote|pre|figure)\s*>/gi,
      "\n\n"
    )
    .replace(/<[^>]*>/g, " ");
  return decodeEntities(text)
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Title, canonical address and readable main text of an HTML page (no dependency, no scripts run). */
export function extractReadableText(html: string): ExtractedPage {
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, " ");
  const title =
    metaContent(withoutComments, "og:title") ??
    /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(withoutComments)?.[1] ??
    /<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i.exec(withoutComments)?.[1];
  const canonicalUrl = canonicalOf(withoutComments);

  const body = mainContent(stripBlocks(withoutComments, NOISE_BLOCKS));
  const cleanTitle = title ? htmlToText(title).replace(/\s+/g, " ") : undefined;
  return {
    ...(cleanTitle ? { title: cleanTitle } : {}),
    ...(canonicalUrl ? { canonicalUrl } : {}),
    text: htmlToText(body)
  };
}
