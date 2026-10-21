import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { stringify } from "yaml";

import type { ILogger } from "@openblog/logger";

import type {
  IPublisher,
  PublishArticle,
  PublishResult,
  PublisherValidationIssue,
  PublisherValidationResult
} from "../types";

export interface MarkdownPublisherConfig {
  outputDir: string;
  /** Replace an existing file with the same slug. Defaults to false: the publish fails instead. */
  overwrite?: boolean;
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Reduces arbitrary text (a title, a raw topic) to a slug matching `SLUG_PATTERN`; empty if nothing is left. */
export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export class MarkdownPublisher implements IPublisher {
  readonly id = "markdown";
  readonly name = "Markdown Publisher";

  constructor(
    public readonly config: MarkdownPublisherConfig,
    private readonly logger: ILogger
  ) {}

  async validate(article: PublishArticle): Promise<PublisherValidationResult> {
    const issues: PublisherValidationIssue[] = [];

    if (!article.title?.trim()) {
      issues.push({ field: "title", message: "Title is required" });
    }

    if (!article.slug?.trim()) {
      issues.push({ field: "slug", message: "Slug is required" });
    }

    if (!article.content?.trim()) {
      issues.push({ field: "content", message: "Content is required" });
    }

    return { valid: issues.length === 0, issues };
  }

  supports(article: PublishArticle): boolean {
    return article.target === undefined || article.target === "markdown";
  }

  async publish(article: PublishArticle): Promise<PublishResult> {
    const validation = await this.validate(article);

    if (!validation.valid) {
      this.logger.error("Markdown publisher validation failed", {
        slug: article.slug,
        issues: validation.issues
      });

      return {
        success: false,
        publisherId: this.id,
        publisherName: this.name,
        error: {
          code: "validation_failed",
          message: "Markdown publisher validation failed",
          details: { issues: validation.issues }
        }
      };
    }

    const slug = slugify(article.slug);

    if (!SLUG_PATTERN.test(slug)) {
      return this.failure("invalid_slug", "Slug has no usable characters", { slug: article.slug });
    }

    const outputDir = path.resolve(this.config.outputDir);
    const outputPath = path.resolve(outputDir, `${slug}.md`);

    if (path.dirname(outputPath) !== outputDir) {
      return this.failure("invalid_slug", "Resolved path is outside the output directory", {
        slug: article.slug
      });
    }

    const contents = this.buildFrontMatter({ ...article, slug });

    try {
      await mkdir(outputDir, { recursive: true });
      await writeFile(outputPath, contents, {
        encoding: "utf8",
        flag: this.config.overwrite ? "w" : "wx"
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        return this.failure("already_exists", `File already exists: ${outputPath}`, {
          slug,
          outputPath
        });
      }

      return this.failure("write_failed", error instanceof Error ? error.message : String(error), {
        slug,
        outputPath
      });
    }

    this.logger.info("Markdown publisher wrote article", { outputPath, slug });

    return {
      success: true,
      publisherId: this.id,
      publisherName: this.name,
      outputPath,
      metadata: {
        slug,
        format: "markdown"
      }
    };
  }

  private failure(code: string, message: string, details: Record<string, unknown>): PublishResult {
    this.logger.error("Markdown publisher failed", { code, ...details });

    return {
      success: false,
      publisherId: this.id,
      publisherName: this.name,
      error: { code, message, details }
    };
  }

  private buildFrontMatter(article: PublishArticle): string {
    const frontMatter = stringify({
      title: article.title,
      slug: article.slug,
      description: article.summary,
      category: article.category,
      tags: article.tags,
      createdAt: article.createdAt,
      updatedAt: article.updatedAt,
      author: article.author,
      language: article.language
    });

    return `---\n${frontMatter}---\n\n${article.content}\n`;
  }
}
