export interface IDatabaseConnection {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

export * from "./sqlite";
export * from "./migrations";
