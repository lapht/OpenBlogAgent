import type { Database } from "better-sqlite3";
import type { Identifier } from "@openblog/types";

import type { IRepositoryContract } from "./index";
import type { ArticleRecord } from "./models";

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
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          created_at,
          updated_at
         FROM articles
         WHERE workflow_id = ?`
      )
      .get(workflowId) as ArticleRow | undefined;

    return row ? this.mapRow(row) : null;
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
           AND w.status IN ('published', 'needs_review')
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
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}
