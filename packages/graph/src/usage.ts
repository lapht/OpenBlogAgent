import { AsyncLocalStorage } from "node:async_hooks";

import { hashPrompt } from "@openblog/agents";
import type { ILogger } from "@openblog/logger";

import type { LlmPort } from "./ports";

/** What the provider calls of a run (or of one step) consumed. */
export interface LlmUsage {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Cost in USD as reported by the provider; 0 when the provider does not report one. */
  costUsd: number;
}

/** Limits for one run. A missing limit is not enforced. */
export interface UsageBudget {
  maxTokens?: number;
  maxCostUsd?: number;
}

/** Thrown when a run goes over its budget; the run stops and is stored as failed with this code. */
export class BudgetExceededError extends Error {
  readonly code = "budget_exceeded";

  constructor(
    readonly usage: LlmUsage,
    readonly budget: UsageBudget
  ) {
    const reasons: string[] = [];
    if (budget.maxTokens !== undefined && usage.totalTokens > budget.maxTokens) {
      reasons.push(`${usage.totalTokens} tokens used, limit ${budget.maxTokens}`);
    }
    if (budget.maxCostUsd !== undefined && usage.costUsd > budget.maxCostUsd) {
      reasons.push(`$${usage.costUsd.toFixed(4)} spent, limit $${budget.maxCostUsd}`);
    }
    super(`Run budget exceeded (${reasons.join("; ")})`);
    this.name = "BudgetExceededError";
  }
}

export function emptyUsage(): LlmUsage {
  return { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 };
}

export function addUsage(a: LlmUsage, b: LlmUsage): LlmUsage {
  return {
    calls: a.calls + b.calls,
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    costUsd: a.costUsd + b.costUsd
  };
}

/** What `after` consumed beyond `before`. */
export function usageSince(before: LlmUsage, after: LlmUsage): LlmUsage {
  return {
    calls: after.calls - before.calls,
    promptTokens: after.promptTokens - before.promptTokens,
    completionTokens: after.completionTokens - before.completionTokens,
    totalTokens: after.totalTokens - before.totalTokens,
    // Differences of running sums pick up float noise; costs are tracked to 1e-9 USD.
    costUsd: Math.round((after.costUsd - before.costUsd) * 1e9) / 1e9
  };
}

const storage = new AsyncLocalStorage<LlmUsage>();
const modelStorage = new AsyncLocalStorage<string[]>();
const promptStorage = new AsyncLocalStorage<string[]>();

/**
 * Runs `fn` with a usage counter; every call through a tracked LLM inside it is counted.
 * `initial` carries what earlier attempts of the same run already consumed (a resumed run).
 */
export function withUsageTracking<T>(fn: () => Promise<T>, initial?: LlmUsage): Promise<T> {
  return promptStorage.run([], () =>
    modelStorage.run([], () => storage.run({ ...(initial ?? emptyUsage()) }, fn))
  );
}

/** The model each provider call of the run in progress reported, in call order. */
export function currentModels(): string[] {
  return [...(modelStorage.getStore() ?? [])];
}

/** SHA-256 of every prompt sent by the run in progress, in call order (also the ones that failed). */
export function currentPromptHashes(): string[] {
  return [...(promptStorage.getStore() ?? [])];
}

/** Usage of the run in progress (a copy), or zeros outside one. */
export function currentUsage(): LlmUsage {
  return { ...(storage.getStore() ?? emptyUsage()) };
}

function overBudget(usage: LlmUsage, budget: UsageBudget): boolean {
  return (
    (budget.maxTokens !== undefined && usage.totalTokens > budget.maxTokens) ||
    (budget.maxCostUsd !== undefined && usage.costUsd > budget.maxCostUsd)
  );
}

/** Wraps an LLM so each generation adds to the usage of the run it happens in and respects its budget. */
export function trackUsage(llm: LlmPort, logger?: ILogger, budget: UsageBudget = {}): LlmPort {
  const enforce = (usage: LlmUsage | undefined): void => {
    if (usage && overBudget(usage, budget)) {
      throw new BudgetExceededError({ ...usage }, budget);
    }
  };

  return {
    id: llm.id,
    async generate(request) {
      // A resumed run that is already over budget must not spend more.
      enforce(storage.getStore());

      promptStorage.getStore()?.push(hashPrompt(request.prompt));
      const started = Date.now();
      const result = await llm.generate(request);
      const promptTokens = result.usage?.promptTokens ?? 0;
      const completionTokens = result.usage?.completionTokens ?? 0;
      const totalTokens = result.usage?.totalTokens ?? promptTokens + completionTokens;
      logger?.info("LLM call completed", {
        provider: llm.id,
        model: result.model,
        durationMs: Date.now() - started,
        promptTokens: result.usage?.promptTokens,
        completionTokens: result.usage?.completionTokens,
        totalTokens: result.usage?.totalTokens,
        costUsd: result.usage?.cost
      });
      const models = modelStorage.getStore();
      if (models && result.model) models.push(result.model);
      const usage = storage.getStore();
      if (usage) {
        usage.calls += 1;
        usage.promptTokens += promptTokens;
        usage.completionTokens += completionTokens;
        usage.totalTokens += totalTokens;
        usage.costUsd += result.usage?.cost ?? 0;
        enforce(usage);
      }
      return result;
    }
  };
}
