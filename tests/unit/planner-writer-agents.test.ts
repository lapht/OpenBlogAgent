import { describe, expect, it } from "vitest";

import { createPlannerAgent } from "../../packages/agents/src/planner/agent";
import { StructuredOutputError } from "../../packages/agents/src/structured-output";
import { createWriterAgent } from "../../packages/agents/src/writer/agent";
import { scriptedProvider } from "../mocks/scripted-provider";

describe("Planner agent", () => {
  it("returns the outline from fenced JSON", async () => {
    const provider = scriptedProvider('```json\n["Intro","Body","Conclusion"]\n```');
    const outline = await createPlannerAgent(provider).run({ topic: "Testing" });

    expect(outline).toEqual(["Intro", "Body", "Conclusion"]);
    expect(provider.prompts[0]).toContain("for the topic: Testing");
  });

  it("retries an outline that is too short", async () => {
    const provider = scriptedProvider('["Only"]', '["A","B","C"]');

    await expect(createPlannerAgent(provider).run({ topic: "t" })).resolves.toHaveLength(3);
    expect(provider.prompts).toHaveLength(2);
  });

  it("fails with a typed error when the outline stays invalid", async () => {
    const agent = createPlannerAgent(scriptedProvider("no json"), { maxAttempts: 2 });

    await expect(agent.run({ topic: "t" })).rejects.toThrow(StructuredOutputError);
  });

  it("exposes the exact prompt it sends", async () => {
    const provider = scriptedProvider('["A","B","C"]');
    const agent = createPlannerAgent(provider);
    await agent.run({ topic: "t" });

    expect(agent.buildPrompt({ topic: "t" })).toBe(provider.prompts[0]);
  });
});

describe("Writer agent", () => {
  const input = { topic: "Testing", outline: ["Intro", "Body"] };

  it("returns the trimmed Markdown article and puts the outline in the prompt", async () => {
    const provider = scriptedProvider("\n\nHello **world**\n");
    const article = await createWriterAgent(provider).run(input);

    expect(article).toBe("Hello **world**");
    expect(provider.prompts[0]).toContain("1. Intro");
    expect(provider.prompts[0]).toContain("2. Body");
  });

  it("rejects an empty article", async () => {
    await expect(createWriterAgent(scriptedProvider("   ")).run(input)).rejects.toThrow(
      "Writer returned an empty article"
    );
  });
});
