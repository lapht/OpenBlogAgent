import { describe, expect, it } from "vitest";

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
});
