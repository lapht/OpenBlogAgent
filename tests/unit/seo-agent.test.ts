import { describe, expect, it } from "vitest";

import { createClassificationAgent } from "../../packages/agents/src/classification/agent";
import { createEditorAgent } from "../../packages/agents/src/editor/agent";
import { createSeoAgent } from "../../packages/agents/src/seo/agent";
import { StructuredOutputError } from "../../packages/agents/src/structured-output";
import { scriptedProvider } from "../mocks/scripted-provider";

const seo = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    title: "A good title",
    metaDescription: "A good description",
    slug: "my-slug",
    h1: "Example H1",
    headings: [
      { level: "H2", text: "Overview" },
      { level: "H3", text: "Approach" }
    ],
    ...overrides
  });

const seoInput = { outline: ["Intro"], articleText: "Article body" };

describe("SEO agent", () => {
  it("returns validated output and slugifies the slug", async () => {
    const agent = createSeoAgent(scriptedProvider(seo({ slug: "  Il Mio Slug Già! " })));
    const result = await agent.run(seoInput);

    expect(result.slug).toBe("il-mio-slug-gia");
    expect(result.headings).toHaveLength(2);
  });

  it("retries when the title is over-long instead of truncating it", async () => {
    const provider = scriptedProvider(seo({ title: "A".repeat(70) }), seo());
    const result = await createSeoAgent(provider).run(seoInput);

    expect(result.title).toBe("A good title");
    expect(provider.prompts[1]).toContain("title must be at most 60 characters");
  });

  it("rejects an empty slug, title and h1 even after retries", async () => {
    for (const field of ["slug", "title", "h1"]) {
      const provider = scriptedProvider(seo({ [field]: "  " }));
      await expect(createSeoAgent(provider, { maxAttempts: 2 }).run(seoInput)).rejects.toThrow(
        StructuredOutputError
      );
      expect(provider.prompts).toHaveLength(2);
    }
  });

  it("includes the raw response in the error when SEO JSON is invalid", async () => {
    const agent = createSeoAgent(scriptedProvider("not valid json"), { maxAttempts: 1 });

    await expect(agent.run(seoInput)).rejects.toThrow(/Received:.*not valid json/i);
  });
});

describe("Editor agent", () => {
  it("returns the edited text", async () => {
    const reply = JSON.stringify({ editedText: "Better", changesSummary: "tidied" });
    const result = await createEditorAgent(scriptedProvider(reply)).run({ rawText: "text" });

    expect(result.editedText).toBe("Better");
  });

  it("includes the raw response in the error when editor JSON is invalid", async () => {
    const agent = createEditorAgent(scriptedProvider("```json\n{not valid json}\n```"), {
      maxAttempts: 1
    });

    await expect(agent.run({ rawText: "Some text" })).rejects.toThrow(
      /Received:[\s\S]*\{not valid json\}/i
    );
  });

  it("rejects an empty edited text", async () => {
    const reply = JSON.stringify({ editedText: " ", changesSummary: "x" });
    const agent = createEditorAgent(scriptedProvider(reply), { maxAttempts: 1 });

    await expect(agent.run({ rawText: "text" })).rejects.toThrow(StructuredOutputError);
  });
});

describe("Classification agent", () => {
  const input = {
    articleText: "text",
    availableCategories: ["News", "Tutorials"],
    maxTags: 2
  };

  it("canonicalizes the category, de-duplicates and caps tags", async () => {
    const reply = JSON.stringify({ category: " tutorials ", tags: ["A", "a", " B ", "C"] });
    const result = await createClassificationAgent(scriptedProvider(reply)).run(input);

    expect(result).toEqual({ category: "Tutorials", tags: ["A", "B"] });
  });

  it("retries when the category is unknown", async () => {
    const provider = scriptedProvider(
      JSON.stringify({ category: "Gossip", tags: [] }),
      JSON.stringify({ category: "News", tags: [] })
    );
    const result = await createClassificationAgent(provider).run(input);

    expect(result.category).toBe("News");
    expect(provider.prompts[1]).toContain('category "Gossip" is not allowed');
  });

  it("fails when the category stays outside the allowed list", async () => {
    const provider = scriptedProvider(JSON.stringify({ category: "Gossip", tags: [] }));

    await expect(
      createClassificationAgent(provider, { maxAttempts: 2 }).run(input)
    ).rejects.toThrow(StructuredOutputError);
  });
});
