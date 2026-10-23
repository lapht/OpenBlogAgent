import type { Identifier } from "@openblog/types";

/**
 * `started -> running -> published | awaiting_approval | needs_review | failed`, or `duplicate`
 * when stopped by the duplicate policy. `awaiting_approval`: the article passed the quality gate
 * and waits for `approve`; `needs_review`: it failed the gate.
 */
export type WorkflowStatus =
  | "started"
  | "running"
  | "published"
  | "awaiting_approval"
  | "needs_review"
  | "failed"
  | "duplicate";

export type FinalWorkflowStatus = Extract<
  WorkflowStatus,
  "published" | "awaiting_approval" | "needs_review" | "failed"
>;

/** Where a stored article stands in the review flow. */
export type ArticleReviewState = "needs_review" | "approved" | "published";

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
  reviewState: ArticleReviewState;
  /** Whether the quality gate passed; null when unknown (articles stored before the gate existed). */
  gatePassed: boolean | null;
  approvedBy: string | null;
  approvedAt: string | null;
  /** Why an article that failed the gate was approved anyway. */
  approvalOverrideReason: string | null;
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
  /** Provider usage of this execution; null for steps stored before usage was tracked. */
  usage: StepUsageRecord | null;
  /** Model the provider reported for this execution; null when none was recorded. */
  model: string | null;
}

/** The editorial review a run stored with its `editorial_review` step. */
export interface StoredReview {
  overall: number;
  scores: Record<string, number>;
  rationale: string;
}

export interface StepUsageRecord {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
}
