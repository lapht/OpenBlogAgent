import { describe, expect, it } from "vitest";

import {
  createArticleGenerationWorkflow,
  type CreateArticleGenerationWorkflowOptions
} from "../../packages/graph/src/workflows/article-generation-workflow";
import { goodArticle, tooShortArticle } from "../fixtures/articles";

const logger = { info() {}, warn() {}, error() {}, debug() {} };

const outline = ["Why caching matters", "Choosing a cache strategy", "Invalidation in practice"];
const seo = JSON.stringify({
  title: "Caching made simple",
  metaDescription: "How to cache well.",
  slug: "caching-made-simple",
  h1: "Caching",
  headings: [{ level: "H2", text: "Why caching matters" }]
});
const edited = (text: string) => JSON.stringify({ editedText: text, changesSummary: "tidied" });
const classification = JSON.stringify({ category: "News", tags: ["ai"] });

/** Replies by agent, recognized from the prompt; each queue is consumed in order (the last repeats). */
function routedProvider(queues: { writer: string[]; editor: string[] }) {
  const prompts: string[] = [];
  const used = { writer: 0, editor: 0 };
  const next = (kind: "writer" | "editor") =>
    queues[kind][Math.min(used[kind]++, queues[kind].length - 1)]!;
  return {
    prompts,
    id: "fake",
    async generate(request: { prompt: string }) {
      prompts.push(request.prompt);
      const p = request.prompt;
      const text = p.includes("blog writer")
        ? next("writer")
        : p.includes("experienced editor")
          ? next("editor")
          : p.includes("outline")
            ? JSON.stringify(outline)
            : p.includes("SEO")
              ? seo
              : classification;
      return { text, model: "fake", usage: { totalTokens: 10 } };
    }
  };
}

function setup(
  llm: ReturnType<typeof routedProvider>,
  quality: CreateArticleGenerationWorkflowOptions["quality"]
) {
  const published: string[] = [];
  const finished: Array<Record<string, unknown>> = [];
  const workflow = createArticleGenerationWorkflow({
    logger,
    llm,
    quality,
    publicationPolicy: "publish_if_gate_passes",
    taxonomy: { listCategories: async () => ["News"], listTags: async () => ["ai"] },
    publisher: {
      publish: async (article) => {
        published.push(article.slug);
        return { success: true, publisherId: "fake", publisherName: "Fake" };
      }
    },
    memory: {
      beginWorkflow: async () => ({
        workflowId: "wf-q",
        isDuplicate: false,
        duplicateOfWorkflowId: null
      }),
      savePrompt: async () => {},
      markRunning: async () => {},
      finishWorkflow: async (params) => {
        finished.push(params);
      },
      loadWorkflow: async () => null,
      markDuplicate: async () => {},
      findDuplicateArticle: async () => null,
      recordStep: async () => {},
      failWorkflow: async (params) => {
        throw new Error(`unexpected failWorkflow: ${JSON.stringify(params)}`);
      }
    }
  });
  return { workflow, published, finished };
}

describe("quality gate", () => {
  it("regenerates once with the violations in the prompt, then publishes", async () => {
    const llm = routedProvider({
      writer: [tooShortArticle, goodArticle],
      editor: [edited(tooShortArticle), edited(goodArticle)]
    });
    const { workflow, published, finished } = setup(llm, { maxAttempts: 2 });

    const result = await workflow.run({ topic: "Caching" });

    expect(result.status).toBe("published");
    expect(published).toEqual(["caching-made-simple"]);
    const writerPrompts = llm.prompts.filter((p) => p.includes("blog writer"));
    expect(writerPrompts).toHaveLength(2);
    expect(writerPrompts[0]).not.toContain("rejected by automatic checks");
    expect(writerPrompts[1]).toContain("rejected by automatic checks");
    expect(writerPrompts[1]).toContain("word_count_too_short");
    expect(finished[0]).toMatchObject({ status: "published", editedText: goodArticle });
  });

  it("parks persistently invalid output as needs_review and never publishes", async () => {
    const llm = routedProvider({
      writer: [tooShortArticle],
      editor: [edited(tooShortArticle)]
    });
    const { workflow, published, finished } = setup(llm, { maxAttempts: 2 });

    const result = await workflow.run({ topic: "Caching" });

    expect(result.status).toBe("needs_review");
    if (result.status !== "needs_review") throw new Error("unreachable");
    expect(result.failure).toMatchObject({ step: "quality", code: "quality_gate_failed" });
    expect(result.violations.map((v) => v.code)).toContain("word_count_too_short");
    expect(result.editedText).toBe(tooShortArticle);
    expect(published).toHaveLength(0);
    // 1 original + 2 regenerations.
    expect(llm.prompts.filter((p) => p.includes("blog writer"))).toHaveLength(3);
    expect(finished).toHaveLength(1);
    expect(finished[0]).toMatchObject({
      status: "needs_review",
      failedStep: "quality",
      errorCode: "quality_gate_failed",
      category: "News"
    });
  });

  it.each([0, 1])("honors maxAttempts=%i", async (maxAttempts) => {
    const llm = routedProvider({ writer: [tooShortArticle], editor: [edited(tooShortArticle)] });
    const { workflow, published } = setup(llm, { maxAttempts });

    const result = await workflow.run({ topic: "Caching" });

    expect(result.status).toBe("needs_review");
    expect(llm.prompts.filter((p) => p.includes("blog writer"))).toHaveLength(maxAttempts + 1);
    expect(published).toHaveLength(0);
  });

  it("uses configurable rules", async () => {
    const llm = routedProvider({ writer: [goodArticle], editor: [edited(goodArticle)] });
    const { workflow } = setup(llm, { maxAttempts: 0, rules: { maxWords: 50 } });

    const result = await workflow.run({ topic: "Caching" });

    expect(result.status).toBe("needs_review");
  });
});
