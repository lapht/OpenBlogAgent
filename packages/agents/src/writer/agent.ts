import type { TextGenerationProvider } from "@openblog/providers";
import type { ArticleBrief } from "@openblog/types";

import { buildWriterPrompt } from "../prompts/writer";

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
}

export interface WriterAgent {
  /** The exact prompt `run` sends, so callers can record it. */
  buildPrompt(input: WriterAgentInput): string;
  /** Returns the article as Markdown. */
  run(input: WriterAgentInput): Promise<string>;
}

export function createWriterAgent(provider: TextGenerationProvider): WriterAgent {
  return {
    buildPrompt: (input) => buildWriterPrompt(input.topic, input.outline, input),
    async run(input: WriterAgentInput): Promise<string> {
      const { text } = await provider.generate({
        prompt: buildWriterPrompt(input.topic, input.outline, input)
      });
      const article = text.trim();

      if (article.length === 0) {
        throw new Error("Writer returned an empty article");
      }

      return article;
    }
  };
}
