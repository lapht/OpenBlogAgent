import { describe, expect, it } from "vitest";

import { articleWorkflowStateSchema } from "../../packages/graph/src/workflows/article-generation-workflow";

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
