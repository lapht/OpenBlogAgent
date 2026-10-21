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

import type { LlmPort, MemoryPort, PublishPort, StoredWorkflowStep, TaxonomyPort } from "../ports";

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

/** What a caller provides; every other field of the workflow state is produced by a step. */
export const articleWorkflowInputSchema = z.object({
  topic: z.string().trim().min(1)
});

export type ArticleWorkflowInput = z.infer<typeof articleWorkflowInputSchema>;

const nonEmptyTextSchema = z.string().trim().min(1);
const classificationSchema = z.object({
  category: nonEmptyTextSchema,
  tags: z.array(z.string())
});

/** `needs_review` is reserved for quality-gate outcomes; nothing produces it yet. */
export type WorkflowRunStatus = "published" | "needs_review" | "failed";

export interface WorkflowFailure {
  step: string;
  code: string;
  message: string;
}

/** Thrown when a workflow step fails; carries the step so the run can be recorded as failed there. */
export class WorkflowStepError extends Error {
  readonly step: string;
  readonly code: string;

  constructor(step: string, cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(`${step} step failed: ${message}`, { cause });
    this.name = "WorkflowStepError";
    this.step = step;
    this.code = errorCode(cause);
  }
}

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && code.length > 0) {
    return code;
  }
  return error instanceof Error && error.name !== "Error" ? error.name : "step_failed";
}

interface ArticleWorkflowOutput {
  article: string;
  category: string;
  editedText: string;
  seoOutput: SeoOutput;
  tags: string[];
  topic: string;
}

/** The publisher confirmed the publication. */
export interface PublishedWorkflowResult extends ArticleWorkflowOutput {
  status: "published";
  failure?: undefined;
  publishResult: PublishResult;
}

/** Every step ran but the publisher did not confirm; the generated article is still returned. */
export interface FailedWorkflowResult extends ArticleWorkflowOutput {
  status: "failed";
  failure: WorkflowFailure;
  publishResult?: PublishResult;
}

export type ArticleWorkflowResult = PublishedWorkflowResult | FailedWorkflowResult;

export interface ArticleGenerationWorkflow {
  readonly name: typeof ARTICLE_GENERATION_WORKFLOW_NAME;
  run(input: ArticleWorkflowInput): Promise<ArticleWorkflowResult>;
  /** Continues a run that did not publish, reusing the stored output of its completed steps. */
  resume(workflowId: string): Promise<ArticleWorkflowResult>;
}

export type WorkflowResumeErrorCode = "memory_unavailable" | "not_found" | "already_published";

/** Thrown when a run cannot be resumed; nothing is executed or changed. */
export class WorkflowResumeError extends Error {
  readonly code: WorkflowResumeErrorCode;

  constructor(code: WorkflowResumeErrorCode, message: string) {
    super(message);
    this.name = "WorkflowResumeError";
    this.code = code;
  }
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

/** Fields of steps that have not run yet are `undefined`. */
function optional<T>() {
  return Annotation<T | undefined>({
    default: () => undefined,
    reducer: (_, update) => update
  });
}

const graphState = Annotation.Root({
  topic: Annotation<string>(),
  workflowId: optional<string>(),
  outline: optional<string[]>(),
  article: optional<string>(),
  editedText: optional<string>(),
  seoOutput: optional<SeoOutput>(),
  category: optional<string>(),
  tags: optional<string[]>(),
  publishResult: optional<PublishResult>(),
  /** Steps restored from a previous run; their nodes are skipped. */
  completedSteps: optional<string[]>()
});

export type ArticleWorkflowState = typeof graphState.State;
type ArticleWorkflowUpdate = typeof graphState.Update;

/** Shape of what each step stores, used to restore state when a run is resumed. */
const stepOutputSchemas: Record<string, z.ZodType<ArticleWorkflowUpdate, z.ZodTypeDef, unknown>> = {
  planner: z.object({ outline: plannerOutlineSchema }),
  writer: z.object({ article: nonEmptyTextSchema }),
  editor: z.object({ editedText: nonEmptyTextSchema }),
  seo: z.object({ seoOutput: seoOutputSchema }),
  classification: classificationSchema,
  publisher: z.object({ publishResult: publishResultSchema })
};

/** State rebuilt from the latest successful execution of each stored step. */
function restoreState(steps: StoredWorkflowStep[]): ArticleWorkflowUpdate {
  const latest = new Map<string, StoredWorkflowStep>();
  for (const stored of steps) {
    if (stored.status === "succeeded") {
      latest.set(stored.step, stored);
    }
  }

  const restored: ArticleWorkflowUpdate = {};
  const completedSteps: string[] = [];
  for (const [name, stored] of latest) {
    const schema = stepOutputSchemas[name];
    if (!schema) {
      continue;
    }
    const output = schema.parse(stored.output);
    // A publish the publisher rejected is stored as an output but is not a completed step.
    if (output.publishResult && !output.publishResult.success) {
      continue;
    }
    Object.assign(restored, output);
    completedSteps.push(name);
  }

  return { ...restored, completedSteps };
}

/** Reads a field a previous step must have produced; a miss is a wiring bug, not user input. */
function required<T>(value: T | undefined, field: string): T {
  if (value === undefined) {
    throw new Error(`Workflow state is missing "${field}"`);
  }
  return value;
}

/** The article as it should be published: the edited text once the editor has run. */
function currentArticle(state: ArticleWorkflowState): string {
  return state.editedText ?? required(state.article, "article");
}

interface StepContext {
  logger: ILogger;
  memory?: MemoryPort;
}

/** Wraps a node: failures carry the step name and every execution is recorded with its output. */
function step(
  name: string,
  { logger, memory }: StepContext,
  fn: (state: ArticleWorkflowState) => Promise<ArticleWorkflowUpdate>
): (state: ArticleWorkflowState) => Promise<ArticleWorkflowUpdate> {
  const record = async (
    state: ArticleWorkflowState,
    startedAt: string,
    result: { output: ArticleWorkflowUpdate } | { error: WorkflowStepError }
  ): Promise<void> => {
    if (!memory || !state.workflowId) {
      return;
    }
    try {
      await memory.recordStep({
        workflowId: state.workflowId,
        step: name,
        startedAt,
        completedAt: new Date().toISOString(),
        ...("output" in result
          ? { status: "succeeded", output: result.output }
          : {
              status: "failed",
              errorCode: result.error.code,
              errorMessage: result.error.message
            })
      });
    } catch (error) {
      // Step artifacts are an audit trail; losing one must not fail the run.
      logger.warn("Could not record workflow step", {
        step: name,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  };

  return async (state) => {
    if (state.completedSteps?.includes(name)) {
      logger.info("Skipping step completed in a previous attempt", { step: name });
      return {};
    }

    const startedAt = new Date().toISOString();
    try {
      const output = await fn(state);
      await record(state, startedAt, { output });
      return output;
    } catch (error) {
      const stepError =
        error instanceof WorkflowStepError ? error : new WorkflowStepError(name, error);
      await record(state, startedAt, { error: stepError });
      throw stepError;
    }
  };
}

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

  const stepContext: StepContext = { logger, memory };

  const workflow = new StateGraph(graphState)
    .addNode(
      "planner",
      step("planner", stepContext, async (state) => {
        const input = { topic: state.topic };

        if (memory && state.workflowId) {
          await memory.savePrompt({
            workflowId: state.workflowId,
            promptType: "planner",
            content: plannerAgent.buildPrompt(input)
          });
        }

        const outline = plannerOutlineSchema.parse(await plannerAgent.run(input));

        logger.info("Planner output ready", { outline, topic: state.topic });

        return { outline };
      })
    )
    .addNode(
      "writer",
      step("writer", stepContext, async (state) => {
        const input = { topic: state.topic, outline: required(state.outline, "outline") };

        if (memory && state.workflowId) {
          await memory.savePrompt({
            workflowId: state.workflowId,
            promptType: "writer",
            content: writerAgent.buildPrompt(input)
          });
        }

        const article = nonEmptyTextSchema.parse(await writerAgent.run(input));

        logger.info("Writer output ready", { articleLength: article.length, topic: state.topic });

        return { article };
      })
    )
    .addNode(
      "editor",
      step("editor", stepContext, async (state) => {
        const editorOutput = await editorAgent.run({
          rawText: required(state.article, "article")
        });
        const editedText = nonEmptyTextSchema.parse(editorOutput.editedText);

        logger.info("Editor output ready", {
          changesSummary: editorOutput.changesSummary,
          topic: state.topic
        });

        return { editedText };
      })
    )
    .addNode(
      "seo",
      step("seo", stepContext, async (state) => {
        const seoOutput = seoOutputSchema.parse(
          await seoAgent.run({
            outline: required(state.outline, "outline"),
            articleText: currentArticle(state)
          })
        );

        logger.info("SEO output ready", { slug: seoOutput.slug, topic: state.topic });

        return { seoOutput };
      })
    )
    .addNode(
      "classification",
      step("classification", stepContext, async (state) => {
        const availableCategories = taxonomy ? await taxonomy.listCategories() : [defaultCategory];
        const availableTags = taxonomy ? await taxonomy.listTags() : [];

        const { category, tags } = classificationSchema.parse(
          await classificationAgent.run({
            articleText: currentArticle(state),
            availableCategories,
            availableTags,
            maxTags
          })
        );

        logger.info("Classification output ready", { category, tags, topic: state.topic });

        return { category, tags };
      })
    )
    .addNode(
      "publisher",
      step("publisher", stepContext, async (state) => {
        const seoOutput = required(state.seoOutput, "seoOutput");

        const articleForPublishing: PublishArticle = {
          title: seoOutput.title,
          slug: seoOutput.slug,
          summary: seoOutput.metaDescription,
          content: currentArticle(state),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          tags: required(state.tags, "tags"),
          category: required(state.category, "category"),
          author: "OpenBlogAgent",
          language: "en"
        };

        // The publisher manager logs the outcome; the run's status is decided in `run`.
        const publishResult = publishResultSchema.parse(
          await publisher.publish(articleForPublishing)
        );

        return { publishResult };
      })
    )
    .addEdge(START, "planner")
    .addEdge("planner", "writer")
    .addEdge("writer", "editor")
    .addEdge("editor", "seo")
    .addEdge("seo", "classification")
    .addEdge("classification", "publisher")
    .addEdge("publisher", END)
    .compile();

  async function execute(
    topic: string,
    workflowMemory: { workflowId: string } | null,
    restored: ArticleWorkflowUpdate = {}
  ): Promise<ArticleWorkflowResult> {
    logger.info("Starting article workflow", {
      topic,
      workflow: ARTICLE_GENERATION_WORKFLOW_NAME
    });

    try {
      if (memory && workflowMemory) {
        await memory.markRunning(workflowMemory.workflowId);
      }

      const finalState = await workflow.invoke({
        ...restored,
        topic,
        workflowId: workflowMemory?.workflowId
      });

      const output: ArticleWorkflowOutput = {
        article: required(finalState.article, "article"),
        category: required(finalState.category, "category"),
        editedText: required(finalState.editedText, "editedText"),
        seoOutput: required(finalState.seoOutput, "seoOutput"),
        tags: required(finalState.tags, "tags"),
        topic: finalState.topic
      };
      const publishResult = finalState.publishResult;
      const failure: WorkflowFailure | undefined = publishResult?.success
        ? undefined
        : {
            step: "publisher",
            code: publishResult?.error?.code ?? "publish_failed",
            message: publishResult?.error?.message ?? "Publisher did not confirm the publication"
          };
      const status: WorkflowRunStatus = failure ? "failed" : "published";

      if (memory && workflowMemory) {
        await memory.finishWorkflow({
          workflowId: workflowMemory.workflowId,
          status,
          ...output,
          publishResult: publishResult && { ...publishResult },
          failedStep: failure?.step,
          errorCode: failure?.code,
          errorMessage: failure?.message
        });
      }

      if (failure) {
        logger.error("Article workflow failed", {
          topic,
          workflow: ARTICLE_GENERATION_WORKFLOW_NAME,
          failedStep: failure.step,
          errorCode: failure.code,
          error: failure.message
        });
      } else {
        logger.info("Article workflow completed", {
          articleLength: output.article.length,
          topic,
          workflow: ARTICLE_GENERATION_WORKFLOW_NAME
        });
      }

      return failure
        ? { ...output, status: "failed", failure, publishResult }
        : {
            ...output,
            status: "published",
            publishResult: required(publishResult, "publishResult")
          };
    } catch (error) {
      if (memory && workflowMemory) {
        await memory.failWorkflow({
          workflowId: workflowMemory.workflowId,
          errorMessage: error instanceof Error ? error.message : String(error),
          failedStep: error instanceof WorkflowStepError ? error.step : undefined,
          errorCode: error instanceof WorkflowStepError ? error.code : undefined
        });
      }

      throw error;
    }
  }

  return {
    name: ARTICLE_GENERATION_WORKFLOW_NAME,
    async run(input: ArticleWorkflowInput): Promise<ArticleWorkflowResult> {
      const { topic } = articleWorkflowInputSchema.parse(input);
      const workflowMemory = memory
        ? await memory.beginWorkflow({
            workflowName: ARTICLE_GENERATION_WORKFLOW_NAME,
            topic
          })
        : null;

      if (workflowMemory?.isDuplicate) {
        logger.warn("Duplicate topic detected", {
          topic,
          duplicateOfWorkflowId: workflowMemory.duplicateOfWorkflowId
        });
      }

      return execute(topic, workflowMemory);
    },

    async resume(workflowId: string): Promise<ArticleWorkflowResult> {
      if (!memory) {
        throw new WorkflowResumeError(
          "memory_unavailable",
          "Resuming a run requires a memory store"
        );
      }
      const stored = await memory.loadWorkflow(workflowId);
      if (!stored) {
        throw new WorkflowResumeError("not_found", `Workflow ${workflowId} was not found`);
      }
      if (stored.status === "published") {
        throw new WorkflowResumeError(
          "already_published",
          `Workflow ${workflowId} is already published`
        );
      }

      const restored = restoreState(stored.steps);
      logger.info("Resuming article workflow", {
        workflowId,
        topic: stored.topic,
        completedSteps: restored.completedSteps
      });

      return execute(stored.topic, { workflowId }, restored);
    }
  };
}
