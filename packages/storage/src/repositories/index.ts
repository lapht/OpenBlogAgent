import type { Identifier } from "@openblog/types";

import type { ArticleRecord, PromptRecord, TopicRecord, WorkflowRecord } from "./models";

export interface IRepositoryContract<TModel = unknown> {
  getById(id: Identifier): Promise<TModel | null>;
  save(model: TModel): Promise<void>;
}

export interface IWorkflowRepository extends IRepositoryContract<WorkflowRecord> {
  updateStatus(
    id: Identifier,
    status: "started" | "completed" | "failed",
    completedAt: string | null,
    errorMessage: string | null
  ): Promise<void>;
}

export interface ITopicRepository extends IRepositoryContract<TopicRecord> {
  getByNormalizedTopic(normalizedTopic: string): Promise<TopicRecord | null>;
}

export interface IPromptRepository extends IRepositoryContract<PromptRecord> {
  getByWorkflowId(workflowId: Identifier): Promise<PromptRecord[]>;
}

export interface IArticleRepository extends IRepositoryContract<ArticleRecord> {
  getByWorkflowId(workflowId: Identifier): Promise<ArticleRecord | null>;
}

export * from "./models";
export * from "./workflow-repository";
export * from "./topic-repository";
export * from "./prompt-repository";
export * from "./article-repository";
