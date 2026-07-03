import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { ILogger } from "@openblog/logger";
import type { TextGenerationProvider } from "@openblog/providers";
import { z } from "zod";

export const ARTICLE_GENERATION_WORKFLOW_NAME = "article-generation-workflow" as const;

export const plannerOutlineSchema = z.array(z.string().min(1)).min(3);

export const articleWorkflowStateSchema = z.object({
  article: z.string(),
  outline: z.array(z.string()),
  topic: z.string().min(1)
});

export type ArticleWorkflowState = z.infer<typeof articleWorkflowStateSchema>;

export interface ArticleWorkflowResult {
  article: string;
  topic: string;
}

export interface ArticleGenerationWorkflow {
  readonly name: typeof ARTICLE_GENERATION_WORKFLOW_NAME;
  run(input: ArticleWorkflowState): Promise<ArticleWorkflowResult>;
}

export interface CreateArticleGenerationWorkflowOptions {
  logger: ILogger;
  provider: TextGenerationProvider;
}

const graphState = Annotation.Root({
  article: Annotation<string>({
    default: () => "",
    reducer: (_, update) => update
  }),
  outline: Annotation<string[]>({
    default: () => [],
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
  const { logger, provider } = options;

  const workflow = new StateGraph(graphState)
    .addNode("planner", async (state: ArticleWorkflowState) => {
      const parsedState = articleWorkflowStateSchema.parse(state);
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
        .parse(state);

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
    .addEdge(START, "planner")
    .addEdge("planner", "writer")
    .addEdge("writer", END)
    .compile();

  return {
    name: ARTICLE_GENERATION_WORKFLOW_NAME,
    async run(input: ArticleWorkflowState): Promise<ArticleWorkflowResult> {
      const initialState = articleWorkflowStateSchema.parse(input);
      logger.info("Starting article workflow", {
        topic: initialState.topic,
        workflow: ARTICLE_GENERATION_WORKFLOW_NAME
      });

      const finalState = articleWorkflowStateSchema.parse(await workflow.invoke(initialState));

      logger.info("Article workflow completed", {
        articleLength: finalState.article.length,
        topic: finalState.topic,
        workflow: ARTICLE_GENERATION_WORKFLOW_NAME
      });

      return {
        article: finalState.article,
        topic: finalState.topic
      };
    }
  };
}
