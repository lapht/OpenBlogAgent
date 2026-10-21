import type { Identifier } from "@openblog/types";

/** `started -> running -> published | needs_review | failed`, or `duplicate` when stopped by the duplicate policy. */
export type WorkflowStatus =
  "started" | "running" | "published" | "needs_review" | "failed" | "duplicate";

export type FinalWorkflowStatus = Extract<WorkflowStatus, "published" | "needs_review" | "failed">;

export interface WorkflowRecord {
  id: Identifier;
  name: string;
  topic: string;
  topicNormalized: string;
  status: WorkflowStatus;
  isDuplicate: boolean;
  duplicateOfWorkflowId: Identifier | null;
  metadata: Record<string, unknown>;
  errorMessage: string | null;
  errorCode: string | null;
  failedStep: string | null;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TopicRecord {
  id: Identifier;
  normalizedTopic: string;
  firstTopic: string;
  firstWorkflowId: Identifier;
  hitCount: number;
  createdAt: string;
  lastSeenAt: string;
}

export type PromptType = "planner" | "writer";

export interface PromptRecord {
  id: Identifier;
  workflowId: Identifier;
  promptType: PromptType;
  content: string;
  createdAt: string;
}

export interface ArticleRecord {
  id: Identifier;
  workflowId: Identifier;
  topic: string;
  title: string | null;
  slug: string | null;
  category: string | null;
  tags: string[];
  articleMarkdown: string;
  editedMarkdown: string;
  seo: Record<string, unknown>;
  publishResult: Record<string, unknown> | null;
  publishRemoteId: string | null;
  publishRemoteUrl: string | null;
  publishRemoteStatus: string | null;
  createdAt: string;
  updatedAt: string;
}

export type WorkflowStepStatus = "succeeded" | "failed";

export interface WorkflowStepRecord {
  id: Identifier;
  workflowId: Identifier;
  step: string;
  status: WorkflowStepStatus;
  /** 1 for the first execution of a step in a workflow, incremented on each retry. */
  attempt: number;
  output: unknown;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string;
}
