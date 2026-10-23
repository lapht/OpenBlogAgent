import { describe, expect, it } from "vitest";

import { OpenRouterProvider } from "../../packages/providers/src";
import { liveEnv } from "./env";

const apiKey = liveEnv("OPENBLOG_LIVE_OPENROUTER_API_KEY");
const model = liveEnv("OPENBLOG_LIVE_OPENROUTER_MODEL");
// Hard ceiling for the single short call; the test fails if the provider reports more.
const maxCost = Number(liveEnv("OPENBLOG_LIVE_MAX_COST_PER_RUN") ?? "0.01");

describe.skipIf(!apiKey)("OpenRouter (live)", () => {
  it("answers a short prompt and reports the model and usage", async () => {
    const provider = new OpenRouterProvider({ apiKey, ...(model ? { model } : {}) });

    const result = await provider.generate({
      prompt: "Reply with the single word: pong",
      maxTokens: 16,
      temperature: 0
    });

    expect(result.text.trim().length).toBeGreaterThan(0);
    expect(result.model).toBeTruthy();
    expect(result.usage?.totalTokens ?? 0).toBeGreaterThan(0);
    if (result.usage?.cost !== undefined) expect(result.usage.cost).toBeLessThanOrEqual(maxCost);
  });
});
