import type { IProvider } from "@openblog/core";

export interface OllamaProviderConfig {
  baseUrl: string;
}

export class OllamaProvider implements IProvider {
  public readonly id = "ollama";
  public readonly name = "Ollama";

  constructor(public readonly config: OllamaProviderConfig) {}
}
