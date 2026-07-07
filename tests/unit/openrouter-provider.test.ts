import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OpenRouterProvider } from "../../packages/providers/src/openrouter";

describe("OpenRouterProvider", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.stubGlobal("fetch", originalFetch);
    vi.restoreAllMocks();
  });

  it("retries the request up to three times before succeeding", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "done" } }]
        })
      } as Response);

    vi.stubGlobal("fetch", fetchMock);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const provider = new OpenRouterProvider({ apiKey: "test-key" });
    const result = await provider.generate("hello");

    expect(result).toBe("done");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(logSpy).toHaveBeenCalledWith(
      "About to attempt OpenRouter request",
      expect.objectContaining({ attempt: 1, maxAttempts: 3 })
    );
  });
});
