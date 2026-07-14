import type { ICategoryProvider, ITagProvider, TaxonomyEntry } from "../types";

export class StaticCategoryProvider implements ICategoryProvider {
  constructor(private readonly entries: TaxonomyEntry[], private readonly defaultCategory: string) {}

  async resolve(name: string): Promise<TaxonomyEntry> {
    const match = this.entries.find((e) => e.name.toLowerCase() === name.toLowerCase());
    if (match) return match;
    return this.entries.find((e) => e.name.toLowerCase() === this.defaultCategory.toLowerCase()) ?? { id: 1, name: this.defaultCategory };
  }

  async list(): Promise<TaxonomyEntry[]> {
    return this.entries;
  }
}

export class StaticTagProvider implements ITagProvider {
  constructor(private readonly entries: TaxonomyEntry[], private readonly maxTags: number) {}

  async resolveMany(names: string[]): Promise<TaxonomyEntry[]> {
    return names.slice(0, this.maxTags).map((name, index) => {
      const match = this.entries.find((e) => e.name.toLowerCase() === name.toLowerCase());
      return match ?? { id: 1000 + index, name };
    });
  }

  async list(): Promise<TaxonomyEntry[]> {
    return this.entries;
  }
}