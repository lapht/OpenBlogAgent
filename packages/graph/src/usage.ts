import { AsyncLocalStorage } from "node:async_hooks";

import type { ILogger } from "@openblog/logger";

import type { LlmPort } from "./ports";

export interface LlmUsage {
  calls: number;
  totalTokens: number;
}

const storage = new AsyncLocalStorage<LlmUsage>();

/** Runs `fn` with a fresh usage counter; every call through a tracked LLM inside it is counted. */
export function withUsageTracking<T>(fn: () => Promise<T>): Promise<T> {
  return storage.run({ calls: 0, totalTokens: 0 }, fn);
}

/** Usage of the run in progress (a copy), or zeros outside one. */
export function currentUsage(): LlmUsage {
  const usage = storage.getStore();
  return { calls: usage?.calls ?? 0, totalTokens: usage?.totalTokens ?? 0 };
}

/** Wraps an LLM so each generation adds to the usage of the run it happens in. */
export function trackUsage(llm: LlmPort, logger?: ILogger): LlmPort {
  return {
    id: llm.id,
    async generate(request) {
      const started = Date.now();
      const result = await llm.generate(request);
      logger?.info("LLM call completed", {
        provider: llm.id,
        model: result.model,
        durationMs: Date.now() - started,
        promptTokens: result.usage?.promptTokens,
        completionTokens: result.usage?.completionTokens,
        totalTokens: result.usage?.totalTokens
      });
      const usage = storage.getStore();
      if (usage) {
        usage.calls += 1;
        usage.totalTokens +=
          result.usage?.totalTokens ??
          (result.usage?.promptTokens ?? 0) + (result.usage?.completionTokens ?? 0);
      }
      return result;
    }
  };
}
