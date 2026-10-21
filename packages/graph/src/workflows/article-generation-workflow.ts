import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import {
  createClassificationAgent,
  createEditorAgent,
  createEditorialReviewAgent,
  createPlannerAgent,
  createSeoAgent,
  createWriterAgent,
  type ArticleValidationRules,
  type EditorialReview,
  formatViolations,
  plannerOutlineSchema,
  type SeoOutput,
  seoOutputSchema,
  validateArticle
} from "@openblog/agents";
import { withLogContext, withScope, type ILogger } from "@openblog/logger";
import type { PublishArticle, PublishResult } from "@openblog/publishers";
import { z } from "zod";

import type { LlmPort, MemoryPort, PublishPort, StoredWorkflowStep, TaxonomyPort } from "../ports";
import {
  addUsage,
  currentUsage,
  emptyUsage,
  type LlmUsage,
  trackUsage,
  type UsageBudget,
  usageSince,
  withUsageTracking
} from "../usage";

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
  topic: z.string().trim().min(1),
  /** Generate even if the topic, slug or title was already published. Recorded on the run. */
  force: z.boolean().optional()
});

export type ArticleWorkflowInput = z.infer<typeof articleWorkflowInputSchema>;

/** A rule the article broke; mirrors `ArticleViolation` so stored steps can be validated. */
const violationSchema = z.object({
  code: z.string(),
  severity: z.enum(["error", "warning"]),
  message: z.string()
});

export type QualityViolation = z.infer<typeof violationSchema>;

/** What a new article collides with. */
const duplicateSchema = z.object({
  matchedOn: z.enum(["topic", "slug", "title", "remote"]),
  /** The stored run it duplicates; absent for a remote post. */
  workflowId: z.string().optional(),
  /** Id or URL of the remote post (or file) it collides with. */
  remote: z.string().optional()
});

export type DuplicateInfo = z.infer<typeof duplicateSchema>;

const nonEmptyTextSchema = z.string().trim().min(1);
const classificationSchema = z.object({
  category: nonEmptyTextSchema,
  tags: z.array(z.string())
});

/** An editorial review as stored with a step and returned with the run. */
const reviewSchema = z.object({
  scores: z.object({
    seo: z.number(),
    readability: z.number(),
    structure: z.number(),
    completeness: z.number(),
    repetition: z.number()
  }),
  overall: z.number(),
  rationale: z.string()
});

/** `needs_review`: the quality gate rejected the article; it is stored and nothing was published. */
export type WorkflowRunStatus =
  "published" | "awaiting_approval" | "needs_review" | "failed" | "duplicate";

/**
 * When an article goes live:
 * - `draft` (default): sent to the target as a draft once the gate passes; live only after `approve`.
 * - `publish_after_approval`: nothing is sent until `approve`.
 * - `publish_if_gate_passes`: published live as soon as the gate passes (risky; explicit opt-in).
 */
export type PublicationPolicy = "draft" | "publish_after_approval" | "publish_if_gate_passes";

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
  /** Id of the stored run (what `approve` takes); absent without a memory store. */
  workflowId?: string;
  article: string;
  category: string;
  editedText: string;
  seoOutput: SeoOutput;
  tags: string[];
  topic: string;
  /** The editorial review, when it is enabled and the article passed the gate. */
  review?: EditorialReview;
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

/** The article passed the gate; under the active policy it waits for `approve` before going live. */
export interface AwaitingApprovalWorkflowResult extends ArticleWorkflowOutput {
  status: "awaiting_approval";
  failure?: undefined;
  /** The draft the target accepted; absent under `publish_after_approval`. */
  publishResult?: PublishResult;
}

/** The quality gate rejected the article after the allowed regenerations; nothing was published. */
export interface NeedsReviewWorkflowResult extends ArticleWorkflowOutput {
  status: "needs_review";
  failure: WorkflowFailure;
  violations: QualityViolation[];
  publishResult?: undefined;
}

/** The duplicate policy stopped the run before anything was published. */
export interface DuplicateWorkflowResult {
  status: "duplicate";
  workflowId?: string;
  topic: string;
  failure: WorkflowFailure;
  duplicateOf: DuplicateInfo;
  publishResult?: undefined;
}

export type ArticleWorkflowResult =
  | PublishedWorkflowResult
  | AwaitingApprovalWorkflowResult
  | NeedsReviewWorkflowResult
  | DuplicateWorkflowResult
  | FailedWorkflowResult;

export type ApprovalErrorCode =
  "memory_unavailable" | "not_found" | "already_published" | "gate_not_passed" | "not_publishable";

/** Thrown when an article cannot be approved; nothing is published or changed. */
export class ApprovalError extends Error {
  readonly code: ApprovalErrorCode;

  constructor(code: ApprovalErrorCode, message: string) {
    super(message);
    this.name = "ApprovalError";
    this.code = code;
  }
}

export interface ApprovalInput {
  /** Who approves (the CLI user); recorded with the time. */
  approvedBy: string;
  /** Required to approve an article that did not pass the quality gate; recorded. */
  overrideReason?: string;
}

export interface ApprovalResult {
  status: "published" | "failed";
  workflowId: string;
  title: string;
  slug: string;
  publishResult: PublishResult;
  failure?: WorkflowFailure;
}

export interface ArticleGenerationWorkflow {
  readonly name: typeof ARTICLE_GENERATION_WORKFLOW_NAME;
  run(input: ArticleWorkflowInput): Promise<ArticleWorkflowResult>;
  /** Continues a run that did not publish, reusing the stored output of its completed steps. */
  /** Publishes a stored article live. Refuses articles that failed the gate without an override reason. */
  approve(workflowId: string, input: ApprovalInput): Promise<ApprovalResult>;
  resume(workflowId: string, options?: { force?: boolean }): Promise<ArticleWorkflowResult>;
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
  /** Generate duplicates without `force` on every run (OPENBLOG_ALLOW_DUPLICATES). */
  allowDuplicates?: boolean;
  /** When articles go live. Defaults to `draft`: never live without `approve`. */
  publicationPolicy?: PublicationPolicy;
  /** Optional LLM second opinion on articles that passed the deterministic gate. Off by default. */
  review?: {
    enabled?: boolean;
    /** Minimum overall score (0 to 10); lower scores park the article as `needs_review`. Defaults to 7. */
    minScore?: number;
  };
  /** Per-run token and cost limits; a run that exceeds them stops with `budget_exceeded`. */
  budget?: UsageBudget;
  quality?: {
    /** Overrides of the default validation thresholds. */
    rules?: Partial<ArticleValidationRules>;
    /** Regenerations allowed after a failed check before parking the run. Defaults to 2. */
    maxAttempts?: number;
  };
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
  /** Quality gate: regenerations done so far, the latest verdict and the feedback for the writer. */
  regenerations: Annotation<number>({ default: () => 0, reducer: (_, update) => update }),
  qualityPassed: optional<boolean>(),
  qualityViolations: optional<QualityViolation[]>(),
  qualityFeedback: optional<string>(),
  force: Annotation<boolean>({ default: () => false, reducer: (_, update) => update }),
  duplicate: optional<DuplicateInfo>(),
  llmUsage: optional<LlmUsage>(),
  review: optional<EditorialReview>(),
  /** Steps restored from a previous run; their nodes are skipped. */
  completedSteps: optional<string[]>()
});

export type ArticleWorkflowState = typeof graphState.State;
type ArticleWorkflowUpdate = typeof graphState.Update;

/** Older runs stored only calls and tokens, so every other field defaults to 0. */
const usageSchema = z.object({
  calls: z.number().default(0),
  promptTokens: z.number().default(0),
  completionTokens: z.number().default(0),
  totalTokens: z.number().default(0),
  costUsd: z.number().default(0)
});

/** Shape of what each step stores, used to restore state when a run is resumed. */
const stepOutputSchemas: Record<string, z.ZodType<ArticleWorkflowUpdate, z.ZodTypeDef, unknown>> = {
  planner: z.object({ outline: plannerOutlineSchema }),
  writer: z.object({ article: nonEmptyTextSchema }),
  editor: z.object({ editedText: nonEmptyTextSchema }),
  seo: z.object({ seoOutput: seoOutputSchema }),
  duplicate_check: z.object({ duplicate: duplicateSchema.optional() }),
  quality: z.object({
    qualityPassed: z.boolean(),
    qualityViolations: z.array(violationSchema),
    llmUsage: usageSchema.optional()
  }),
  editorial_review: z.object({
    review: reviewSchema,
    qualityPassed: z.boolean().optional(),
    qualityViolations: z.array(violationSchema).optional()
  }),
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
    // A collision is checked again on resume (the other article may be gone, or the run forced).
    if (output.duplicate) {
      continue;
    }
    // A rejected article is checked again on resume (the rules may have changed).
    if (output.qualityPassed === false) {
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

/** Executions of each step in the run in progress, so log lines can say which attempt they belong to. */
const attemptCounter = new AsyncLocalStorage<Map<string, number>>();

/** Runs `fn` as one run: every log line inside carries its `workflowId`. */
function inRun<T>(workflowId: string, previousSteps: StoredWorkflowStep[], fn: () => T): T {
  const attempts = new Map<string, number>();
  for (const stored of previousSteps) {
    attempts.set(stored.step, Math.max(attempts.get(stored.step) ?? 0, stored.attempt));
  }
  return withLogContext({ workflowId }, () => attemptCounter.run(attempts, fn));
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
    result: ({ output: ArticleWorkflowUpdate } | { error: WorkflowStepError }) & {
      usage: LlmUsage;
    }
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
        usage: result.usage,
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
    const attempts = attemptCounter.getStore();
    const attempt = (attempts?.get(name) ?? 0) + 1;

    return withLogContext({ step: name, attempt }, async () => {
      if (state.completedSteps?.includes(name)) {
        logger.info("Skipping step completed in a previous attempt");
        return {};
      }
      attempts?.set(name, attempt);

      const startedAt = new Date().toISOString();
      const started = Date.now();
      const usageBefore = currentUsage();
      try {
        const output = await fn(state);
        await record(state, startedAt, { output, usage: usageSince(usageBefore, currentUsage()) });
        logger.info("Step finished", { outcome: "succeeded", durationMs: Date.now() - started });
        return output;
      } catch (error) {
        const stepError =
          error instanceof WorkflowStepError ? error : new WorkflowStepError(name, error);
        await record(state, startedAt, {
          error: stepError,
          usage: usageSince(usageBefore, currentUsage())
        });
        logger.error("Step finished", {
          outcome: "failed",
          durationMs: Date.now() - started,
          errorCode: stepError.code,
          error: stepError.message
        });
        throw stepError;
      }
    });
  };
}

export function createArticleGenerationWorkflow(
  options: CreateArticleGenerationWorkflowOptions
): ArticleGenerationWorkflow {
  const { publisher, taxonomy, memory, maxTags = 5 } = options;
  const logger = withScope(options.logger);
  const llm = trackUsage(options.llm, logger, options.budget);
  const defaultCategory = options.defaultCategory ?? "General";
  const qualityRules = options.quality?.rules ?? {};
  const allowDuplicates = options.allowDuplicates ?? false;
  const policy = options.publicationPolicy ?? "draft";
  const maxRegenerations = Math.max(0, options.quality?.maxAttempts ?? 2);

  const plannerAgent = createPlannerAgent(llm);
  const writerAgent = createWriterAgent(llm);
  const editorAgent = createEditorAgent(llm);
  const seoAgent = createSeoAgent(llm);
  const classificationAgent = createClassificationAgent(llm);
  const reviewAgent = createEditorialReviewAgent(llm);
  const reviewEnabled = options.review?.enabled ?? false;
  const reviewMinScore = options.review?.minScore ?? 7;

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
        const input = {
          topic: state.topic,
          outline: required(state.outline, "outline"),
          feedback: state.qualityFeedback
        };

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
      "duplicate_check",
      step("duplicate_check", stepContext, async (state) => {
        const seoOutput = required(state.seoOutput, "seoOutput");
        let duplicate: DuplicateInfo | undefined;

        const stored =
          memory && state.workflowId
            ? await memory.findDuplicateArticle({
                workflowId: state.workflowId,
                slug: seoOutput.slug,
                title: seoOutput.title
              })
            : null;
        if (stored) {
          duplicate = { matchedOn: stored.matchedOn, workflowId: stored.workflowId };
        } else {
          const remote = await publisher.findExisting?.({ slug: seoOutput.slug });
          if (remote) {
            duplicate = {
              matchedOn: "remote",
              remote: remote.url ?? remote.id ?? seoOutput.slug
            };
          }
        }

        if (duplicate) {
          logger[state.force ? "warn" : "error"](
            state.force
              ? "Duplicate slug or title allowed by force"
              : "Duplicate slug or title detected",
            { ...duplicate, slug: seoOutput.slug, title: seoOutput.title, topic: state.topic }
          );
        }

        return { duplicate };
      })
    )
    .addNode(
      "quality",
      step("quality", stepContext, async (state) => {
        const { passed, violations } = validateArticle(
          {
            article: currentArticle(state),
            draft: state.article,
            outline: state.outline,
            seo: state.seoOutput
          },
          qualityRules
        );
        const llmUsage = currentUsage();
        const decision = passed
          ? "pass"
          : state.regenerations < maxRegenerations
            ? "regenerate"
            : "needs_review";

        logger[passed ? "info" : "warn"]("Quality gate decision", {
          decision,
          regenerations: state.regenerations,
          maxRegenerations,
          violations: violations.map((violation) => violation.code),
          llmCalls: llmUsage.calls,
          totalTokens: llmUsage.totalTokens,
          topic: state.topic
        });

        return { qualityPassed: passed, qualityViolations: violations, llmUsage };
      })
    )
    .addNode(
      "editorial_review",
      step("editorial_review", stepContext, async (state) => {
        const seoOutput = required(state.seoOutput, "seoOutput");
        const review = await reviewAgent.run({
          outline: required(state.outline, "outline"),
          articleText: currentArticle(state),
          title: seoOutput.title,
          metaDescription: seoOutput.metaDescription
        });
        const passed = review.overall >= reviewMinScore;

        logger[passed ? "info" : "warn"]("Editorial review decision", {
          decision: passed ? "pass" : "needs_review",
          overall: review.overall,
          minScore: reviewMinScore,
          scores: review.scores,
          topic: state.topic
        });

        if (passed) {
          return { review };
        }
        const violation: QualityViolation = {
          code: "editorial_review_below_threshold",
          severity: "error",
          message: `Editorial review scored ${review.overall}/10, below the minimum ${reviewMinScore}: ${review.rationale}`
        };
        return {
          review,
          qualityPassed: false,
          qualityViolations: [...(state.qualityViolations ?? []), violation]
        };
      })
    )
    .addNode(
      "regenerate",
      step("regenerate", stepContext, async (state) => {
        // The writer, editor, seo and quality nodes must run again, also on a resumed run.
        const redo = ["writer", "editor", "seo", "duplicate_check", "quality", "editorial_review"];
        return {
          regenerations: state.regenerations + 1,
          qualityFeedback: formatViolations(state.qualityViolations ?? []),
          completedSteps: (state.completedSteps ?? []).filter((name) => !redo.includes(name))
        };
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
          language: "en",
          // Only this policy ever sends a live post straight from a run.
          status: policy === "publish_if_gate_passes" ? "publish" : "draft"
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
    .addEdge("seo", "duplicate_check")
    .addConditionalEdges("duplicate_check", (state) =>
      state.duplicate && !state.force ? END : "quality"
    )
    .addConditionalEdges("quality", (state) => {
      if (!state.qualityPassed) {
        return state.regenerations < maxRegenerations ? "regenerate" : "classification";
      }
      return reviewEnabled ? "editorial_review" : "classification";
    })
    .addEdge("editorial_review", "classification")
    .addEdge("regenerate", "writer")
    // A rejected article is still classified so a reviewer can publish it later.
    .addConditionalEdges("classification", (state) =>
      state.qualityPassed && policy !== "publish_after_approval" ? "publisher" : END
    )
    .addEdge("publisher", END)
    .compile();

  /** Ends a run the duplicate policy refused: no further provider calls, nothing published. */
  async function stopAsDuplicate(
    topic: string,
    workflowMemory: { workflowId: string } | null,
    duplicate: DuplicateInfo,
    step: string
  ): Promise<DuplicateWorkflowResult> {
    const where = duplicate.workflowId ? `run ${duplicate.workflowId}` : duplicate.remote;
    const failure: WorkflowFailure = {
      step,
      code: `duplicate_${duplicate.matchedOn}`,
      message:
        duplicate.matchedOn === "topic"
          ? `This topic was already published (${where}); use --force to generate it again`
          : `An article with the same ${duplicate.matchedOn === "remote" ? "slug" : duplicate.matchedOn} already exists (${where}); use --force to publish anyway`
    };

    if (memory && workflowMemory) {
      await memory.markDuplicate({
        workflowId: workflowMemory.workflowId,
        duplicateOfWorkflowId: duplicate.workflowId ?? null,
        failedStep: failure.step,
        errorCode: failure.code,
        errorMessage: failure.message
      });
    }
    logger.warn("Article workflow stopped by the duplicate policy", {
      topic,
      workflow: ARTICLE_GENERATION_WORKFLOW_NAME,
      ...duplicate,
      errorCode: failure.code
    });

    return {
      status: "duplicate",
      workflowId: workflowMemory?.workflowId,
      topic,
      failure,
      duplicateOf: duplicate
    };
  }

  async function execute(
    topic: string,
    workflowMemory: { workflowId: string } | null,
    force: boolean,
    restored: ArticleWorkflowUpdate = {},
    priorUsage: LlmUsage = emptyUsage()
  ): Promise<ArticleWorkflowResult> {
    logger.info("Starting article workflow", {
      topic,
      workflow: ARTICLE_GENERATION_WORKFLOW_NAME
    });

    try {
      if (memory && workflowMemory) {
        await memory.markRunning(workflowMemory.workflowId);
      }

      const finalState = await withUsageTracking(
        () =>
          workflow.invoke({
            ...restored,
            topic,
            force,
            workflowId: workflowMemory?.workflowId
          }),
        priorUsage
      );

      if (finalState.duplicate && !force) {
        return await stopAsDuplicate(
          topic,
          workflowMemory,
          finalState.duplicate,
          "duplicate_check"
        );
      }

      const output: ArticleWorkflowOutput = {
        article: required(finalState.article, "article"),
        category: required(finalState.category, "category"),
        editedText: required(finalState.editedText, "editedText"),
        seoOutput: required(finalState.seoOutput, "seoOutput"),
        tags: required(finalState.tags, "tags"),
        topic: finalState.topic,
        review: finalState.review
      };
      const publishResult = finalState.publishResult;
      const needsReview = !required(finalState.qualityPassed, "qualityPassed");
      const violations = finalState.qualityViolations ?? [];
      const awaitingApproval =
        !needsReview &&
        (policy === "publish_after_approval" ||
          (policy === "draft" && publishResult?.success === true));
      const failure: WorkflowFailure | undefined = needsReview
        ? {
            step: "quality",
            code: "quality_gate_failed",
            message: `Article rejected by the quality gate: ${violations
              .filter((violation) => violation.severity === "error")
              .map((violation) => violation.code)
              .join(", ")}`
          }
        : awaitingApproval || publishResult?.success
          ? undefined
          : {
              step: "publisher",
              code: publishResult?.error?.code ?? "publish_failed",
              message: publishResult?.error?.message ?? "Publisher did not confirm the publication"
            };
      const status: WorkflowRunStatus = needsReview
        ? "needs_review"
        : failure
          ? "failed"
          : awaitingApproval
            ? "awaiting_approval"
            : "published";

      if (memory && workflowMemory) {
        await memory.finishWorkflow({
          workflowId: workflowMemory.workflowId,
          status,
          ...output,
          publishResult: publishResult && { ...publishResult },
          gatePassed: !needsReview,
          failedStep: failure?.step,
          errorCode: failure?.code,
          errorMessage: failure?.message
        });
      }

      if (needsReview) {
        logger.warn("Article workflow needs review", {
          topic,
          workflow: ARTICLE_GENERATION_WORKFLOW_NAME,
          regenerations: finalState.regenerations,
          violations: violations.map((violation) => violation.code),
          llmCalls: finalState.llmUsage?.calls,
          totalTokens: finalState.llmUsage?.totalTokens
        });
      } else if (failure) {
        logger.error("Article workflow failed", {
          topic,
          workflow: ARTICLE_GENERATION_WORKFLOW_NAME,
          failedStep: failure.step,
          errorCode: failure.code,
          error: failure.message
        });
      } else if (awaitingApproval) {
        logger.info("Article workflow waiting for approval", {
          topic,
          workflow: ARTICLE_GENERATION_WORKFLOW_NAME,
          policy,
          workflowId: workflowMemory?.workflowId
        });
      } else {
        logger.info("Article workflow completed", {
          articleLength: output.article.length,
          topic,
          workflow: ARTICLE_GENERATION_WORKFLOW_NAME
        });
      }

      const id = workflowMemory?.workflowId;

      if (failure && needsReview) {
        return { ...output, workflowId: id, status: "needs_review", failure, violations };
      }

      if (awaitingApproval) {
        return { ...output, workflowId: id, status: "awaiting_approval", publishResult };
      }

      return failure
        ? { ...output, workflowId: id, status: "failed", failure, publishResult }
        : {
            ...output,
            workflowId: id,
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
      const parsed = articleWorkflowInputSchema.parse(input);
      const { topic } = parsed;
      const force = Boolean(parsed.force) || allowDuplicates;
      const workflowMemory = memory
        ? await memory.beginWorkflow({
            workflowName: ARTICLE_GENERATION_WORKFLOW_NAME,
            topic,
            metadata: force ? { force: true } : undefined
          })
        : null;

      // Without a memory store there is no stored id; a throwaway one still correlates the lines.
      return inRun(workflowMemory?.workflowId ?? randomUUID(), [], async () => {
        if (workflowMemory?.isDuplicate) {
          const duplicate: DuplicateInfo = {
            matchedOn: "topic",
            workflowId: workflowMemory.duplicateOfWorkflowId ?? undefined
          };
          if (!force) {
            return stopAsDuplicate(topic, workflowMemory, duplicate, "duplicate_topic_check");
          }
          logger.warn("Duplicate topic allowed by force", { topic, ...duplicate });
        }

        return execute(topic, workflowMemory, force);
      });
    },

    async approve(workflowId: string, input: ApprovalInput): Promise<ApprovalResult> {
      if (!memory) {
        throw new ApprovalError(
          "memory_unavailable",
          "Approving an article requires a memory store"
        );
      }
      const stored = await memory.loadArticle(workflowId);
      return inRun(workflowId, [], async () => {
        if (!stored) {
          throw new ApprovalError("not_found", `No stored article for workflow ${workflowId}`);
        }

        const { article } = stored;
        if (article.reviewState === "published") {
          throw new ApprovalError(
            "already_published",
            `The article of workflow ${workflowId} is already published`
          );
        }

        const overrideReason = input.overrideReason?.trim() || undefined;
        const gatePassed = article.gatePassed === true;
        if (!gatePassed && !overrideReason) {
          throw new ApprovalError(
            "gate_not_passed",
            `The article of workflow ${workflowId} did not pass the quality gate; approve it with an override reason to publish it anyway`
          );
        }

        const description = article.seo.metaDescription;
        if (!article.title || !article.slug || typeof description !== "string") {
          throw new ApprovalError(
            "not_publishable",
            `The stored article of workflow ${workflowId} has no title, slug or description`
          );
        }

        await memory.beginApproval({
          workflowId,
          approvedBy: input.approvedBy,
          overrideReason: gatePassed ? undefined : overrideReason
        });
        logger.info("Article approved", {
          workflowId,
          approvedBy: input.approvedBy,
          overridden: !gatePassed,
          overrideReason: gatePassed ? undefined : overrideReason
        });

        const now = new Date().toISOString();
        // The publisher looks the slug up first, so retrying after a failed approval does not duplicate.
        const publishResult = publishResultSchema.parse(
          await publisher.publish({
            title: article.title,
            slug: article.slug,
            summary: description,
            content: article.editedMarkdown,
            createdAt: now,
            updatedAt: now,
            tags: article.tags,
            category: article.category ?? defaultCategory,
            author: "OpenBlogAgent",
            language: "en",
            status: "publish"
          })
        );
        await memory.completeApproval({ workflowId, publishResult: { ...publishResult } });

        const result = {
          workflowId,
          title: article.title,
          slug: article.slug,
          publishResult
        };
        if (publishResult.success) {
          logger.info("Approved article published", { workflowId, slug: article.slug });
          return { ...result, status: "published" };
        }

        logger.error("Publishing the approved article failed", {
          workflowId,
          errorCode: publishResult.error?.code,
          error: publishResult.error?.message
        });
        return {
          ...result,
          status: "failed",
          failure: {
            step: "publisher",
            code: publishResult.error?.code ?? "publish_failed",
            message: publishResult.error?.message ?? "Publisher did not confirm the publication"
          }
        };
      });
    },

    async resume(
      workflowId: string,
      resumeOptions: { force?: boolean } = {}
    ): Promise<ArticleWorkflowResult> {
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
      return inRun(workflowId, stored.steps, () => {
        logger.info("Resuming article workflow", {
          topic: stored.topic,
          completedSteps: restored.completedSteps
        });

        return execute(
          stored.topic,
          { workflowId },
          Boolean(resumeOptions.force) || allowDuplicates,
          restored,
          // The budget covers the whole run, so what earlier attempts spent still counts.
          stored.steps.reduce(
            (total, previous) => addUsage(total, previous.usage ?? emptyUsage()),
            emptyUsage()
          )
        );
      });
    }
  };
}
