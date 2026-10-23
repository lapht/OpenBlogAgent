import { describe, expect, it } from "vitest";

import { OllamaProvider } from "../../packages/providers/src";
import { liveEnv } from "./env";

const baseUrl = liveEnv("OPENBLOG_LIVE_OLLAMA_BASE_URL");
const model = liveEnv("OPENBLOG_LIVE_OLLAMA_MODEL");

/** The server must be reachable, not just configured. */
async function isReachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url.replace(/\/+$/, "")}/api/tags`, {
      signal: AbortSignal.timeout(3000)
    });
    return response.ok;
  } catch {
    return false;
  }
}

describe.skipIf(!baseUrl)("Ollama (live)", () => {
  it("answers a short prompt", async (context) => {
    if (!(await isReachable(baseUrl ?? ""))) return context.skip();

    const provider = new OllamaProvider({ baseUrl, ...(model ? { model } : {}) });
    const result = await provider.generate({
      prompt: "Reply with the single word: pong",
      maxTokens: 16,
      temperature: 0
    });

    expect(result.text.trim().length).toBeGreaterThan(0);
    expect(result.model).toBeTruthy();
  });
});
