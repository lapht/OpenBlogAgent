import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import {
  createClassificationAgent,
  createEditorAgent,
  createPlannerAgent,
  createSeoAgent,
  createWriterAgent,
  plannerOutlineSchema,
  type SeoOutput,
  seoOutputSchema
} from "@openblog/agents";
import type { ILogger } from "@openblog/logger";
import type { PublishArticle, PublishResult } from "@openblog/publishers";
import { z } from "zod";

import type { LlmPort, MemoryPort, PublishPort, TaxonomyPort } from "../ports";

export const ARTICLE_GENERATION_WORKFLOW_NAME = "article-generation-workflow" as const;

const publishResultSchema = z.object({
  success: z.boolean(),
  publisherId: z.string(),
  publisherName: z.string(),
  outputPath: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      details: z.record(z.unknown()).optional()
    })
    .optional()
});

const emptySeoOutputSchema = z.object({}).passthrough();

export const articleWorkflowStateSchema = z.object({
  article: z.string(),
  category: z.string().default(""),
  editedText: z.string().optional(),
  seoOutput: z.union([seoOutputSchema, emptySeoOutputSchema]).optional(),
  outline: z.array(z.string()),
  publishResult: publishResultSchema.optional(),
  tags: z.array(z.string()).default([]),
  topic: z.string().min(1),
  workflowId: z.string().optional()
});

export type ArticleWorkflowState = z.infer<typeof articleWorkflowStateSchema>;

export interface ArticleWorkflowResult {
  article: string;
  category: string;
  editedText: string;
  seoOutput: SeoOutput;
  tags: string[];
  topic: string;
  publishResult?: PublishResult;
}

export interface ArticleGenerationWorkflow {
  readonly name: typeof ARTICLE_GENERATION_WORKFLOW_NAME;
  run(input: ArticleWorkflowState): Promise<ArticleWorkflowResult>;
}

export interface CreateArticleGenerationWorkflowOptions {
  logger: ILogger;
  llm: LlmPort;
  publisher: PublishPort;
  taxonomy?: TaxonomyPort;
  memory?: MemoryPort;
  /** Category used when the classifier has none to choose from. Defaults to "General". */
  defaultCategory?: string;
  /** Maximum number of tags the classifier may return. Defaults to 5. */
  maxTags?: number;
}

const graphState = Annotation.Root({
  article: Annotation<string>({
    default: () => "",
    reducer: (_, update) => update
  }),
  category: Annotation<string>({
    default: () => "",
    reducer: (_, update) => update
  }),
  editedText: Annotation<string>({
    default: () => "",
    reducer: (_, update) => update
  }),
  seoOutput: Annotation<unknown>({
    default: () => undefined,
    reducer: (_, update) => update
  }),
  outline: Annotation<string[]>({
    default: () => [],
    reducer: (_, update) => update
  }),
  publishResult: Annotation<unknown>({
    default: () => undefined,
    reducer: (_, update) => update
  }),
  tags: Annotation<string[]>({
    default: () => [],
    reducer: (_, update) => update
  }),
  topic: Annotation<string>({
    default: () => "",
    reducer: (_, update) => update
  }),
  workflowId: Annotation<string | undefined>({
    default: () => undefined,
    reducer: (_, update) => update
  })
});

export function createArticleGenerationWorkflow(
  options: CreateArticleGenerationWorkflowOptions
): ArticleGenerationWorkflow {
  const { logger, llm, publisher, taxonomy, memory, maxTags = 5 } = options;
  const defaultCategory = options.defaultCategory ?? "General";

  const plannerAgent = createPlannerAgent(llm);
  const writerAgent = createWriterAgent(llm);
  const editorAgent = createEditorAgent(llm);
  const seoAgent = createSeoAgent(llm);
  const classificationAgent = createClassificationAgent(llm);

  const workflow = new StateGraph(graphState)
    .addNode("planner", async (state: ArticleWorkflowState) => {
      const parsedState = articleWorkflowStateSchema.parse(state) as ArticleWorkflowState;
      const input = { topic: parsedState.topic };

      if (memory && parsedState.workflowId) {
        await memory.savePrompt({
          workflowId: parsedState.workflowId,
          promptType: "planner",
          content: plannerAgent.buildPrompt(input)
        });
      }

      const outline = await plannerAgent.run(input);

      logger.info("Planner output ready", {
        outline,
        topic: parsedState.topic
      });

      return { outline };
    })
    .addNode("writer", async (state: ArticleWorkflowState) => {
      const parsedState = articleWorkflowStateSchema
        .extend({
          outline: plannerOutlineSchema
        })
        .parse(state) as ArticleWorkflowState;
      const input = { topic: parsedState.topic, outline: parsedState.outline };

      if (memory && parsedState.workflowId) {
        await memory.savePrompt({
          workflowId: parsedState.workflowId,
          promptType: "writer",
          content: writerAgent.buildPrompt(input)
        });
      }

      const article = await writerAgent.run(input);

      logger.info("Writer output ready", {
        articleLength: article.length,
        topic: parsedState.topic
      });

      return { article };
    })
    .addNode("editor", async (state: ArticleWorkflowState) => {
      const parsedState = articleWorkflowStateSchema.parse(state) as ArticleWorkflowState;
      const editorOutput = await editorAgent.run({ rawText: parsedState.article });

      logger.info("Editor output ready", {
        changesSummary: editorOutput.changesSummary,
        topic: parsedState.topic
      });

      return { editedText: editorOutput.editedText };
    })
    .addNode("seo", async (state: ArticleWorkflowState) => {
      const parsedState = articleWorkflowStateSchema.parse(state) as ArticleWorkflowState;
      const seoOutput = await seoAgent.run({
        outline: parsedState.outline,
        articleText: parsedState.editedText || parsedState.article
      });

      logger.info("SEO output ready", {
        slug: seoOutput.slug,
        topic: parsedState.topic
      });

      return { seoOutput };
    })
    .addNode("classification", async (state: ArticleWorkflowState) => {
      const parsedState = articleWorkflowStateSchema.parse(state) as ArticleWorkflowState;

      const availableCategories = taxonomy ? await taxonomy.listCategories() : [defaultCategory];
      const availableTags = taxonomy ? await taxonomy.listTags() : [];

      const classificationOutput = await classificationAgent.run({
        articleText: parsedState.editedText || parsedState.article,
        availableCategories,
        availableTags,
        maxTags
      });

      logger.info("Classification output ready", {
        category: classificationOutput.category,
        tags: classificationOutput.tags,
        topic: parsedState.topic
      });

      return {
        category: classificationOutput.category,
        tags: classificationOutput.tags
      };
    })
    .addNode("publisher", async (state: ArticleWorkflowState) => {
      const parsedState = articleWorkflowStateSchema.parse(state) as ArticleWorkflowState;
      const seoOutput = parsedState.seoOutput as SeoOutput | undefined;

      const articleForPublishing: PublishArticle = {
        title: seoOutput?.title ?? parsedState.topic,
        slug: seoOutput?.slug ?? parsedState.topic,
        summary: seoOutput?.metaDescription ?? parsedState.topic,
        content: parsedState.editedText || parsedState.article,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        tags: parsedState.tags,
        category: parsedState.category || defaultCategory,
        author: "OpenBlogAgent",
        language: "en"
      };

      const publishResult = await publisher.publish(articleForPublishing);
      logger.info("Publishing completed", {
        slug: articleForPublishing.slug,
        success: publishResult.success
      });

      return { publishResult };
    })
    .addEdge(START, "planner")
    .addEdge("planner", "writer")
    .addEdge("writer", "editor")
    .addEdge("editor", "seo")
    .addEdge("seo", "classification")
    .addEdge("classification", "publisher")
    .addEdge("publisher", END)
    .compile();

  return {
    name: ARTICLE_GENERATION_WORKFLOW_NAME,
    async run(input: ArticleWorkflowState): Promise<ArticleWorkflowResult> {
      const parsedInput = articleWorkflowStateSchema.parse(input) as ArticleWorkflowState;
      const workflowMemory = memory
        ? await memory.beginWorkflow({
            workflowName: ARTICLE_GENERATION_WORKFLOW_NAME,
            topic: parsedInput.topic
          })
        : null;

      if (workflowMemory?.isDuplicate) {
        logger.warn("Duplicate topic detected", {
          topic: parsedInput.topic,
          duplicateOfWorkflowId: workflowMemory.duplicateOfWorkflowId
        });
      }

      const initialState = {
        ...parsedInput,
        workflowId: workflowMemory?.workflowId
      } as ArticleWorkflowState;

      logger.info("Starting article workflow", {
        topic: initialState.topic,
        workflow: ARTICLE_GENERATION_WORKFLOW_NAME
      });

      try {
        const finalState = articleWorkflowStateSchema.parse(
          await workflow.invoke(initialState)
        ) as ArticleWorkflowState;

        if (memory && workflowMemory) {
          await memory.completeWorkflow({
            workflowId: workflowMemory.workflowId,
            topic: finalState.topic,
            article: finalState.article,
            editedText: finalState.editedText || finalState.article,
            seoOutput: (finalState.seoOutput ?? {}) as Record<string, unknown>,
            category: finalState.category || defaultCategory,
            tags: finalState.tags || [],
            publishResult:
              (finalState.publishResult as Record<string, unknown> | undefined) ?? undefined
          });
        }

        logger.info("Article workflow completed", {
          articleLength: finalState.article.length,
          topic: finalState.topic,
          workflow: ARTICLE_GENERATION_WORKFLOW_NAME
        });

        return {
          article: finalState.article,
          category: finalState.category || defaultCategory,
          editedText: finalState.editedText || finalState.article,
          seoOutput: finalState.seoOutput as SeoOutput,
          tags: finalState.tags || [],
          topic: finalState.topic,
          publishResult: finalState.publishResult as PublishResult | undefined
        };
      } catch (error) {
        if (memory && workflowMemory) {
          await memory.failWorkflow({
            workflowId: workflowMemory.workflowId,
            errorMessage: error instanceof Error ? error.message : String(error)
          });
        }

        throw error;
      }
    }
  };
}
