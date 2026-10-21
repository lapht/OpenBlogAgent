import { describe, expect, it, vi } from "vitest";

import { createDefaultTextGenerationProvider } from "../../packages/providers/src";
import { ProviderError, type TextGenerationProvider } from "../../packages/providers/src/types";

const failing = (kind: ProviderError["kind"], retryable: boolean): TextGenerationProvider => ({
  id: "openrouter",
  generate: vi
    .fn()
    .mockRejectedValue(
      new ProviderError({ kind, message: `${kind} failure`, provider: "openrouter", retryable })
    )
});

const working = (): TextGenerationProvider => ({
  id: "ollama",
  generate: vi.fn().mockResolvedValue({ text: "from ollama", model: "llama3.1" })
});

describe("createDefaultTextGenerationProvider", () => {
  it("falls back to the secondary provider on retryable failures", async () => {
    const ollama = working();
    const provider = createDefaultTextGenerationProvider({
      openRouter: failing("server", true),
      ollama
    });

    await expect(provider.generate({ prompt: "hi" })).resolves.toMatchObject({
      text: "from ollama"
    });
    expect(ollama.generate).toHaveBeenCalledTimes(1);
  });

  it("does not fall back on auth errors", async () => {
    const ollama = working();
    const provider = createDefaultTextGenerationProvider({
      openRouter: failing("auth", false),
      ollama
    });

    await expect(provider.generate({ prompt: "hi" })).rejects.toMatchObject({ kind: "auth" });
    expect(ollama.generate).not.toHaveBeenCalled();
  });

  it("reports both failures when the fallback also fails", async () => {
    const provider = createDefaultTextGenerationProvider({
      openRouter: failing("rate_limited", true),
      ollama: {
        id: "ollama",
        generate: vi.fn().mockRejectedValue(new Error("connection refused"))
      }
    });

    await expect(provider.generate({ prompt: "hi" })).rejects.toThrow(
      /openrouter failed: rate_limited failure.*ollama failed: connection refused/
    );
  });

  it("uses ollama directly when OpenRouter is not configured", async () => {
    const ollama = working();
    const provider = createDefaultTextGenerationProvider({ ollama });

    await expect(provider.generate({ prompt: "hi" })).resolves.toMatchObject({ model: "llama3.1" });
  });
});
