import type { Identifier } from "@openblog/types";

export interface IRepositoryContract<TModel = unknown> {
  getById(id: Identifier): Promise<TModel | null>;
  save(model: TModel): Promise<void>;
}
