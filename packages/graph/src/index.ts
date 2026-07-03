import type { Identifier } from "@openblog/types";

export * from "./workflows/article-generation-workflow";

export interface WorkflowState {
  values: Record<string, unknown>;
}

export interface WorkflowContext {
  workflowId: Identifier;
  metadata: Record<string, unknown>;
}

export interface Node {
  id: Identifier;
  name: string;
  type: string;
}

export interface Edge {
  id: Identifier;
  from: Identifier;
  to: Identifier;
}

export interface Workflow {
  id: Identifier;
  name: string;
  nodes: ReadonlyArray<Node>;
  edges: ReadonlyArray<Edge>;
}
