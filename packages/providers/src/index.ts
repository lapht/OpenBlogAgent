import { logger } from "@openblog/logger";

import {
  ProviderError,
  type GenerateRequest,
  type GenerateResult,
  type TextGenerationProvider
} from "./types";

export interface DefaultProviderOptions {
  /** Preferred provider. When omitted, `ollama` is used directly. */
  openRouter?: TextGenerationProvider;
  /** Secondary provider, used when the primary is unavailable (retryable failures only). */
  ollama?: TextGenerationProvider;
}

export function createDefaultTextGenerationProvider(
  options: DefaultProviderOptions
): TextGenerationProvider {
  const { ollama, openRouter } = options;
  const primary = openRouter ?? ollama;

  if (!primary) {
    throw new Error("At least one text generation provider must be configured");
  }

  const fallback = openRouter ? ollama : undefined;

  return {
    id: fallback ? `${primary.id}+${fallback.id}` : primary.id,
    async generate(request: GenerateRequest): Promise<GenerateResult> {
      try {
        const result = await primary.generate(request);
        logger.info("Text generation provider answered", { provider: primary.id });
        return result;
      } catch (error) {
        // Auth/config/response errors would fail the same way (or hide a bug) on the fallback.
        if (!fallback || !(error instanceof ProviderError) || !error.retryable) {
          throw error;
        }

        logger.warn("Primary provider unavailable, falling back", {
          provider: primary.id,
          fallback: fallback.id,
          kind: error.kind
        });

        try {
          // A per-step model names an OpenRouter model; Ollama would not know it, so it uses its own.
          const result = await fallback.generate({ ...request, model: undefined });
          logger.info("Text generation provider answered", { provider: fallback.id });
          return result;
        } catch (fallbackError) {
          const fallbackMessage =
            fallbackError instanceof Error ? fallbackError.message : String(fallbackError);

          throw new ProviderError({
            kind: error.kind,
            message: `No LLM provider available. ${primary.id} failed: ${error.message}. ${fallback.id} failed: ${fallbackMessage}.`,
            provider: primary.id,
            retryable: false,
            status: error.status
          });
        }
      }
    }
  };
}

export * from "./types";
export * from "./openrouter";
export * from "./ollama";
