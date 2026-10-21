import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  generateStructured,
  StructuredOutputError
} from "../../packages/agents/src/structured-output";
import { scriptedProvider } from "../mocks/scripted-provider";
import { plannerOutlineSchema } from "../../packages/graph/src/workflows/article-generation-workflow";

const schema = z.object({ name: z.string().min(1) });
const run = (provider: ReturnType<typeof scriptedProvider>, maxAttempts?: number) =>
  generateStructured(provider, { prompt: "P", schema, label: "Test", maxAttempts });

describe("generateStructured", () => {
  it("parses plain, fenced and prose-wrapped JSON", async () => {
    for (const reply of [
      '{"name":"a"}',
      '```json\n{"name":"a"}\n```',
      'Sure! Here it is:\n{"name":"a"}\nHope that helps.'
    ]) {
      await expect(run(scriptedProvider(reply))).resolves.toEqual({ name: "a" });
    }
  });

  it("re-prompts with the validation error and succeeds on retry", async () => {
    const provider = scriptedProvider('{"name":""}', '{"name":"ok"}');

    await expect(run(provider)).resolves.toEqual({ name: "ok" });
    expect(provider.prompts).toHaveLength(2);
    expect(provider.prompts[1]).toContain("name: String must contain at least 1 character");
    expect(provider.prompts[1]).toContain('{"name":""}');
  });

  it("retries after invalid JSON", async () => {
    const provider = scriptedProvider("{not json}", '{"name":"ok"}');

    await expect(run(provider)).resolves.toEqual({ name: "ok" });
    expect(provider.prompts[1]).toContain("invalid JSON");
  });

  it("throws a typed error with the truncated last response after maxAttempts", async () => {
    const provider = scriptedProvider("nope", "x".repeat(5000));
    const error = (await run(provider, 2).catch((e: unknown) => e)) as StructuredOutputError;

    expect(error).toBeInstanceOf(StructuredOutputError);
    expect(error.attempts).toBe(2);
    expect(provider.prompts).toHaveLength(2);
    expect(error.lastResponse.length).toBeLessThanOrEqual(2001);
  });

  it("parses a JSON array for the planner outline, fenced or not", async () => {
    const outline = '["Intro","Body","Conclusion"]';
    for (const reply of [outline, `\`\`\`json\n${outline}\n\`\`\``]) {
      await expect(
        generateStructured(scriptedProvider(reply), {
          prompt: "P",
          schema: plannerOutlineSchema,
          shape: "array",
          label: "Planner"
        })
      ).resolves.toEqual(["Intro", "Body", "Conclusion"]);
    }
  });

  it("rejects an outline that is too short and retries", async () => {
    const provider = scriptedProvider('["only one"]', '["a","b","c"]');
    await expect(
      generateStructured(provider, {
        prompt: "P",
        schema: plannerOutlineSchema,
        shape: "array",
        label: "Planner"
      })
    ).resolves.toHaveLength(3);
  });
});
