import { randomUUID } from "node:crypto";

import type { Identifier } from "@openblog/types";

import {
  ArticleRepository,
  PromptRepository,
  TopicRepository,
  WorkflowRepository
} from "../repositories";

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

export interface CompleteWorkflowParams {
  workflowId: Identifier;
  topic: string;
  article: string;
  editedText: string;
  seoOutput: Record<string, unknown>;
  category: string;
  tags: string[];
  publishResult?: Record<string, unknown>;
}

export interface FailWorkflowParams {
  workflowId: Identifier;
  errorMessage: string;
}

export class MemoryService {
  constructor(
    private readonly workflowRepository: WorkflowRepository,
    private readonly topicRepository: TopicRepository,
    private readonly promptRepository: PromptRepository,
    private readonly articleRepository: ArticleRepository
  ) {}

  static normalizeTopic(topic: string): string {
    return topic.trim().toLowerCase().replace(/\s+/g, " ");
  }

  async beginWorkflow(params: WorkflowStartParams): Promise<WorkflowStartResult> {
    const now = new Date().toISOString();
    const normalizedTopic = MemoryService.normalizeTopic(params.topic);
    const existingTopic = await this.topicRepository.getByNormalizedTopic(normalizedTopic);
    const workflowId = randomUUID();

    await this.workflowRepository.save({
      id: workflowId,
      name: params.workflowName,
      topic: params.topic,
      topicNormalized: normalizedTopic,
      status: "started",
      isDuplicate: Boolean(existingTopic),
      duplicateOfWorkflowId: existingTopic?.firstWorkflowId ?? null,
      metadata: params.metadata ?? {},
      errorMessage: null,
      startedAt: now,
      completedAt: null,
      createdAt: now,
      updatedAt: now
    });

    if (existingTopic) {
      await this.topicRepository.save({
        ...existingTopic,
        hitCount: existingTopic.hitCount + 1,
        lastSeenAt: now
      });
    } else {
      await this.topicRepository.save({
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
      isDuplicate: Boolean(existingTopic),
      duplicateOfWorkflowId: existingTopic?.firstWorkflowId ?? null
    };
  }

  async savePrompt(params: SavePromptParams): Promise<void> {
    await this.promptRepository.save({
      id: randomUUID(),
      workflowId: params.workflowId,
      promptType: params.promptType,
      content: params.content,
      createdAt: new Date().toISOString()
    });
  }

  async completeWorkflow(params: CompleteWorkflowParams): Promise<void> {
    const now = new Date().toISOString();
    await this.workflowRepository.updateStatus(params.workflowId, "completed", now, null);

    await this.articleRepository.save({
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
      createdAt: now,
      updatedAt: now
    });
  }

  async failWorkflow(params: FailWorkflowParams): Promise<void> {
    await this.workflowRepository.updateStatus(
      params.workflowId,
      "failed",
      new Date().toISOString(),
      params.errorMessage
    );
  }
}
