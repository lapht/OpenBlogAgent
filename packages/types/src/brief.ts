import { z } from "zod";

const text = (max: number) => z.string().trim().min(1).max(max);

/** Fields of a brief; the workflow input extends this shape with its own run options. */
export const articleBriefShape = {
  topic: text(500),
  /** Language code of the article (BCP-47-ish, e.g. `en`, `it`). */
  language: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/, "language must be a code such as en or pt-BR")
    .optional(),
  audience: text(300).optional(),
  tone: text(200).optional(),
  targetKeyword: text(100).optional(),
  secondaryKeywords: z.array(text(100)).max(20).optional(),
  minWords: z.number().int().positive().max(20000).optional(),
  maxWords: z.number().int().positive().max(20000).optional(),
  notes: text(2000).optional()
};

/** Adds an issue when the word range is inverted; shared by every schema that carries the fields. */
export function checkBriefWordRange(
  brief: { minWords?: number; maxWords?: number },
  ctx: z.RefinementCtx
): void {
  if (
    brief.minWords !== undefined &&
    brief.maxWords !== undefined &&
    brief.minWords > brief.maxWords
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["minWords"],
      message: "minWords must not be greater than maxWords"
    });
  }
}

/** What describes one article run. Strict: unknown fields are rejected. */
export const articleBriefSchema = z
  .object(articleBriefShape)
  .strict()
  .superRefine(checkBriefWordRange);

export type ArticleBrief = z.infer<typeof articleBriefSchema>;

/** A brief whose word range is settled: the brief's own, else the quality configuration's. */
export type ResolvedArticleBrief = ArticleBrief & { minWords: number; maxWords: number };

/** One line per problem, for messages shown to a person. */
export function formatBriefIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length > 0 ? `${issue.path.join(".")}: ` : ""}${issue.message}`)
    .join("; ");
}
