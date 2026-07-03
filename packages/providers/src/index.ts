export interface TextGenerationProvider {
  generate(prompt: string): Promise<string>;
}

export interface DefaultProviderOptions {
  openRouter: TextGenerationProvider;
  ollama?: TextGenerationProvider;
}

export function createDefaultTextGenerationProvider(
  options: DefaultProviderOptions
): TextGenerationProvider {
  const { ollama, openRouter } = options;

  return {
    async generate(prompt: string): Promise<string> {
      let openRouterError: unknown;

      try {
        return await openRouter.generate(prompt);
      } catch (error) {
        openRouterError = error;

        if (!ollama) {
          throw error;
        }

        try {
          return await ollama.generate(prompt);
        } catch (fallbackError) {
          const primaryMessage =
            openRouterError instanceof Error ? openRouterError.message : String(openRouterError);
          const fallbackMessage =
            fallbackError instanceof Error ? fallbackError.message : String(fallbackError);

          throw new Error(
            `No LLM provider available. OpenRouter failed: ${primaryMessage}. Ollama failed: ${fallbackMessage}. Configure OPENROUTER_API_KEY or start Ollama on http://127.0.0.1:11434.`
          );
        }
      }
    }
  };
}

export * from "./openrouter";
export * from "./ollama";
