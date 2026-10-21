import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OpenRouterProvider } from "../../packages/providers/src/openrouter";
import { ProviderError } from "../../packages/providers/src/types";

const jsonResponse = (body: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(body), init);

const okBody = {
  model: "openai/gpt-4o-mini",
  choices: [{ message: { content: " done " } }],
  usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 }
};

describe("OpenRouterProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(1);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const setup = (...responses: Array<Response | Error>) => {
    const fetchMock = vi.fn();
    for (const response of responses) {
      if (response instanceof Error) {
        fetchMock.mockRejectedValueOnce(response);
      } else {
        fetchMock.mockResolvedValueOnce(response);
      }
    }
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  const run = async (provider: OpenRouterProvider, request = { prompt: "hello" }) => {
    const settled = provider.generate(request).then(
      (value) => ({ value }),
      (error: unknown) => ({ error })
    );
    await vi.runAllTimersAsync();
    return settled;
  };

  it("returns text, model and usage, sending system/user messages", async () => {
    const fetchMock = setup(jsonResponse(okBody));
    const provider = new OpenRouterProvider({ apiKey: "k" });

    const outcome = await run(provider, { prompt: "hello", system: "be brief" } as never);

    expect(outcome).toEqual({
      value: {
        text: "done",
        model: "openai/gpt-4o-mini",
        usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 }
      }
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.messages).toEqual([
      { content: "be brief", role: "system" },
      { content: "hello", role: "user" }
    ]);
  });

  it("fails with invalid_response on empty content", async () => {
    const fetchMock = setup(jsonResponse({ choices: [{ message: { content: "  " } }] }));
    const outcome = (await run(new OpenRouterProvider({ apiKey: "k" }))) as {
      error: ProviderError;
    };

    expect(outcome.error.kind).toBe("invalid_response");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails with invalid_response on malformed JSON without retrying", async () => {
    const fetchMock = setup(new Response("<html>oops</html>", { status: 200 }));
    const outcome = (await run(new OpenRouterProvider({ apiKey: "k" }))) as {
      error: ProviderError;
    };

    expect(outcome.error.kind).toBe("invalid_response");
    expect(outcome.error.retryable).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails immediately on 401 with kind auth and a redacted body", async () => {
    const fetchMock = setup(new Response('{"error":"bad key secret-key"}', { status: 401 }));
    const outcome = (await run(new OpenRouterProvider({ apiKey: "secret-key" }))) as {
      error: ProviderError;
    };

    expect(outcome.error).toBeInstanceOf(ProviderError);
    expect(outcome.error.kind).toBe("auth");
    expect(outcome.error.retryable).toBe(false);
    expect(outcome.error.details).toContain("bad key [redacted]");
    expect(outcome.error.details).not.toContain("secret-key");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails with auth when the API key is missing, without calling fetch", async () => {
    const fetchMock = setup();
    const outcome = (await run(new OpenRouterProvider({}))) as { error: ProviderError };

    expect(outcome.error.kind).toBe("auth");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("truncates long error bodies", async () => {
    setup(new Response("x".repeat(5000), { status: 400 }));
    const outcome = (await run(new OpenRouterProvider({ apiKey: "k" }))) as {
      error: ProviderError;
    };

    expect(outcome.error.details!.length).toBeLessThanOrEqual(501);
  });

  it("honors Retry-After on 429 and then succeeds", async () => {
    const fetchMock = setup(
      new Response("slow down", { status: 429, headers: { "Retry-After": "2" } }),
      jsonResponse(okBody)
    );
    const provider = new OpenRouterProvider({ apiKey: "k" });
    const settled = provider.generate({ prompt: "hello" });

    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(settled).resolves.toMatchObject({ text: "done" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a 500 with exponential backoff and then succeeds", async () => {
    const fetchMock = setup(
      new Response("boom", { status: 500 }),
      new Response("boom", { status: 502 }),
      jsonResponse(okBody)
    );
    const provider = new OpenRouterProvider({ apiKey: "k", baseDelayMs: 100 });
    const settled = provider.generate({ prompt: "hello" });

    await vi.advanceTimersByTimeAsync(99);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); // 100ms: second attempt
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(199);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1); // +200ms: third attempt
    await expect(settled).resolves.toMatchObject({ text: "done" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("surfaces a classified error once retries are exhausted", async () => {
    const fetchMock = setup(
      new Response("down", { status: 503 }),
      new Response("down", { status: 503 }),
      new Response("down", { status: 503 })
    );
    const outcome = (await run(new OpenRouterProvider({ apiKey: "k" }))) as {
      error: ProviderError;
    };

    expect(outcome.error.kind).toBe("server");
    expect(outcome.error.retryable).toBe(true);
    expect(outcome.error.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("times out hung requests and reports kind timeout", async () => {
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        })
    );
    vi.stubGlobal("fetch", fetchMock);

    const outcome = (await run(
      new OpenRouterProvider({ apiKey: "k", timeoutMs: 1000, maxRetries: 1 })
    )) as { error: ProviderError };

    expect(outcome.error.kind).toBe("timeout");
    expect(outcome.error.retryable).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("classifies network failures as retryable", async () => {
    const fetchMock = setup(new Error("ECONNRESET"), jsonResponse(okBody));
    const outcome = await run(new OpenRouterProvider({ apiKey: "k" }));

    expect(outcome).toMatchObject({ value: { text: "done" } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry when the caller aborts", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = setup();
    const outcome = (await run(new OpenRouterProvider({ apiKey: "k" }), {
      prompt: "hello",
      signal: controller.signal
    } as never)) as { error: ProviderError };

    expect(outcome.error.retryable).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
