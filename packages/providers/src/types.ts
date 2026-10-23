export interface GenerateRequest {
  prompt: string;
  system?: string;
  /** Model for this call; overrides the provider's configured model. */
  model?: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface GenerateUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  /** Cost in USD, when the provider reports one. */
  cost?: number;
}

export interface GenerateResult {
  text: string;
  model: string;
  usage?: GenerateUsage;
}

export interface TextGenerationProvider {
  readonly id: string;
  generate(request: GenerateRequest): Promise<GenerateResult>;
}

export type ProviderErrorKind =
  "auth" | "rate_limited" | "timeout" | "invalid_response" | "server" | "network";

export interface ProviderErrorInit {
  kind: ProviderErrorKind;
  message: string;
  provider: string;
  retryable: boolean;
  status?: number;
  retryAfterMs?: number;
  details?: string;
}

export class ProviderError extends Error {
  public readonly kind: ProviderErrorKind;
  public readonly provider: string;
  public readonly retryable: boolean;
  public readonly status?: number;
  public readonly retryAfterMs?: number;
  public readonly details?: string;

  constructor(init: ProviderErrorInit) {
    super(init.message);
    this.name = "ProviderError";
    this.kind = init.kind;
    this.provider = init.provider;
    this.retryable = init.retryable;
    this.status = init.status;
    this.retryAfterMs = init.retryAfterMs;
    this.details = init.details;
  }
}
