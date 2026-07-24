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
  created_at: string;
  updated_at: string;
}

export class ArticleRepository implements IRepositoryContract<ArticleRecord> {
  constructor(private readonly db: Database) {}

  async getById(id: Identifier): Promise<ArticleRecord | null> {
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
          created_at,
          updated_at
         FROM articles
         WHERE id = ?`
      )
      .get(id) as ArticleRow | undefined;

    return row ? this.mapRow(row) : null;
  }

  async save(model: ArticleRecord): Promise<void> {
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
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        model.createdAt,
        model.updatedAt
      );
  }

  async getByWorkflowId(workflowId: Identifier): Promise<ArticleRecord | null> {
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
          created_at,
          updated_at
         FROM articles
         WHERE workflow_id = ?`
      )
      .get(workflowId) as ArticleRow | undefined;

    return row ? this.mapRow(row) : null;
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
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}
