import type { ILogger } from "@openblog/logger";
import { TtlCache } from "../cache";
import { decodeHtmlEntities, normalizeTermName } from "../normalize";
import {
  basicAuthHeader,
  normalizeWordPressEndpoint,
  wordpressFetch,
  WordPressRequestError
} from "../../wordpress/http";
import type {
  ICategoryProvider,
  ITagProvider,
  TaxonomyEntry,
  TaxonomyProviderConfig
} from "../types";

interface WordPressTaxonomyProviderOptions {
  endpoint: string;
  username?: string;
  applicationPassword?: string;
  logger: ILogger;
  config: TaxonomyProviderConfig;
  timeoutMs?: number;
}

interface WordPressTerm {
  id: number;
  name: string;
}

const PER_PAGE = 100;
const MAX_PAGES = 50;

/**
 * Resolution policy:
 * - category: matching name -> that term; unknown -> the configured default category (never created);
 *   if the default is missing too, resolution fails.
 * - tag: matching name -> that term; unknown -> created only when `allowCreate`, otherwise skipped.
 */
abstract class WordPressTaxonomyBase {
  protected readonly cache: TtlCache<TaxonomyEntry[]>;

  constructor(
    protected readonly options: WordPressTaxonomyProviderOptions,
    protected readonly path: "categories" | "tags"
  ) {
    this.cache = new TtlCache(options.config.cacheTtlSeconds);
  }

  private get baseUrl(): string {
    return `${normalizeWordPressEndpoint(this.options.endpoint)}/${this.path}`;
  }

  private authHeader(): string {
    return basicAuthHeader(this.options.username ?? "", this.options.applicationPassword ?? "");
  }

  protected async fetchAll(): Promise<TaxonomyEntry[]> {
    const cached = this.cache.get(this.path);
    if (cached !== undefined) return cached;

    const entries: TaxonomyEntry[] = [];
    let totalPages = 1;
    for (let page = 1; page <= totalPages && page <= MAX_PAGES; page++) {
      const response = await wordpressFetch(
        `${this.baseUrl}?per_page=${PER_PAGE}&page=${page}`,
        { headers: { Authorization: this.authHeader() } },
        this.options.timeoutMs
      );
      const raw = (await response.json()) as WordPressTerm[];
      entries.push(...raw.map((item) => ({ id: item.id, name: decodeHtmlEntities(item.name) })));
      totalPages = Number.parseInt(response.headers?.get("X-WP-TotalPages") ?? "1", 10) || 1;
    }

    this.cache.set(this.path, entries);
    return entries;
  }

  protected async createOne(name: string): Promise<TaxonomyEntry> {
    if (!this.options.config.allowCreate) {
      throw new Error(`Taxonomy "${name}" not found in ${this.path} and creation is disabled`);
    }

    const entries = await this.fetchAll();
    const created = await this.postTerm(name);
    // Keep the term locally instead of refetching: the next lookup in this run must not lose or re-create it.
    this.cache.set(this.path, [...entries.filter((e) => e.id !== created.id), created]);
    return created;
  }

  private async postTerm(name: string): Promise<TaxonomyEntry> {
    try {
      const response = await wordpressFetch(
        this.baseUrl,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: this.authHeader() },
          body: JSON.stringify({ name })
        },
        this.options.timeoutMs
      );
      const created = (await response.json()) as WordPressTerm;
      return { id: created.id, name: decodeHtmlEntities(created.name) };
    } catch (error) {
      throw new WordPressRequestError(
        error instanceof WordPressRequestError ? error.code : "unexpected_response",
        `Failed to create WordPress ${this.path} "${name}": ${error instanceof Error ? error.message : "unknown error"}`,
        error instanceof WordPressRequestError ? error.status : undefined
      );
    }
  }

  protected find(entries: TaxonomyEntry[], name: string): TaxonomyEntry | undefined {
    const wanted = normalizeTermName(name);
    return entries.find((e) => normalizeTermName(e.name) === wanted);
  }
}

export class WordPressCategoryProvider extends WordPressTaxonomyBase implements ICategoryProvider {
  constructor(options: WordPressTaxonomyProviderOptions) {
    super(options, "categories");
  }

  async resolve(name: string): Promise<TaxonomyEntry> {
    const entries = await this.fetchAll();
    const match = this.find(entries, name);
    if (match) return match;

    const { defaultCategory } = this.options.config;
    const fallback = this.find(entries, defaultCategory);
    if (!fallback) {
      throw new Error(
        `Category "${name}" not found and default category "${defaultCategory}" does not exist in WordPress`
      );
    }

    this.options.logger.warn("Category not found, falling back to the default category", {
      requested: name,
      fallback: fallback.name
    });
    return fallback;
  }

  async list(): Promise<TaxonomyEntry[]> {
    return this.fetchAll();
  }
}

export class WordPressTagProvider extends WordPressTaxonomyBase implements ITagProvider {
  constructor(options: WordPressTaxonomyProviderOptions) {
    super(options, "tags");
  }

  async resolveMany(names: string[]): Promise<TaxonomyEntry[]> {
    const seen = new Set<string>();
    const wanted = names
      .map((name) => name.trim())
      .filter((name) => {
        const key = normalizeTermName(name);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, this.options.config.maxTags);

    const results: TaxonomyEntry[] = [];
    for (const name of wanted) {
      const match = this.find(await this.fetchAll(), name);
      if (match) {
        results.push(match);
      } else if (this.options.config.allowCreate) {
        results.push(await this.createOne(name));
      } else {
        this.options.logger.warn("Tag not found and creation is disabled, skipping", { tag: name });
      }
    }

    return results;
  }

  async list(): Promise<TaxonomyEntry[]> {
    return this.fetchAll();
  }
}
