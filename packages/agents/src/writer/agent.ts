import type { TextGenerationProvider } from "@openblog/providers";

import { buildWriterPrompt } from "../prompts/writer";

export interface WriterAgentInput {
  topic: string;
  outline: string[];
}

export interface WriterAgent {
  /** The exact prompt `run` sends, so callers can record it. */
  buildPrompt(input: WriterAgentInput): string;
  /** Returns the article as Markdown. */
  run(input: WriterAgentInput): Promise<string>;
}

export function createWriterAgent(provider: TextGenerationProvider): WriterAgent {
  return {
    buildPrompt: (input) => buildWriterPrompt(input.topic, input.outline),
    async run(input: WriterAgentInput): Promise<string> {
      const { text } = await provider.generate({
        prompt: buildWriterPrompt(input.topic, input.outline)
      });
      const article = text.trim();

      if (article.length === 0) {
        throw new Error("Writer returned an empty article");
      }

      return article;
    }
  };
}
