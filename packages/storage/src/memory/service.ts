import { randomUUID } from "node:crypto";

import type { Identifier } from "@openblog/types";

import {
  ArticleRepository,
  PromptRepository,
  StepRepository,
  TopicRepository,
  WorkflowRepository
} from "../repositories";
import type { FinalWorkflowStatus, WorkflowStepRecord } from "../repositories/models";

export interface WorkflowStartParams {
  workflowName: string;
  topic: string;
  metadata?: Record<string, unknown>;
}

export interface WorkflowStartResult {
  workflowId: Identifier;
  isDuplicate: boolean;
  duplicateOfWorkflowId: Identifier | null;
}

export interface SavePromptParams {
  workflowId: Identifier;
  promptType: "planner" | "writer";
  content: string;
}

export interface FinishWorkflowParams {
  workflowId: Identifier;
  status: FinalWorkflowStatus;
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
}

export interface FailWorkflowParams {
  workflowId: Identifier;
  errorMessage: string;
  failedStep?: string;
  errorCode?: string;
}

export interface RecordStepParams {
  workflowId: Identifier;
  step: string;
  status: "succeeded" | "failed";
  output?: unknown;
  errorCode?: string;
  errorMessage?: string;
  startedAt: string;
  completedAt: string;
}

/** Runs `fn` atomically: every write inside commits together or not at all. */
export type RunInTransaction = <T>(fn: () => T) => T;

/** Pulls remote identifiers out of the publisher's free-form metadata, when it reports them. */
function publishRemote(publishResult: Record<string, unknown> | undefined) {
  const metadata = (publishResult?.metadata ?? {}) as Record<string, unknown>;
  const text = (value: unknown) =>
    typeof value === "string" || typeof value === "number" ? String(value) : null;

  return {
    id: text(metadata.id ?? metadata.remoteId),
    url: text(metadata.url ?? metadata.link ?? publishResult?.outputPath),
    status: text(metadata.status)
  };
}

export class MemoryService {
  constructor(
    private readonly workflowRepository: WorkflowRepository,
    private readonly topicRepository: TopicRepository,
    private readonly promptRepository: PromptRepository,
    private readonly articleRepository: ArticleRepository,
    private readonly stepRepository: StepRepository,
    private readonly runInTransaction: RunInTransaction
  ) {}

  static normalizeTopic(topic: string): string {
    return topic.trim().toLowerCase().replace(/\s+/g, " ");
  }

  async beginWorkflow(params: WorkflowStartParams): Promise<WorkflowStartResult> {
    return this.runInTransaction(() => {
      const now = new Date().toISOString();
      const normalizedTopic = MemoryService.normalizeTopic(params.topic);
      const existingTopic = this.topicRepository.getByNormalizedTopic(normalizedTopic);
      // Only a run that actually published counts as the original; failed runs can be retried.
      const original = this.workflowRepository.findFirstPublishedByTopic(normalizedTopic);
      const workflowId = randomUUID();

      this.workflowRepository.save({
        id: workflowId,
        name: params.workflowName,
        topic: params.topic,
        topicNormalized: normalizedTopic,
        status: "started",
        isDuplicate: Boolean(original),
        duplicateOfWorkflowId: original?.id ?? null,
        metadata: params.metadata ?? {},
        errorMessage: null,
        errorCode: null,
        failedStep: null,
        startedAt: now,
        completedAt: null,
        createdAt: now,
        updatedAt: now
      });

      if (existingTopic) {
        this.topicRepository.save({
          ...existingTopic,
          hitCount: existingTopic.hitCount + 1,
          lastSeenAt: now
        });
      } else {
        this.topicRepository.save({
          id: randomUUID(),
          normalizedTopic,
          firstTopic: params.topic,
          firstWorkflowId: workflowId,
          hitCount: 1,
          createdAt: now,
          lastSeenAt: now
        });
      }

      return {
        workflowId,
        isDuplicate: Boolean(original),
        duplicateOfWorkflowId: original?.id ?? null
      };
    });
  }

  async savePrompt(params: SavePromptParams): Promise<void> {
    this.promptRepository.save({
      id: randomUUID(),
      workflowId: params.workflowId,
      promptType: params.promptType,
      content: params.content,
      createdAt: new Date().toISOString()
    });
  }

  async markRunning(workflowId: Identifier): Promise<void> {
    this.workflowRepository.updateStatus(workflowId, "running", null, null);
  }

  /** Records the final status and keeps the generated content, also when publishing failed. */
  async finishWorkflow(params: FinishWorkflowParams): Promise<void> {
    this.runInTransaction(() => {
      const now = new Date().toISOString();
      const remote = publishRemote(params.publishResult);

      this.workflowRepository.updateStatus(
        params.workflowId,
        params.status,
        now,
        params.errorMessage ?? null,
        { errorCode: params.errorCode, failedStep: params.failedStep }
      );

      this.articleRepository.save({
        id: randomUUID(),
        workflowId: params.workflowId,
        topic: params.topic,
        title: typeof params.seoOutput.title === "string" ? params.seoOutput.title : null,
        slug: typeof params.seoOutput.slug === "string" ? params.seoOutput.slug : null,
        category: params.category,
        tags: params.tags,
        articleMarkdown: params.article,
        editedMarkdown: params.editedText,
        seo: params.seoOutput,
        publishResult: params.publishResult ?? null,
        publishRemoteId: remote.id,
        publishRemoteUrl: remote.url,
        publishRemoteStatus: remote.status,
        createdAt: now,
        updatedAt: now
      });
    });
  }

  /** Stores one execution of a workflow step with its output (or error). */
  async recordStep(params: RecordStepParams): Promise<void> {
    this.stepRepository.append({
      id: randomUUID(),
      workflowId: params.workflowId,
      step: params.step,
      status: params.status,
      output: params.output,
      errorCode: params.errorCode ?? null,
      errorMessage: params.errorMessage ?? null,
      startedAt: params.startedAt,
      completedAt: params.completedAt
    });
  }

  async getSteps(workflowId: Identifier): Promise<WorkflowStepRecord[]> {
    return this.stepRepository.getByWorkflowId(workflowId);
  }

  async failWorkflow(params: FailWorkflowParams): Promise<void> {
    this.workflowRepository.updateStatus(
      params.workflowId,
      "failed",
      new Date().toISOString(),
      params.errorMessage,
      { errorCode: params.errorCode, failedStep: params.failedStep }
    );
  }
}
