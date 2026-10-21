import { readFile } from "node:fs/promises";

import { z } from "zod";

import type { EnvSchema } from "@openblog/config";

const taxonomyFileSchema = z.object({
  categories: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional()
});

export interface StaticTaxonomy {
  categories: string[];
  tags: string[];
}

/**
 * Static category/tag names from config: the optional JSON file first, then the
 * comma-separated `OPENBLOG_TAXONOMY_CATEGORIES`/`_TAGS` lists, which override it.
 * With nothing configured the only category is `OPENBLOG_TAXONOMY_DEFAULT_CATEGORY`.
 */
export async function loadStaticTaxonomy(config: EnvSchema): Promise<StaticTaxonomy> {
  let fromFile: z.infer<typeof taxonomyFileSchema> = {};

  if (config.OPENBLOG_TAXONOMY_FILE) {
    try {
      const raw = await readFile(config.OPENBLOG_TAXONOMY_FILE, "utf8");
      fromFile = taxonomyFileSchema.parse(JSON.parse(raw));
    } catch (error) {
      throw new Error(
        `Cannot load OPENBLOG_TAXONOMY_FILE (${config.OPENBLOG_TAXONOMY_FILE}): ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  const categories = unique(
    parseList(config.OPENBLOG_TAXONOMY_CATEGORIES) ?? fromFile.categories ?? []
  );
  const tags = unique(parseList(config.OPENBLOG_TAXONOMY_TAGS) ?? fromFile.tags ?? []);

  return {
    categories: categories.length > 0 ? categories : [config.OPENBLOG_TAXONOMY_DEFAULT_CATEGORY],
    tags
  };
}

function parseList(value: string | undefined): string[] | undefined {
  return value === undefined ? undefined : value.split(",");
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  return values
    .map((value) => value.trim())
    .filter((value) => {
      const key = value.toLowerCase();
      if (!value || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}
