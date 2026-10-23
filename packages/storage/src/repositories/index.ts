import type { Identifier } from "@openblog/types";

import type {
  ArticleRecord,
  PromptRecord,
  TopicRecord,
  WorkflowRecord,
  WorkflowStatus
} from "./models";

export interface IRepositoryContract<TModel = unknown> {
  getById(id: Identifier): TModel | null;
  save(model: TModel): void;
}

export interface IWorkflowRepository extends IRepositoryContract<WorkflowRecord> {
  updateStatus(
    id: Identifier,
    status: WorkflowStatus,
    completedAt: string | null,
    errorMessage: string | null,
    failure?: { errorCode?: string | null; failedStep?: string | null }
  ): void;
}

export interface ITopicRepository extends IRepositoryContract<TopicRecord> {
  getByNormalizedTopic(normalizedTopic: string): TopicRecord | null;
}

export interface IPromptRepository extends IRepositoryContract<PromptRecord> {
  getByWorkflowId(workflowId: Identifier): PromptRecord[];
}

export interface IArticleRepository extends IRepositoryContract<ArticleRecord> {
  getByWorkflowId(workflowId: Identifier): ArticleRecord | null;
}

export * from "./models";
export * from "./workflow-repository";
export * from "./topic-repository";
export * from "./prompt-repository";
export * from "./article-repository";
export * from "./step-repository";
export * from "./decision-repository";
