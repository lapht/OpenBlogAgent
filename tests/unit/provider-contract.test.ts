import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OllamaProvider } from "../../packages/providers/src/ollama";
import { OpenRouterProvider } from "../../packages/providers/src/openrouter";
import { ProviderError, type TextGenerationProvider } from "../../packages/providers/src/types";

/** Every provider must map the same transport failures to the same ProviderError contract. */
const providers: Array<{
  name: string;
  create: () => TextGenerationProvider;
  ok: unknown;
  empty: unknown;
}> = [
  {
    name: "openrouter",
    create: () => new OpenRouterProvider({ apiKey: "k", maxRetries: 1, baseDelayMs: 1 }),
    ok: { model: "m", choices: [{ message: { content: " hello " } }] },
    empty: { choices: [{ message: { content: "  " } }] }
  },
  {
    name: "ollama",
    create: () => new OllamaProvider({ maxRetries: 1, baseDelayMs: 1 }),
    ok: { model: "m", response: " hello " },
    empty: { response: "" }
  }
];

describe.each(providers)("$name provider contract", ({ create, ok, empty }) => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(1);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const json = (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init);

  const run = async (...responses: Array<Response | Error>) => {
    const fetchMock = vi.fn();
    for (const response of responses) {
      if (response instanceof Error) fetchMock.mockRejectedValueOnce(response);
      else fetchMock.mockResolvedValueOnce(response);
    }
    vi.stubGlobal("fetch", fetchMock);
    const settled = create()
      .generate({ prompt: "hi" })
      .then(
        (value) => ({ value }),
        (error: unknown) => ({ error: error as ProviderError })
      );
    await vi.runAllTimersAsync();
    return { outcome: await settled, calls: fetchMock.mock.calls.length };
  };

  it("returns trimmed text and the model", async () => {
    const { outcome } = await run(json(ok));
    expect(outcome).toMatchObject({ value: { text: "hello", model: "m" } });
  });

  it.each([
    [401, "auth", false],
    [403, "auth", false],
    [404, "invalid_response", false],
    [400, "invalid_response", false],
    [408, "timeout", true],
    [429, "rate_limited", true],
    [500, "server", true],
    [503, "server", true]
  ])("status %i is %s (retryable: %s)", async (status, kind, retryable) => {
    const { outcome, calls } = await run(
      new Response("nope", { status }),
      new Response("nope", { status })
    );

    expect((outcome as { error: ProviderError }).error).toMatchObject({
      name: "ProviderError",
      kind,
      retryable,
      status
    });
    expect(calls).toBe(retryable ? 2 : 1); // maxRetries is 1
  });

  it("recovers when a retryable status is followed by a good reply", async () => {
    const { outcome, calls } = await run(new Response("", { status: 503 }), json(ok));
    expect(outcome).toMatchObject({ value: { text: "hello" } });
    expect(calls).toBe(2);
  });

  it("honors Retry-After on a 429", async () => {
    const { outcome, calls } = await run(
      new Response("", { status: 429, headers: { "retry-after": "0" } }),
      json(ok)
    );
    expect(outcome).toMatchObject({ value: { text: "hello" } });
    expect(calls).toBe(2);
  });

  it("does not retry a malformed JSON body", async () => {
    const { outcome, calls } = await run(new Response("<html>oops</html>", { status: 200 }));
    expect((outcome as { error: ProviderError }).error).toMatchObject({
      kind: "invalid_response",
      retryable: false
    });
    expect(calls).toBe(1);
  });

  it("does not retry an empty reply", async () => {
    const { outcome, calls } = await run(json(empty));
    expect((outcome as { error: ProviderError }).error).toMatchObject({
      kind: "invalid_response",
      retryable: false
    });
    expect(calls).toBe(1);
  });

  it("treats a dropped connection as a retryable network error", async () => {
    const { outcome, calls } = await run(new Error("ECONNRESET"), new Error("ECONNRESET"));
    expect((outcome as { error: ProviderError }).error).toMatchObject({
      kind: "network",
      retryable: true
    });
    expect(calls).toBe(2);
  });
});
