import type { Identifier } from "@openblog/types";

export interface IExecutionContext {
  executionId: Identifier;
  workflowId: Identifier;
  metadata: Record<string, unknown>;
}

export interface INode {
  id: Identifier;
  type: string;
}

export interface IEdge {
  id: Identifier;
  from: Identifier;
  to: Identifier;
}

export interface ITool {
  id: Identifier;
  name: string;
}

export interface IProvider {
  id: Identifier;
  name: string;
}

export interface IPublisher {
  id: Identifier;
  name: string;
}

export interface IRepository<TModel = unknown> {
  getById(id: Identifier): Promise<TModel | null>;
  save(model: TModel): Promise<void>;
}

export interface ILogger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
}

export interface IAgent {
  id: Identifier;
  name: string;
  execute(context: IExecutionContext): Promise<void>;
}

export interface IWorkflow {
  id: Identifier;
  name: string;
  nodes: ReadonlyArray<INode>;
  edges: ReadonlyArray<IEdge>;
}
