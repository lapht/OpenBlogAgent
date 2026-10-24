/**
 * The form in which topics and titles are compared: trimmed, lowercase, single spaces. Duplicate
 * detection of runs and the dedup of research candidates use this one definition.
 */
export function normalizeTopic(topic: string): string {
  return topic.trim().toLowerCase().replace(/\s+/g, " ");
}

const STOPWORDS = new Set(
  (
    "the and for with from that this these those your you our are was were will can how what why when " +
    "who which into over about than then also not but all any more most per via vs " +
    "il lo la le gli un una uno dei del della delle degli per con come che cosa perche nel nella " +
    "sono non piu"
  ).split(" ")
);

/** The significant words of a title: lowercase letters and digits, no short or filler words. */
export function titleTokens(title: string): Set<string> {
  const tokens = normalizeTopic(title)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
  return new Set(tokens);
}
