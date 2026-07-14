export interface TaxonomyEntry {
  id: number;
  name: string;
}

export interface ICategoryProvider {
  list(): Promise<TaxonomyEntry[]>;
  resolve(name: string): Promise<TaxonomyEntry>;
}

export interface ITagProvider {
  list(): Promise<TaxonomyEntry[]>;
  resolveMany(names: string[]): Promise<TaxonomyEntry[]>;
}

export interface TaxonomyProviderConfig {
  allowCreate: boolean;
  defaultCategory: string;
  maxTags: number;
  cacheTtlSeconds: number;
}