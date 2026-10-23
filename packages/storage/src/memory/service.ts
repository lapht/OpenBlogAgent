import { randomUUID } from "node:crypto";

import type { Identifier } from "@openblog/types";

import {
  ArticleRepository,
  PromptRepository,
  StepRepository,
  TopicRepository,
  WorkflowRepository
} from "../repositories";
import type {
  FinalWorkflowStatus,
  StepUsageRecord,
  StoredReview,
  WorkflowStepRecord
} from "../repositories/models";

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
  /** Whether the quality gate passed. Defaults to true for a published or awaiting run, else unknown. */
  gatePassed?: boolean;
  failedStep?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface BeginApprovalParams {
  workflowId: Identifier;
  approvedBy: string;
  overrideReason?: string;
}

export interface CompleteApprovalParams {
  workflowId: Identifier;
  publishResult: Record<string, unknown> & { success?: boolean };
}

export interface MarkDuplicateParams {
  workflowId: Identifier;
  /** The stored run this one duplicates; `null` when the duplicate is a remote post. */
  duplicateOfWorkflowId: Identifier | null;
  failedStep: string;
  errorCode: string;
  errorMessage: string;
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
  usage?: StepUsageRecord;
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
        reviewState: params.status === "published" ? "published" : "needs_review",
        gatePassed:
          params.gatePassed ??
          (params.status === "published" || params.status === "awaiting_approval" ? true : null),
        approvedBy: null,
        approvedAt: null,
        approvalOverrideReason: null,
        createdAt: now,
        updatedAt: now
      });
    });
  }

  /** The stored article of a run with the status of that run, or null if there is none. */
  async loadArticle(workflowId: Identifier) {
    const workflow = this.workflowRepository.getById(workflowId);
    const article = this.articleRepository.getByWorkflowId(workflowId);
    return workflow && article ? { workflowStatus: workflow.status, article } : null;
  }

  /** Records who approved the article and when, before it is sent to the publisher. */
  async beginApproval(params: BeginApprovalParams): Promise<void> {
    this.articleRepository.markApproved(params.workflowId, {
      approvedBy: params.approvedBy,
      approvedAt: new Date().toISOString(),
      overrideReason: params.overrideReason ?? null
    });
  }

  /** Stores the publish that followed an approval; the article and run become published only on success. */
  async completeApproval(params: CompleteApprovalParams): Promise<void> {
    this.runInTransaction(() => {
      const published = params.publishResult.success === true;
      this.articleRepository.recordApprovalPublish(params.workflowId, {
        published,
        publishResult: params.publishResult,
        remote: publishRemote(params.publishResult)
      });
      if (published) {
        this.workflowRepository.updateStatus(
          params.workflowId,
          "published",
          new Date().toISOString(),
          null
        );
      }
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
      completedAt: params.completedAt,
      usage: params.usage ?? null
    });
  }

  async loadWorkflow(workflowId: Identifier) {
    const workflow = this.workflowRepository.getById(workflowId);
    if (!workflow) {
      return null;
    }
    return {
      topic: workflow.topic,
      status: workflow.status,
      metadata: workflow.metadata,
      steps: this.stepRepository.getByWorkflowId(workflowId).map((record) => ({
        ...record,
        usage: record.usage ?? undefined
      }))
    };
  }

  /** The most recent runs, newest first, as `list` shows them. */
  async listWorkflows(limit = 20) {
    const workflows = this.workflowRepository.listRecent(limit);
    const totals = this.stepRepository.totalsByWorkflow(workflows.map((workflow) => workflow.id));
    const reviews = this.stepRepository.latestOutputs(
      workflows.map((workflow) => workflow.id),
      "editorial_review"
    );
    return workflows.map((workflow) => ({
      workflowId: workflow.id,
      topic: workflow.topic,
      status: workflow.status,
      failedStep: workflow.failedStep,
      errorCode: workflow.errorCode,
      createdAt: workflow.createdAt,
      totalTokens: totals.get(workflow.id)?.totalTokens ?? 0,
      costUsd: totals.get(workflow.id)?.costUsd ?? 0,
      review: (reviews.get(workflow.id) as { review?: StoredReview } | undefined)?.review ?? null
    }));
  }

  /** One run with its steps (outputs left out), totals and review, or null if the id is unknown. */
  async getRunDetails(workflowId: Identifier) {
    const workflow = this.workflowRepository.getById(workflowId);
    if (!workflow) {
      return null;
    }
    const steps = this.stepRepository.getByWorkflowId(workflowId);
    const review = this.stepRepository
      .latestOutputs([workflowId], "editorial_review")
      .get(workflowId);
    return {
      workflowId: workflow.id,
      topic: workflow.topic,
      status: workflow.status,
      failedStep: workflow.failedStep,
      errorCode: workflow.errorCode,
      errorMessage: workflow.errorMessage,
      createdAt: workflow.createdAt,
      completedAt: workflow.completedAt,
      totalTokens: steps.reduce((sum, record) => sum + (record.usage?.totalTokens ?? 0), 0),
      costUsd: steps.reduce((sum, record) => sum + (record.usage?.costUsd ?? 0), 0),
      review: (review as { review?: StoredReview } | undefined)?.review ?? null,
      steps: steps.map((record) => ({
        step: record.step,
        status: record.status,
        attempt: record.attempt,
        errorCode: record.errorCode,
        errorMessage: record.errorMessage,
        startedAt: record.startedAt,
        completedAt: record.completedAt,
        usage: record.usage
      }))
    };
  }

  async getSteps(workflowId: Identifier): Promise<WorkflowStepRecord[]> {
    return this.stepRepository.getByWorkflowId(workflowId);
  }

  /** Ends a run stopped by the duplicate policy and records what it duplicates. */
  async markDuplicate(params: MarkDuplicateParams): Promise<void> {
    this.runInTransaction(() => {
      this.workflowRepository.updateStatus(
        params.workflowId,
        "duplicate",
        new Date().toISOString(),
        params.errorMessage,
        { errorCode: params.errorCode, failedStep: params.failedStep }
      );
      this.workflowRepository.markDuplicate(params.workflowId, params.duplicateOfWorkflowId);
    });
  }

  /** A published or parked article of another run with this slug or title. */
  async findDuplicateArticle(params: {
    workflowId: Identifier;
    slug: string;
    title: string;
  }): Promise<{ workflowId: Identifier; matchedOn: "slug" | "title" } | null> {
    return this.articleRepository.findDuplicate({
      slug: params.slug,
      title: params.title,
      excludeWorkflowId: params.workflowId
    });
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
