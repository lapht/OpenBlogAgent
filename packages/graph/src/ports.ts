import type { TextGenerationProvider } from "@openblog/providers";
import type { ExistingPost, PublishArticle, PublishResult } from "@openblog/publishers";

/** Text generation. Implemented by the providers package (OpenRouter, Ollama, fallback). */
export type LlmPort = TextGenerationProvider;

/** Publishes a finished article. Implemented by `DefaultPublisherManager`. */
export interface PublishPort {
  publish(article: PublishArticle): Promise<PublishResult>;
  /** Whether the slug is already published on the target. Absent when the target cannot tell. */
  findExisting?(article: Pick<PublishArticle, "slug">): Promise<ExistingPost | null>;
}

/** Category and tag names the classification step may choose from. */
export interface TaxonomyPort {
  listCategories(): Promise<string[]>;
  listTags(): Promise<string[]>;
}

/** One stored execution of a workflow step. */
export interface StoredWorkflowStep {
  step: string;
  status: "succeeded" | "failed";
  attempt: number;
  output?: unknown;
  /** Provider usage of this execution; absent for steps stored before usage was tracked. */
  usage?: StepUsage;
}

/** What the provider calls of one step execution consumed. */
export interface StepUsage {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
}

/** A stored article as `approve` needs it. */
export interface StoredArticle {
  topic: string;
  title: string | null;
  slug: string | null;
  category: string | null;
  tags: string[];
  editedMarkdown: string;
  seo: Record<string, unknown>;
  reviewState: "needs_review" | "approved" | "published";
  /** Null when unknown (stored before the quality gate existed). */
  gatePassed: boolean | null;
}

/** The editorial review of a run, when one was made. */
export interface StoredReview {
  overall: number;
  scores: Record<string, number>;
  rationale: string;
}

/** One stored run as `list` shows it. */
export interface StoredWorkflowSummary {
  workflowId: string;
  topic: string;
  status: string;
  failedStep: string | null;
  errorCode: string | null;
  createdAt: string;
  /** Provider usage summed over every stored step of the run. */
  totalTokens: number;
  costUsd: number;
  /** Latest editorial review; null when the review is off or did not run. */
  review: StoredReview | null;
}

/** Workflow bookkeeping. Implemented by `MemoryService` in the storage package. */
export interface MemoryPort {
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
  /** The stored run with its step history (oldest first), or null if the id is unknown. */
  loadWorkflow(workflowId: string): Promise<{
    topic: string;
    status: string;
    steps: StoredWorkflowStep[];
  } | null>;
  markRunning(workflowId: string): Promise<void>;
  /** The most recent runs, newest first. Optional: only the persistent store can list. */
  listWorkflows?(limit?: number): Promise<StoredWorkflowSummary[]>;
  /** Stores the final status together with the generated content, also when publishing failed. */
  finishWorkflow(params: {
    workflowId: string;
    status: "published" | "awaiting_approval" | "needs_review" | "failed";
    topic: string;
    article: string;
    editedText: string;
    seoOutput: Record<string, unknown>;
    category: string;
    tags: string[];
    publishResult?: Record<string, unknown>;
    /** Whether the quality gate passed; approving an article that did not needs an override. */
    gatePassed?: boolean;
    failedStep?: string;
    errorCode?: string;
    errorMessage?: string;
  }): Promise<void>;
  /** Stores the output (or error) of one step execution so a run can be audited or resumed. */
  recordStep(params: {
    workflowId: string;
    step: string;
    status: "succeeded" | "failed";
    output?: unknown;
    errorCode?: string;
    errorMessage?: string;
    startedAt: string;
    completedAt: string;
    usage?: StepUsage;
  }): Promise<void>;
  /** Ends a run stopped by the duplicate policy; `duplicateOfWorkflowId` is null for a remote post. */
  markDuplicate(params: {
    workflowId: string;
    duplicateOfWorkflowId: string | null;
    failedStep: string;
    errorCode: string;
    errorMessage: string;
  }): Promise<void>;
  /** A published or parked article of another run with this slug or title. */
  findDuplicateArticle(params: {
    workflowId: string;
    slug: string;
    title: string;
  }): Promise<{ workflowId: string; matchedOn: "slug" | "title" } | null>;
  /** The stored article of a run, with that run's status; null if none was stored. */
  loadArticle(workflowId: string): Promise<{
    workflowStatus: string;
    article: StoredArticle;
  } | null>;
  /** Records who approved the article and when (and the override reason), before publishing. */
  beginApproval(params: {
    workflowId: string;
    approvedBy: string;
    overrideReason?: string;
  }): Promise<void>;
  /** Stores the publish that followed an approval; the article is published only on success. */
  completeApproval(params: {
    workflowId: string;
    publishResult: Record<string, unknown>;
  }): Promise<void>;
  failWorkflow(params: {
    workflowId: string;
    errorMessage: string;
    failedStep?: string;
    errorCode?: string;
  }): Promise<void>;
}
