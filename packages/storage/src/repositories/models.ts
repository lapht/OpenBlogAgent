import type { Identifier } from "@openblog/types";

/** `started -> running -> published | needs_review | failed`. */
export type WorkflowStatus = "started" | "running" | "published" | "needs_review" | "failed";

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
  createdAt: string;
  updatedAt: string;
}
