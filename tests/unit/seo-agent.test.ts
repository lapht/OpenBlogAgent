import { describe, expect, it } from "vitest";

import { createEditorAgent } from "../../packages/agents/src/editor/agent";
import { createSeoAgent } from "../../packages/agents/src/seo/agent";

describe("SEO agent output parsing", () => {
  it("normalizes overly long metadata and string headings from model output", async () => {
    const provider = {
      generate: async () =>
        JSON.stringify({
          title: "A".repeat(70),
          metaDescription: "B".repeat(200),
          slug: "my-slug",
          h1: "Example H1",
          headings: ["Overview", "Approach", "Conclusion"]
        })
    };

    const agent = createSeoAgent(provider as never);
    const result = await agent.run({
      outline: ["Intro"],
      articleText: "Article body"
    });

    expect(result.title).toHaveLength(60);
    expect(result.metaDescription).toHaveLength(155);
    expect(result.headings).toEqual([
      { level: "H2", text: "Overview" },
      { level: "H2", text: "Approach" },
      { level: "H2", text: "Conclusion" }
    ]);
  });

  it("includes the raw response in the error when SEO JSON is invalid", async () => {
    const provider = {
      generate: async () => "not valid json"
    };

    const agent = createSeoAgent(provider as never);

    await expect(
      agent.run({
        outline: ["Intro"],
        articleText: "Article body"
      })
    ).rejects.toThrow(/Received:.*not valid json/i);
  });

  it("includes the raw response in the error when editor JSON is invalid", async () => {
    const provider = {
      generate: async () => "```json\n{not valid json}\n```"
    };

    const agent = createEditorAgent(provider as never);

    await expect(
      agent.run({
        rawText: "Some text"
      })
    ).rejects.toThrow(/Received:[\s\S]*\{not valid json\}/i);
  });
});
