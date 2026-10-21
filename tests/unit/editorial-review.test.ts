import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createEditorialReviewAgent } from "../../packages/agents/src";
import { createArticleGenerationWorkflow } from "../../packages/graph/src/workflows/article-generation-workflow";
import { createSQLiteMemoryService } from "../../packages/storage/src/memory";
import { fixtureOutline, goodArticle } from "../fixtures/articles";
import { lenientQuality } from "../mocks/lenient-quality";

const logger = { info() {}, warn() {}, error() {}, debug() {} };

const seo = JSON.stringify({
  title: "Caching made simple",
  metaDescription: "How to cache well.",
  slug: "caching-made-simple",
  h1: "Caching",
  headings: [{ level: "H2", text: "Why caching matters" }]
});

const review = (scores: number[], rationale = "Because.") =>
  JSON.stringify({
    // The model's own "overall" must be ignored: it is computed from the scores.
    overall: 10,
    scores: {
      seo: scores[0],
      readability: scores[1],
      structure: scores[2],
      completeness: scores[3],
      repetition: scores[4]
    },
    rationale
  });

/** Replies by agent, recognized from the prompt; the review prompt is checked first (it mentions the outline). */
function routedProvider(reviewReply: string) {
  const prompts: string[] = [];
  return {
    prompts,
    id: "fake",
    get reviewCalls() {
      return prompts.filter((prompt) => prompt.includes("strict editorial reviewer")).length;
    },
    async generate(request: { prompt: string }) {
      prompts.push(request.prompt);
      const p = request.prompt;
      const text = p.includes("strict editorial reviewer")
        ? reviewReply
        : p.includes("blog writer")
          ? goodArticle
          : p.includes("experienced editor")
            ? JSON.stringify({ editedText: goodArticle, changesSummary: "tidied" })
            : p.includes("outline")
              ? JSON.stringify(fixtureOutline)
              : p.includes("SEO")
                ? seo
                : JSON.stringify({ category: "News", tags: ["ai"] });
      return { text, model: "fake", usage: { totalTokens: 10 } };
    }
  };
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function setup(
  llm: ReturnType<typeof routedProvider>,
  review?: { enabled?: boolean; minScore?: number },
  memory?: Parameters<typeof createArticleGenerationWorkflow>[0]["memory"]
) {
  const published: string[] = [];
  const workflow = createArticleGenerationWorkflow({
    logger,
    llm,
    review,
    memory,
    quality: lenientQuality,
    publicationPolicy: "publish_if_gate_passes",
    taxonomy: { listCategories: async () => ["News"], listTags: async () => ["ai"] },
    publisher: {
      publish: async (article) => {
        published.push(article.slug);
        return { success: true, publisherId: "fake", publisherName: "Fake" };
      }
    }
  });
  return { workflow, published };
}

describe("editorial review agent", () => {
  it("computes the overall score from the dimension scores", async () => {
    const result = await createEditorialReviewAgent(
      routedProvider(review([9, 8, 9, 8, 9], "Solid."))
    ).run({ outline: fixtureOutline, articleText: goodArticle, title: "T", metaDescription: "D" });

    expect(result.overall).toBe(8.6);
    expect(result.rationale).toBe("Solid.");
  });

  it("rejects scores outside 0 to 10", async () => {
    const agent = createEditorialReviewAgent(routedProvider(review([11, 8, 9, 8, 9])), {
      maxAttempts: 1
    });
    await expect(
      agent.run({ outline: [], articleText: "x", title: "T", metaDescription: "D" })
    ).rejects.toThrow(/valid structured output/);
  });
});

describe("editorial review in the workflow", () => {
  it("is off by default and costs nothing", async () => {
    const llm = routedProvider(review([1, 1, 1, 1, 1]));
    const { workflow, published } = setup(llm);

    const result = await workflow.run({ topic: "Caching" });

    expect(result.status).toBe("published");
    expect(llm.reviewCalls).toBe(0);
    expect(llm.prompts).toHaveLength(5);
    expect((result as { review?: unknown }).review).toBeUndefined();
    expect(published).toEqual(["caching-made-simple"]);
  });

  it("returns the scores and publishes when the score reaches the threshold", async () => {
    const llm = routedProvider(review([7, 7, 7, 7, 7]));
    const { workflow, published } = setup(llm, { enabled: true, minScore: 7 });

    const result = await workflow.run({ topic: "Caching" });

    expect(result.status).toBe("published");
    expect(llm.reviewCalls).toBe(1);
    expect(result.status === "published" && result.review).toMatchObject({
      overall: 7,
      scores: { seo: 7, readability: 7, structure: 7, completeness: 7, repetition: 7 }
    });
    expect(published).toHaveLength(1);
  });

  it("parks a borderline article as needs_review and publishes nothing", async () => {
    const llm = routedProvider(review([6, 7, 6, 7, 6], "Thin and repetitive."));
    const { workflow, published } = setup(llm, { enabled: true, minScore: 7 });

    const result = await workflow.run({ topic: "Caching" });

    expect(result.status).toBe("needs_review");
    if (result.status !== "needs_review") throw new Error("unreachable");
    expect(result.failure.code).toBe("quality_gate_failed");
    expect(result.violations).toEqual([
      expect.objectContaining({
        code: "editorial_review_below_threshold",
        message: expect.stringContaining("Thin and repetitive.")
      })
    ]);
    expect(result.review?.overall).toBe(6.4);
    expect(published).toEqual([]);
  });

  it("stores the review and shows it in the run list", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openblog-review-"));
    dirs.push(dir);
    const handle = await createSQLiteMemoryService({ filePath: path.join(dir, "memory.db") });
    const llm = routedProvider(review([9, 9, 9, 9, 9], "Excellent."));
    const { workflow } = setup(llm, { enabled: true }, handle.memoryService);

    await workflow.run({ topic: "Caching" });

    const [run] = await handle.memoryService.listWorkflows();
    expect(run.review).toEqual({
      overall: 9,
      scores: { seo: 9, readability: 9, structure: 9, completeness: 9, repetition: 9 },
      rationale: "Excellent."
    });
    await handle.disconnect();
  });
});
