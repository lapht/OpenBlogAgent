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
  /** Stores the final status together with the generated content, also when publishing failed. */
  finishWorkflow(params: {
    workflowId: string;
    status: "published" | "needs_review" | "failed";
    topic: string;
    article: string;
    editedText: string;
    seoOutput: Record<string, unknown>;
    category: string;
    tags: string[];
    publishResult?: Record<string, unknown>;
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
  failWorkflow(params: {
    workflowId: string;
    errorMessage: string;
    failedStep?: string;
    errorCode?: string;
  }): Promise<void>;
}
