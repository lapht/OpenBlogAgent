import { requestJson, type RequestPolicy } from "../http";
import {
  ProviderError,
  type GenerateRequest,
  type GenerateResult,
  type TextGenerationProvider
} from "../types";

export const DEFAULT_OPENROUTER_MODEL = "openai/gpt-4o-mini";
export const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export interface OpenRouterProviderConfig extends RequestPolicy {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  siteName?: string;
  siteUrl?: string;
}

interface OpenRouterChatResponse {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
  };
}

export class OpenRouterProvider implements TextGenerationProvider {
  public readonly id = "openrouter";

  constructor(public readonly config: OpenRouterProviderConfig) {}

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const { apiKey } = this.config;

    if (!apiKey) {
      throw new ProviderError({
        kind: "auth",
        message: "OPENROUTER_API_KEY is required for OpenRouterProvider",
        provider: this.id,
        retryable: false
      });
    }

    const model = this.config.model ?? DEFAULT_OPENROUTER_MODEL;
    const messages = [
      ...(request.system ? [{ content: request.system, role: "system" }] : []),
      { content: request.prompt, role: "user" }
    ];

    const data = (await requestJson({
      ...this.config,
      provider: this.id,
      url: `${this.config.baseUrl ?? DEFAULT_OPENROUTER_BASE_URL}/chat/completions`,
      signal: request.signal,
      secrets: [apiKey],
      init: {
        body: JSON.stringify({
          messages,
          model,
          // Ask OpenRouter to report the cost of the call next to the token counts.
          usage: { include: true },
          ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
          ...(request.temperature !== undefined ? { temperature: request.temperature } : {})
        }),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...(this.config.siteName ? { "X-Title": this.config.siteName } : {}),
          ...(this.config.siteUrl ? { "HTTP-Referer": this.config.siteUrl } : {})
        },
        method: "POST"
      }
    })) as OpenRouterChatResponse | null;

    const text = data?.choices?.[0]?.message?.content?.trim();

    if (!text) {
      throw new ProviderError({
        kind: "invalid_response",
        message: "OpenRouter returned an empty response",
        provider: this.id,
        retryable: false
      });
    }

    return {
      text,
      model: data?.model ?? model,
      usage: data?.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
            cost: typeof data.usage.cost === "number" ? data.usage.cost : undefined
          }
        : undefined
    };
  }
}
