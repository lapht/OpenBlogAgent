import type { IProvider } from "@openblog/core";

import type { TextGenerationProvider } from "..";

export interface OllamaProviderConfig {
  baseUrl?: string;
  model?: string;
}

interface OllamaGenerateResponse {
  response?: string;
}

export class OllamaProvider implements IProvider, TextGenerationProvider {
  public readonly id = "ollama";
  public readonly name = "Ollama";

  constructor(public readonly config: OllamaProviderConfig) {}

  async generate(prompt: string): Promise<string> {
    const response = await fetch(
      `${this.config.baseUrl ?? "http://127.0.0.1:11434"}/api/generate`,
      {
        body: JSON.stringify({
          model: this.config.model ?? "llama3.1",
          prompt,
          stream: false
        }),
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      }
    );

    if (!response.ok) {
      throw new Error(`Ollama request failed with status ${response.status}`);
    }

    const data = (await response.json()) as OllamaGenerateResponse;
    const content = data.response?.trim();

    if (!content) {
      throw new Error("Ollama returned an empty response");
    }

    return content;
  }
}
