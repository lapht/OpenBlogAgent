import type { TextGenerationProvider } from "@openblog/providers";
import type { ArticleBrief } from "@openblog/types";

import type { SourceNote } from "../prompts/sources";
import { buildWriterPrompt } from "../prompts/writer";
import type { StructuredOutputOptions } from "../structured-output";

export interface WriterAgentInput {
  topic: string;
  outline: string[];
  /** Problems found in a previous attempt, to be fixed by this one. */
  feedback?: string;
  brief?: ArticleBrief;
  /** What a human reviewer asks to change in `previousArticle` (a revision). */
  reviewerFeedback?: string;
  /** The version the reviewer read. */
  previousArticle?: string;
  /** Requested word range; defaults to the quality gate's default range. */
  minWords?: number;
  maxWords?: number;
  /** Text read from the brief's source pages. */
  sources?: SourceNote[];
  /** Published articles of the same site the article may link to. */
  internalLinks?: { title: string; url: string }[];
}

export interface WriterAgent {
  /** The exact prompt `run` sends, so callers can record it. */
  buildPrompt(input: WriterAgentInput): string;
  /** Returns the article as Markdown. */
  run(input: WriterAgentInput): Promise<string>;
}

export function createWriterAgent(
  provider: TextGenerationProvider,
  options: Pick<StructuredOutputOptions, "promptTemplate"> = {}
): WriterAgent {
  const prompt = (input: WriterAgentInput) =>
    buildWriterPrompt(input.topic, input.outline, { ...input, template: options.promptTemplate });

  return {
    buildPrompt: prompt,
    async run(input: WriterAgentInput): Promise<string> {
      const { text } = await provider.generate({ prompt: prompt(input) });
      const article = text.trim();

      if (article.length === 0) {
        throw new Error("Writer returned an empty article");
      }

      return article;
    }
  };
}
