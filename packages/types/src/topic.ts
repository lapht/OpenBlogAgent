/**
 * The form in which topics and titles are compared: trimmed, lowercase, single spaces. Duplicate
 * detection of runs and the dedup of research candidates use this one definition.
 */
export function normalizeTopic(topic: string): string {
  return topic.trim().toLowerCase().replace(/\s+/g, " ");
}
