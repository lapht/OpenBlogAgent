const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  ndash: "–",
  mdash: "—",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“"
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code =
        entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** Plain text from a title or description that may carry markup or HTML entities. */
export function toPlainText(value: string, maxLength?: number): string {
  const withoutTags = value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ");
  const text = decodeEntities(withoutTags).replace(/\s+/g, " ").trim();
  return maxLength && text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
}

/** An ISO 8601 timestamp for a feed or sitemap date, or undefined when it cannot be read. */
export function toIsoDate(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  const time = Date.parse(value.trim());
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

const TRACKING_PARAMETERS = /^(utm_.+|fbclid|gclid|mc_cid|mc_eid|igshid|ref|ref_src)$/i;

/**
 * The URL in a stable form: lowercase scheme and host, no fragment, no default port, no tracking
 * parameters, sorted query, no trailing slash. Returns undefined for anything but http(s).
 */
export function canonicalizeUrl(value: string): string | undefined {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return undefined;
  }
  url.hash = "";
  url.username = "";
  url.password = "";
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMETERS.test(key)) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
  const query = url.search;
  return `${url.protocol}//${url.host}${path === "/" && !query ? "" : path}${query}`;
}

/** The identity of a URL for dedup: canonical, with `http`/`https` and a leading `www.` ignored. */
export function urlKey(value: string): string | undefined {
  const canonical = canonicalizeUrl(value);
  return canonical?.replace(/^https?:\/\/(www\.)?/i, "");
}
