import { requestJson, type RequestPolicy } from "../http";
import {
  ProviderError,
  type GenerateRequest,
  type GenerateResult,
  type TextGenerationProvider
} from "../types";

export const DEFAULT_OLLAMA_MODEL = "llama3.1";
export const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";

export interface OllamaProviderConfig extends RequestPolicy {
  baseUrl?: string;
  model?: string;
}

interface OllamaGenerateResponse {
  model?: string;
  response?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

export class OllamaProvider implements TextGenerationProvider {
  public readonly id = "ollama";

  constructor(public readonly config: OllamaProviderConfig) {}

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const model = request.model ?? this.config.model ?? DEFAULT_OLLAMA_MODEL;
    const options = {
      ...(request.maxTokens !== undefined ? { num_predict: request.maxTokens } : {}),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {})
    };

    const data = (await requestJson({
      ...this.config,
      provider: this.id,
      url: `${this.config.baseUrl ?? DEFAULT_OLLAMA_BASE_URL}/api/generate`,
      signal: request.signal,
      init: {
        body: JSON.stringify({
          model,
          prompt: request.prompt,
          stream: false,
          ...(request.system ? { system: request.system } : {}),
          ...(Object.keys(options).length > 0 ? { options } : {})
        }),
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      }
    })) as OllamaGenerateResponse | null;

    const text = data?.response?.trim();

    if (!text) {
      throw new ProviderError({
        kind: "invalid_response",
        message: "Ollama returned an empty response",
        provider: this.id,
        retryable: false
      });
    }

    const promptTokens = data?.prompt_eval_count;
    const completionTokens = data?.eval_count;

    return {
      text,
      model: data?.model ?? model,
      usage:
        promptTokens !== undefined || completionTokens !== undefined
          ? {
              promptTokens,
              completionTokens,
              totalTokens: (promptTokens ?? 0) + (completionTokens ?? 0)
            }
          : undefined
    };
  }
}
