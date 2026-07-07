import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { ILogger } from "@openblog/logger";
import { createEditorAgent, type SeoOutput, createSeoAgent, seoOutputSchema } from "@openblog/agents";
import type { TextGenerationProvider } from "@openblog/providers";
import { DefaultPublisherManager, type IPublisher, type PublishArticle, type PublishResult } from "@openblog/publishers";
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
  editedText: z.string().optional(),
  seoOutput: z.union([seoOutputSchema, emptySeoOutputSchema]).optional(),
  outline: z.array(z.string()),
  publishResult: publishResultSchema.optional(),
  topic: z.string().min(1)
});

export type ArticleWorkflowState = z.infer<typeof articleWorkflowStateSchema>;

export interface ArticleWorkflowResult {
  article: string;
  editedText: string;
  seoOutput: SeoOutput;
  topic: string;
  publishResult?: PublishResult;
}

export interface ArticleGenerationWorkflow {
  readonly name: typeof ARTICLE_GENERATION_WORKFLOW_NAME;
  run(input: ArticleWorkflowState): Promise<ArticleWorkflowResult>;
}

export interface CreateArticleGenerationWorkflowOptions {
  logger: ILogger;
  provider: TextGenerationProvider;
  publishers?: IPublisher[];
  defaultPublisherId?: string;
}

const graphState = Annotation.Root({
  article: Annotation<string>({
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
  topic: Annotation<string>({
    default: () => "",
    reducer: (_, update) => update
  })
});

function buildPlannerPrompt(topic: string): string {
  return [
    "You are a senior content strategist.",
    `Create a logical article outline for the topic: ${topic}`,
    "Return valid JSON only.",
    'Use this exact shape: ["Section title", "Section title"]',
    "The outline must be detailed, non-redundant, and ordered for a long-form article.",
    "Include an introduction, core sections, and a conclusion through the section titles."
  ].join("\n");
}

function buildWriterPrompt(topic: string, outline: string[]): string {
  return [
    "You are a senior technical writer.",
    `Write a complete Markdown article about: ${topic}`,
    "Requirements:",
    "- Start with a strong SEO-friendly H1 title.",
    "- Use clear H2 sections aligned with the outline.",
    "- Write in a competent, human, non-repetitive tone.",
    "- Be substantial but avoid filler.",
    "- End with a practical conclusion.",
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
  const { logger, provider, publishers = [], defaultPublisherId } = options;

  const editorAgent = createEditorAgent(provider);
  const seoAgent = createSeoAgent(provider);
  const publisherManager = new DefaultPublisherManager(logger, publishers, {
    defaultPublisherId
  });

  const workflow = new StateGraph(graphState)
    .addNode("planner", async (state: ArticleWorkflowState) => {
      const parsedState = articleWorkflowStateSchema.parse(state) as ArticleWorkflowState;
      const plannerPrompt = buildPlannerPrompt(parsedState.topic);

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
        tags: [],
        category: "General",
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
    .addEdge("seo", "publisher")
    .addEdge("publisher", END)
    .compile();

  return {
    name: ARTICLE_GENERATION_WORKFLOW_NAME,
    async run(input: ArticleWorkflowState): Promise<ArticleWorkflowResult> {
      const initialState = articleWorkflowStateSchema.parse(input) as ArticleWorkflowState;
      logger.info("Starting article workflow", {
        topic: initialState.topic,
        workflow: ARTICLE_GENERATION_WORKFLOW_NAME
      });

      const finalState = articleWorkflowStateSchema.parse(
        await workflow.invoke(initialState)
      ) as ArticleWorkflowState;

      logger.info("Article workflow completed", {
        articleLength: finalState.article.length,
        topic: finalState.topic,
        workflow: ARTICLE_GENERATION_WORKFLOW_NAME
      });

      return {
        article: finalState.article,
        editedText: finalState.editedText || finalState.article,
        seoOutput: finalState.seoOutput as SeoOutput,
        topic: finalState.topic,
        publishResult: finalState.publishResult as PublishResult | undefined
      };
    }
  };
}
