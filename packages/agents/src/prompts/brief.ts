import type { ArticleBrief } from "@openblog/types";

type BriefField = "audience" | "tone" | "keywords" | "notes";

/** The brief fields an agent should see, as prompt lines; empty when the brief says nothing relevant. */
export function briefLines(
  brief: ArticleBrief | undefined,
  fields: readonly BriefField[]
): string[] {
  if (!brief) {
    return [];
  }

  const lines: string[] = [];
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

/** The `{{brief.*}}` placeholder values of a brief; empty strings for what it does not say. */
export function briefValues(brief: ArticleBrief | undefined): Record<string, string> {
  return {
    "brief.language": brief?.language ?? "",
    "brief.audience": brief?.audience ?? "",
    "brief.tone": brief?.tone ?? "",
    "brief.targetKeyword": brief?.targetKeyword ?? "",
    "brief.secondaryKeywords": brief?.secondaryKeywords?.join(", ") ?? "",
    "brief.notes": brief?.notes ?? "",
    "brief.minWords": brief?.minWords === undefined ? "" : String(brief.minWords),
    "brief.maxWords": brief?.maxWords === undefined ? "" : String(brief.maxWords)
  };
}

/** English name of a language code (`it` -> "Italian"); the code itself when it has no name. */
export function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** `Italian (it)`: how the prompts name the output language. */
function describeLanguage(code: string): string {
  const name = languageName(code);
  return name === code ? code : `${name} (${code})`;
}

/** The output-language instruction; nothing when the caller did not pick a language. */
export function languageLines(brief: ArticleBrief | undefined, instruction: string): string[] {
  return brief?.language
    ? [instruction.replaceAll("{language}", describeLanguage(brief.language))]
    : [];
}
