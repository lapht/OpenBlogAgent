import type { IProvider } from "@openblog/core";

export interface OpenRouterProviderConfig {
  baseUrl: string;
  apiKeyEnvVar: string;
}

export class OpenRouterProvider implements IProvider {
  public readonly id = "openrouter";
  public readonly name = "OpenRouter";

  constructor(public readonly config: OpenRouterProviderConfig) {}
}
