import { describe, expect, it } from "vitest";

import type { PublishArticle } from "../../packages/publishers/src/types";
import {
  articleWorkflowStateSchema,
  createArticleGenerationWorkflow
} from "../../packages/graph/src/workflows/article-generation-workflow";
import { scriptedProvider } from "../mocks/scripted-provider";

describe("article workflow state validation", () => {
  it("accepts the initial empty seoOutput state used by the graph defaults", () => {
    expect(() =>
      articleWorkflowStateSchema.parse({
        article: "",
        outline: [],
        topic: "Test article",
        seoOutput: {}
      })
    ).not.toThrow();
  });
});

describe("article workflow with fake ports", () => {
  const replies = [
    JSON.stringify(["Intro", "Body", "Conclusion"]),
    "# not used\nArticle body",
    JSON.stringify({ editedText: "Edited body", changesSummary: "tidied" }),
    JSON.stringify({
      title: "A title",
      metaDescription: "A description",
      slug: "a-title",
      h1: "A H1",
      headings: [{ level: "H2", text: "Intro" }]
    }),
    JSON.stringify({ category: "News", tags: ["ai", "AI", "ts"] })
  ];

  it("runs end-to-end and publishes the edited article", async () => {
    const llm = scriptedProvider(...replies);
    const published: PublishArticle[] = [];
    const prompts: string[] = [];
    const calls: string[] = [];
    const publishResult = { success: true, publisherId: "fake", publisherName: "Fake" };
    const logger = { info() {}, warn() {}, error() {}, debug() {} };

    const workflow = createArticleGenerationWorkflow({
      logger,
      llm,
      publisher: {
        publish: async (article) => {
          published.push(article);
          return publishResult;
        }
      },
      taxonomy: {
        listCategories: async () => ["General", "News"],
        listTags: async () => ["ai"]
      },
      memory: {
        beginWorkflow: async () => {
          calls.push("begin");
          return { workflowId: "wf-1", isDuplicate: false, duplicateOfWorkflowId: null };
        },
        savePrompt: async ({ promptType, content }) => {
          calls.push(`prompt:${promptType}`);
          prompts.push(content);
        },
        completeWorkflow: async () => {
          calls.push("complete");
        },
        failWorkflow: async () => {
          calls.push("fail");
        }
      },
      defaultCategory: "General",
      maxTags: 5
    });

    const result = await workflow.run({
      article: "",
      category: "",
      outline: [],
      tags: [],
      topic: "Fake topic"
    });

    expect(result.editedText).toBe("Edited body");
    expect(result.category).toBe("News");
    expect(result.tags).toEqual(["ai", "ts"]);
    expect(result.publishResult).toEqual(publishResult);
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      slug: "a-title",
      title: "A title",
      content: "Edited body",
      category: "News",
      tags: ["ai", "ts"]
    });
    expect(calls).toEqual(["begin", "prompt:planner", "prompt:writer", "complete"]);
    expect(prompts[0]).toContain("Fake topic");
    expect(llm.prompts).toHaveLength(5);
  });
});
