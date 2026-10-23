import type { ArticleBrief } from "@openblog/types";

type BriefField = "language" | "audience" | "tone" | "keywords" | "notes";

/** The brief fields an agent should see, as prompt lines; empty when the brief says nothing relevant. */
export function briefLines(
  brief: ArticleBrief | undefined,
  fields: readonly BriefField[]
): string[] {
  if (!brief) {
    return [];
  }

  const lines: string[] = [];
  if (fields.includes("language") && brief.language) {
    lines.push(`- Language: ${brief.language}`);
  }
  if (fields.includes("audience") && brief.audience) {
    lines.push(`- Audience: ${brief.audience}`);
  }
  if (fields.includes("tone") && brief.tone) {
    lines.push(`- Tone: ${brief.tone}`);
  }
  if (fields.includes("keywords") && brief.targetKeyword) {
    lines.push(`- Target keyword: ${brief.targetKeyword}`);
  }
  if (fields.includes("keywords") && brief.secondaryKeywords?.length) {
    lines.push(`- Secondary keywords: ${brief.secondaryKeywords.join(", ")}`);
  }
  if (fields.includes("notes") && brief.notes) {
    lines.push(`- Editorial notes: ${brief.notes}`);
  }

  return lines.length > 0 ? ["", "Brief:", ...lines, ""] : [];
}
