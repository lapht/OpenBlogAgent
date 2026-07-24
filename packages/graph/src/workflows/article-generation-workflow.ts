import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import {
  createClassificationAgent,
  createEditorAgent,
  createSeoAgent,
  type SeoOutput,
  seoOutputSchema
} from "@openblog/agents";
import type { ILogger } from "@openblog/logger";
import type { TextGenerationProvider } from "@openblog/providers";
import {
  DefaultPublisherManager,
  type ICategoryProvider,
  type IPublisher,
  type ITagProvider,
  type PublishArticle,
  type PublishResult
} from "@openblog/publishers";
import { z } from "zod";

export const ARTICLE_GENERATION_WORKFLOW_NAME = "article-generation-workflow" as const;

export const plannerOutlineSchema = z.array(z.string().min(1)).min(3);

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

export interface WorkflowMemoryService {
  beginWorkflow(params: {
    workflowName: string;
    topic: string;
    metadata?: Record<string, unknown>;
  }): Promise<{
    workflowId: string;
    isDuplicate: boolean;
    duplicateOfWorkflowId: string | null;
  }>;
  savePrompt(params: {
    workflowId: string;
    promptType: "planner" | "writer";
    content: string;
  }): Promise<void>;
  completeWorkflow(params: {
    workflowId: string;
    topic: string;
    article: string;
    editedText: string;
    seoOutput: Record<string, unknown>;
    category: string;
    tags: string[];
    publishResult?: Record<string, unknown>;
  }): Promise<void>;
  failWorkflow(params: { workflowId: string; errorMessage: string }): Promise<void>;
}

export interface ArticleGenerationWorkflow {
  readonly name: typeof ARTICLE_GENERATION_WORKFLOW_NAME;
  run(input: ArticleWorkflowState): Promise<ArticleWorkflowResult>;
}

export interface CreateArticleGenerationWorkflowOptions {
  logger: ILogger;
  provider: TextGenerationProvider;
  memoryService?: WorkflowMemoryService;
  publishers?: IPublisher[];
  defaultPublisherId?: string;
  categoryProvider?: ICategoryProvider;
  tagProvider?: ITagProvider;
  taxonomyConfig?: {
    allowCreate: boolean;
    defaultCategory: string;
    maxTags: number;
    cacheTtlSeconds: number;
  };
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

function buildPlannerPrompt(topic: string): string {
  return [
    "You are a pragmatic content strategist.",
    `Create a simple and practical article outline for the topic: ${topic}`,
    "Return valid JSON only.",
    'Use this exact shape: ["Section title", "Section title"]',
    "Create 4 to 6 sections maximum.",
    "Avoid overly broad, academic, or redundant sections.",
    "The outline should be suitable for a clear blog post, not a long-form essay.",
    "Include an introduction and a conclusion through the section titles."
  ].join("\n");
}

function buildWriterPrompt(topic: string, outline: string[]): string {
  return [
    "You are a clear and concise technical blog writer.",
    `Write a Markdown article about: ${topic}`,
    "Requirements:",
    "- Do not include an H1 title.",
    "- Start directly with the introduction.",
    "- Use H2 sections aligned with the outline.",
    "- Keep the article between 1200 and 1,800 words.",
    "- Write in a clear, practical, human tone.",
    "- Prefer short paragraphs and simple explanations.",
    "- Avoid unnecessary depth, filler, repetition, and academic style.",
    "- If the topic is technical, explain only what is useful to the reader.",
    "- End with a short practical conclusion.",
    "Outline:",
    ...outline.map((section, index) => `${index + 1}. ${section}`)
  ].join("\n");
}

function extractJsonArray(raw: string): string[] {
  const trimmed = raw.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch?.[1]?.trim() ?? trimmed;
  const startIndex = candidate.indexOf("[");
  const endIndex = candidate.lastIndexOf("]");

  if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) {
    throw new Error("Planner response did not contain a JSON array");
  }

  const parsed = JSON.parse(candidate.slice(startIndex, endIndex + 1)) as unknown;
  return plannerOutlineSchema.parse(parsed);
}

export function createArticleGenerationWorkflow(
  options: CreateArticleGenerationWorkflowOptions
): ArticleGenerationWorkflow {
  const {
    logger,
    provider,
    memoryService,
    publishers = [],
    defaultPublisherId,
    categoryProvider,
    tagProvider,
    taxonomyConfig
  } = options;

  const editorAgent = createEditorAgent(provider);
  const seoAgent = createSeoAgent(provider);
  const classificationAgent = createClassificationAgent(provider);
  const publisherManager = new DefaultPublisherManager(logger, publishers, {
    defaultPublisherId
  });

  const workflow = new StateGraph(graphState)
    .addNode("planner", async (state: ArticleWorkflowState) => {
      const parsedState = articleWorkflowStateSchema.parse(state) as ArticleWorkflowState;
      const plannerPrompt = buildPlannerPrompt(parsedState.topic);

      if (memoryService && parsedState.workflowId) {
        await memoryService.savePrompt({
          workflowId: parsedState.workflowId,
          promptType: "planner",
          content: plannerPrompt
        });
      }

      const plannerRawOutput = await provider.generate(plannerPrompt);
      const outline = extractJsonArray(plannerRawOutput);

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

      const writerPrompt = buildWriterPrompt(parsedState.topic, parsedState.outline);
      if (memoryService && parsedState.workflowId) {
        await memoryService.savePrompt({
          workflowId: parsedState.workflowId,
          promptType: "writer",
          content: writerPrompt
        });
      }

      const article = (await provider.generate(writerPrompt)).trim();

      if (article.length === 0) {
        throw new Error("Writer returned an empty article");
      }

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

      const availableCategories = categoryProvider
        ? (await categoryProvider.list()).map((category) => category.name)
        : [taxonomyConfig?.defaultCategory ?? "General"];

      const availableTags = tagProvider ? (await tagProvider.list()).map((tag) => tag.name) : [];

      const classificationOutput = await classificationAgent.run({
        articleText: parsedState.editedText || parsedState.article,
        availableCategories,
        availableTags,
        maxTags: taxonomyConfig?.maxTags ?? 5
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
        category: parsedState.category || taxonomyConfig?.defaultCategory || "General",
        author: "OpenBlogAgent",
        language: "en"
      };

      const publishResult = await publisherManager.publish(articleForPublishing);
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
      const workflowMemory = memoryService
        ? await memoryService.beginWorkflow({
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

        if (memoryService && workflowMemory) {
          await memoryService.completeWorkflow({
            workflowId: workflowMemory.workflowId,
            topic: finalState.topic,
            article: finalState.article,
            editedText: finalState.editedText || finalState.article,
            seoOutput: (finalState.seoOutput ?? {}) as Record<string, unknown>,
            category: finalState.category || taxonomyConfig?.defaultCategory || "General",
            tags: finalState.tags || [],
            publishResult: (finalState.publishResult as Record<string, unknown> | undefined) ?? undefined
          });
        }

        logger.info("Article workflow completed", {
          articleLength: finalState.article.length,
          topic: finalState.topic,
          workflow: ARTICLE_GENERATION_WORKFLOW_NAME
        });

        return {
          article: finalState.article,
          category: finalState.category || taxonomyConfig?.defaultCategory || "General",
          editedText: finalState.editedText || finalState.article,
          seoOutput: finalState.seoOutput as SeoOutput,
          tags: finalState.tags || [],
          topic: finalState.topic,
          publishResult: finalState.publishResult as PublishResult | undefined
        };
      } catch (error) {
        if (memoryService && workflowMemory) {
          await memoryService.failWorkflow({
            workflowId: workflowMemory.workflowId,
            errorMessage: error instanceof Error ? error.message : String(error)
          });
        }

        throw error;
      }
    }
  };
}
