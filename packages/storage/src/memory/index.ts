export interface IMemoryStore {
  append(namespace: string, value: unknown): Promise<void>;
  read(namespace: string): Promise<ReadonlyArray<unknown>>;
}
