import { describe, expect, it } from "vitest";

import type { PublishArticle } from "../../packages/publishers/src/types";
import {
  createArticleGenerationWorkflow,
  WorkflowStepError
} from "../../packages/graph/src/workflows/article-generation-workflow";
import { lenientQuality } from "../mocks/lenient-quality";
import { scriptedProvider } from "../mocks/scripted-provider";

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
    const steps: string[] = [];
    const publishResult = { success: true, publisherId: "fake", publisherName: "Fake" };
    const logger = { info() {}, warn() {}, error() {}, debug() {} };

    const workflow = createArticleGenerationWorkflow({
      logger,
      quality: lenientQuality,
      publicationPolicy: "publish_if_gate_passes",
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
        markRunning: async () => {
          calls.push("running");
        },
        finishWorkflow: async ({ status }) => {
          calls.push(`finish:${status}`);
        },
        loadWorkflow: async () => null,
        markDuplicate: async () => {},
        findDuplicateArticle: async () => null,
        markDuplicate: async () => {},
        findDuplicateArticle: async () => null,
        recordStep: async ({ step, status }) => {
          steps.push(`${step}:${status}`);
        },
        failWorkflow: async () => {
          calls.push("fail");
        }
      },
      defaultCategory: "General",
      maxTags: 5
    });

    const result = await workflow.run({ topic: "Fake topic" });

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
    expect(result.status).toBe("published");
    expect(result.failure).toBeUndefined();
    expect(calls).toEqual([
      "begin",
      "running",
      "prompt:planner",
      "prompt:writer",
      "finish:published"
    ]);
    expect(steps).toEqual([
      "planner:succeeded",
      "writer:succeeded",
      "editor:succeeded",
      "seo:succeeded",
      "duplicate_check:succeeded",
      "quality:succeeded",
      "classification:succeeded",
      "publisher:succeeded"
    ]);
    expect(prompts[0]).toContain("Fake topic");
    expect(llm.prompts).toHaveLength(5);
  });

  it("marks the run failed and keeps the article when the publisher fails", async () => {
    const finished: Array<Record<string, unknown>> = [];
    const logger = { info() {}, warn() {}, error() {}, debug() {} };

    const workflow = createArticleGenerationWorkflow({
      logger,
      quality: lenientQuality,
      publicationPolicy: "publish_if_gate_passes",
      llm: scriptedProvider(...replies),
      publisher: {
        publish: async () => ({
          success: false,
          publisherId: "fake",
          publisherName: "Fake",
          error: { code: "validation_failed", message: "Publisher validation failed" }
        })
      },
      taxonomy: {
        listCategories: async () => ["General", "News"],
        listTags: async () => ["ai"]
      },
      memory: {
        beginWorkflow: async () => ({
          workflowId: "wf-2",
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
        markDuplicate: async () => {},
        findDuplicateArticle: async () => null,
        recordStep: async () => {},
        failWorkflow: async (params) => {
          throw new Error(`unexpected failWorkflow: ${JSON.stringify(params)}`);
        }
      },
      defaultCategory: "General"
    });

    const result = await workflow.run({ topic: "Fake topic" });

    expect(result.status).toBe("failed");
    expect(result.failure).toEqual({
      step: "publisher",
      code: "validation_failed",
      message: "Publisher validation failed"
    });
    expect(finished).toHaveLength(1);
    expect(finished[0]).toMatchObject({
      status: "failed",
      failedStep: "publisher",
      errorCode: "validation_failed",
      editedText: "Edited body"
    });
  });

  it("records the failing step when a step throws", async () => {
    const failures: Array<Record<string, unknown>> = [];
    const logger = { info() {}, warn() {}, error() {}, debug() {} };

    const workflow = createArticleGenerationWorkflow({
      logger,
      quality: lenientQuality,
      publicationPolicy: "publish_if_gate_passes",
      llm: scriptedProvider(JSON.stringify(["Intro"]), "   "),
      publisher: { publish: async () => ({ success: true, publisherId: "f", publisherName: "F" }) },
      memory: {
        beginWorkflow: async () => ({
          workflowId: "wf-3",
          isDuplicate: false,
          duplicateOfWorkflowId: null
        }),
        savePrompt: async () => {},
        markRunning: async () => {},
        finishWorkflow: async () => {},
        loadWorkflow: async () => null,
        markDuplicate: async () => {},
        findDuplicateArticle: async () => null,
        markDuplicate: async () => {},
        findDuplicateArticle: async () => null,
        recordStep: async () => {},
        failWorkflow: async (params) => {
          failures.push(params);
        }
      }
    });

    await expect(workflow.run({ topic: "Fake topic" })).rejects.toBeInstanceOf(WorkflowStepError);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ failedStep: expect.any(String) });
  });
});
