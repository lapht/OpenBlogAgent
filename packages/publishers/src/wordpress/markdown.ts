import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [...sanitizeHtml.defaults.allowedTags, "img", "h1", "h2", "del"],
  allowedAttributes: {
    a: ["href", "title"],
    img: ["src", "alt", "title"],
    code: ["class"]
  },
  allowedSchemes: ["http", "https", "mailto"]
};

/** WordPress expects HTML, so Markdown is rendered and sanitized (scripts, handlers, `javascript:` links). */
export function markdownToSafeHtml(markdown: string): string {
  const html = marked.parse(markdown, { async: false, gfm: true });
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}
