import type { ILogger } from "@openblog/logger";
import { TtlCache } from "../cache";
import type { ICategoryProvider, ITagProvider, TaxonomyEntry, TaxonomyProviderConfig } from "../types";

interface WordPressTaxonomyProviderOptions {
  endpoint: string;
  username?: string;
  applicationPassword?: string;
  password?: string;
  logger: ILogger;
  config: TaxonomyProviderConfig;
}

abstract class WordPressTaxonomyBase {
  protected readonly cache: TtlCache<TaxonomyEntry[]>;

  constructor(
    protected readonly options: WordPressTaxonomyProviderOptions,
    protected readonly path: "categories" | "tags"
  ) {
    this.cache = new TtlCache(options.config.cacheTtlSeconds);
  }

  private authHeader(): string {
    const { username, applicationPassword, password } = this.options;
    const token = Buffer.from(`${username ?? ""}:${applicationPassword ?? password ?? ""}`).toString("base64");
    return `Basic ${token}`;
  }

  protected async fetchAll(): Promise<TaxonomyEntry[]> {
    const cached = this.cache.get(this.path);
    if (cached) return cached;

    const url = `${this.options.endpoint}/${this.path}?per_page=100`;
    const response = await fetch(url, { headers: { Authorization: this.authHeader() } });

    if (!response.ok) {
      throw new Error(`Failed to fetch WordPress ${this.path}: ${response.status}`);
    }

    const raw = (await response.json()) as { id: number; name: string }[];
    const entries = raw.map((item) => ({ id: item.id, name: item.name }));
    this.cache.set(this.path, entries);
    return entries;
  }

  protected async createOne(name: string): Promise<TaxonomyEntry> {
    if (!this.options.config.allowCreate) {
      throw new Error(`Taxonomy "${name}" not found in ${this.path} and creation is disabled`);
    }

    const url = `${this.options.endpoint}}/${this.path}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: this.authHeader() },
      body: JSON.stringify({ name })
    });

    if (!response.ok) {
      throw new Error(`Failed to create WordPress ${this.path} "${name}": ${response.status}`);
    }

    const created = (await response.json()) as { id: number; name: string };
    this.cache.set(this.path, []); // invalidate cache, forces refetch next time
    return { id: created.id, name: created.name };
  }
}

export class WordPressCategoryProvider extends WordPressTaxonomyBase implements ICategoryProvider {
  constructor(options: WordPressTaxonomyProviderOptions) {
    super(options, "categories");
  }

  async resolve(name: string): Promise<TaxonomyEntry> {
    const entries = await this.fetchAll();
    const match = entries.find((e) => e.name.toLowerCase() === name.toLowerCase());
    if (match) return match;

    this.options.logger.warn("Category not found, falling back", { requested: name });
    const fallback = entries.find((e) => e.name.toLowerCase() === this.options.config.defaultCategory.toLowerCase());
    if (fallback) return fallback;

    return this.createOne(name);
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
    const limited = names.slice(0, this.options.config.maxTags);
    const entries = await this.fetchAll();
    const results: TaxonomyEntry[] = [];

    for (const name of limited) {
      const match = entries.find((e) => e.name.toLowerCase() === name.toLowerCase());
      results.push(match ?? (await this.createOne(name)));
    }

    return results;
  }

  async list(): Promise<TaxonomyEntry[]> {
    return this.fetchAll();
  }
}