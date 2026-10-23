import type { Database } from "better-sqlite3";
import type { Identifier } from "@openblog/types";

import type { IRepositoryContract } from "./index";
import type { ArticleRecord, ArticleReviewState } from "./models";

interface ArticleRow {
  id: string;
  workflow_id: string;
  topic: string;
  title: string | null;
  slug: string | null;
  category: string | null;
  tags_json: string;
  article_markdown: string;
  edited_markdown: string;
  seo_json: string;
  publish_result_json: string | null;
  publish_remote_id: string | null;
  publish_remote_url: string | null;
  publish_remote_status: string | null;
  review_state: ArticleReviewState;
  gate_passed: number | null;
  approved_by: string | null;
  approved_at: string | null;
  approval_override_reason: string | null;
  created_at: string;
  updated_at: string;
}

export class ArticleRepository implements IRepositoryContract<ArticleRecord> {
  constructor(private readonly db: Database) {}

  getById(id: Identifier): ArticleRecord | null {
    const row = this.db
      .prepare(
        `SELECT
          id,
          workflow_id,
          topic,
          title,
          slug,
          category,
          tags_json,
          article_markdown,
          edited_markdown,
          seo_json,
          publish_result_json,
          publish_remote_id,
          publish_remote_url,
          publish_remote_status,
          review_state,
          gate_passed,
          approved_by,
          approved_at,
          approval_override_reason,
          created_at,
          updated_at
         FROM articles
         WHERE id = ?`
      )
      .get(id) as ArticleRow | undefined;

    return row ? this.mapRow(row) : null;
  }

  save(model: ArticleRecord): void {
    this.db
      .prepare(
        `INSERT INTO articles (
          id,
          workflow_id,
          topic,
          title,
          slug,
          category,
          tags_json,
          article_markdown,
          edited_markdown,
          seo_json,
          publish_result_json,
          publish_remote_id,
          publish_remote_url,
          publish_remote_status,
          review_state,
          gate_passed,
          approved_by,
          approved_at,
          approval_override_reason,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(workflow_id) DO UPDATE SET
          topic = excluded.topic,
          title = excluded.title,
          slug = excluded.slug,
          category = excluded.category,
          tags_json = excluded.tags_json,
          article_markdown = excluded.article_markdown,
          edited_markdown = excluded.edited_markdown,
          seo_json = excluded.seo_json,
          publish_result_json = excluded.publish_result_json,
          publish_remote_id = excluded.publish_remote_id,
          publish_remote_url = excluded.publish_remote_url,
          publish_remote_status = excluded.publish_remote_status,
          review_state = excluded.review_state,
          gate_passed = excluded.gate_passed,
          approved_by = excluded.approved_by,
          approved_at = excluded.approved_at,
          approval_override_reason = excluded.approval_override_reason,
          updated_at = excluded.updated_at`
      )
      .run(
        model.id,
        model.workflowId,
        model.topic,
        model.title,
        model.slug,
        model.category,
        JSON.stringify(model.tags),
        model.articleMarkdown,
        model.editedMarkdown,
        JSON.stringify(model.seo),
        model.publishResult ? JSON.stringify(model.publishResult) : null,
        model.publishRemoteId,
        model.publishRemoteUrl,
        model.publishRemoteStatus,
        model.reviewState,
        model.gatePassed === null ? null : model.gatePassed ? 1 : 0,
        model.approvedBy,
        model.approvedAt,
        model.approvalOverrideReason,
        model.createdAt,
        model.updatedAt
      );
  }

  getByWorkflowId(workflowId: Identifier): ArticleRecord | null {
    const row = this.db
      .prepare(
        `SELECT
          id,
          workflow_id,
          topic,
          title,
          slug,
          category,
          tags_json,
          article_markdown,
          edited_markdown,
          seo_json,
          publish_result_json,
          publish_remote_id,
          publish_remote_url,
          publish_remote_status,
          review_state,
          gate_passed,
          approved_by,
          approved_at,
          approval_override_reason,
          created_at,
          updated_at
         FROM articles
         WHERE workflow_id = ?`
      )
      .get(workflowId) as ArticleRow | undefined;

    return row ? this.mapRow(row) : null;
  }

  /** Marks the article as approved by `approvedBy`, before it is sent to the publisher. */
  markApproved(
    workflowId: Identifier,
    approval: { approvedBy: string; approvedAt: string; overrideReason: string | null }
  ): void {
    this.db
      .prepare(
        `UPDATE articles
         SET review_state = 'approved',
             approved_by = ?,
             approved_at = ?,
             approval_override_reason = ?,
             updated_at = ?
         WHERE workflow_id = ?`
      )
      .run(
        approval.approvedBy,
        approval.approvedAt,
        approval.overrideReason,
        new Date().toISOString(),
        workflowId
      );
  }

  /** Marks the article as rejected by a reviewer. */
  markRejected(workflowId: Identifier): void {
    this.db
      .prepare(
        "UPDATE articles SET review_state = 'rejected', updated_at = ? WHERE workflow_id = ?"
      )
      .run(new Date().toISOString(), workflowId);
  }

  /** Stores the outcome of the publish that followed an approval; `published` only on success. */
  recordApprovalPublish(
    workflowId: Identifier,
    publish: {
      published: boolean;
      publishResult: Record<string, unknown>;
      remote: { id: string | null; url: string | null; status: string | null };
    }
  ): void {
    this.db
      .prepare(
        `UPDATE articles
         SET review_state = ?,
             publish_result_json = ?,
             publish_remote_id = ?,
             publish_remote_url = ?,
             publish_remote_status = ?,
             updated_at = ?
         WHERE workflow_id = ?`
      )
      .run(
        publish.published ? "published" : "approved",
        JSON.stringify(publish.publishResult),
        publish.remote.id,
        publish.remote.url,
        publish.remote.status,
        new Date().toISOString(),
        workflowId
      );
  }

  /**
   * A stored article of another run (published or waiting for review) with the same slug or the
   * same title, ignoring case. The oldest match wins.
   */
  findDuplicate(params: {
    slug: string;
    title: string;
    excludeWorkflowId: Identifier;
  }): { workflowId: Identifier; matchedOn: "slug" | "title" } | null {
    const row = this.db
      .prepare(
        `SELECT a.workflow_id AS workflow_id, a.slug AS slug
         FROM articles a
         JOIN workflows w ON w.id = a.workflow_id
         WHERE a.workflow_id != ?
           AND w.status IN ('published', 'awaiting_approval', 'needs_review')
           AND (a.slug = ? OR lower(a.title) = lower(?))
         ORDER BY a.created_at ASC
         LIMIT 1`
      )
      .get(params.excludeWorkflowId, params.slug, params.title) as
      { workflow_id: string; slug: string | null } | undefined;

    return row
      ? { workflowId: row.workflow_id, matchedOn: row.slug === params.slug ? "slug" : "title" }
      : null;
  }

  private mapRow(row: ArticleRow): ArticleRecord {
    return {
      id: row.id,
      workflowId: row.workflow_id,
      topic: row.topic,
      title: row.title,
      slug: row.slug,
      category: row.category,
      tags: JSON.parse(row.tags_json) as string[],
      articleMarkdown: row.article_markdown,
      editedMarkdown: row.edited_markdown,
      seo: JSON.parse(row.seo_json) as Record<string, unknown>,
      publishResult: row.publish_result_json
        ? (JSON.parse(row.publish_result_json) as Record<string, unknown>)
        : null,
      publishRemoteId: row.publish_remote_id,
      publishRemoteUrl: row.publish_remote_url,
      publishRemoteStatus: row.publish_remote_status,
      reviewState: row.review_state,
      gatePassed: row.gate_passed === null ? null : row.gate_passed === 1,
      approvedBy: row.approved_by,
      approvedAt: row.approved_at,
      approvalOverrideReason: row.approval_override_reason,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}
