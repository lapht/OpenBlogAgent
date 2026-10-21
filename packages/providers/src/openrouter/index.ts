import type { IProvider } from "@openblog/core";
import { logger } from "@openblog/logger";

import type { TextGenerationProvider } from "..";

export interface OpenRouterProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  siteName?: string;
  siteUrl?: string;
}

interface OpenRouterChatResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

export class OpenRouterProvider implements IProvider, TextGenerationProvider {
  public readonly id = "openrouter";
  public readonly name = "OpenRouter";

  constructor(public readonly config: OpenRouterProviderConfig) {}

  async generate(prompt: string): Promise<string> {
    if (!this.config.apiKey) {
      throw new Error("OPENROUTER_API_KEY is required for OpenRouterProvider");
    }

    const maxAttempts = 3;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      logger.debug("Attempting OpenRouter request", {
        attempt,
        maxAttempts,
        model: this.config.model ?? "openai/gpt-4o-mini"
      });

      try {
        const response = await fetch(
          `${this.config.baseUrl ?? "https://openrouter.ai/api/v1"}/chat/completions`,
          {
            body: JSON.stringify({
              messages: [
                {
                  content: prompt,
                  role: "user"
                }
              ],
              model: this.config.model ?? "openai/gpt-4o-mini"
            }),
            headers: {
              Authorization: `Bearer ${this.config.apiKey}`,
              "Content-Type": "application/json",
              ...(this.config.siteName ? { "X-Title": this.config.siteName } : {}),
              ...(this.config.siteUrl ? { "HTTP-Referer": this.config.siteUrl } : {})
            },
            method: "POST"
          }
        );

        if (!response.ok) {
          throw new Error(`OpenRouter request failed with status ${response.status}`);
        }

        const data = (await response.json()) as OpenRouterChatResponse;
        const content = data.choices?.[0]?.message?.content?.trim();

        if (!content) {
          throw new Error("OpenRouter returned an empty response");
        }

        return content;
      } catch (error) {
        lastError = error;
        logger.debug("OpenRouter request failed", {
          attempt,
          maxAttempts,
          message: error instanceof Error ? error.message : String(error)
        });

        if (attempt < maxAttempts) {
          logger.debug("Retrying OpenRouter request", {
            attempt,
            nextAttempt: attempt + 1,
            maxAttempts
          });
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}
