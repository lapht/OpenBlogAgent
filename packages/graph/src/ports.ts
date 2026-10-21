import type { TextGenerationProvider } from "@openblog/providers";
import type { PublishArticle, PublishResult } from "@openblog/publishers";

/** Text generation. Implemented by the providers package (OpenRouter, Ollama, fallback). */
export type LlmPort = TextGenerationProvider;

/** Publishes a finished article. Implemented by `DefaultPublisherManager`. */
export interface PublishPort {
  publish(article: PublishArticle): Promise<PublishResult>;
}

/** Category and tag names the classification step may choose from. */
export interface TaxonomyPort {
  listCategories(): Promise<string[]>;
  listTags(): Promise<string[]>;
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
