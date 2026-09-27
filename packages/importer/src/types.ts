/**
 * Shapes of the FlowAId importer: the external flow export it reads (a canvas graph of nodes
 * and edges, as agent-flow and LangChain chat-flow editors save it) and the migration report it
 * writes next to the definition.
 */
import type { WorkflowDefinition } from "@flowaid/workflow-core";

/** One node of an external flow export (only the fields the importer reads). */
export interface SourceNode {
  id: string;
  type?: string;
  position?: { x?: number; y?: number };
  parentNode?: string;
  data: {
    id?: string;
    /** the component name, e.g. `llmAgentflow` or `chatOpenAI` */
    name: string;
    label?: string;
    category?: string;
    inputs?: Record<string, unknown>;
  };
}

export interface SourceEdge {
  id?: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface SourceFlow {
  name?: string;
  nodes: SourceNode[];
  edges: SourceEdge[];
}

/** `agentflow`: control-flow graphs of agent nodes; `chatflow`: LangChain component graphs. */
export type ExternalFlowFormat = "agentflow" | "chatflow";

export type ImportIssueCode =
  /** a node has no FlowAId equivalent: it became a `flowaid.dev.todo` placeholder */
  | "E_IMPORT_UNSUPPORTED"
  /** mapped, but the behaviour differs in a way worth reviewing */
  | "W_IMPORT_APPROXIMATE"
  /** the model provider changed (an LLM judgement became a TypeSafe decision, say) */
  | "W_IMPORT_PROVIDER_CHANGED"
  /** a credential, password or auth header was removed; bind a secret instead */
  | "W_IMPORT_CREDENTIAL_REMOVED"
  /** mapped, but a value must be chosen before the workflow runs */
  | "W_IMPORT_NEEDS_CONFIG";

export interface ImportIssue {
  code: ImportIssueCode;
  severity: "error" | "warning";
  message: string;
  /** the FlowAId node the issue is about */
  nodeId?: string;
  /** the source node it came from */
  sourceId?: string;
}

export type ImportNodeStatus = "imported" | "converted" | "needs_config" | "unsupported";

export interface ImportNodeReport {
  sourceId: string;
  sourceType: string;
  name: string;
  /** the FlowAId node id it became (absent when folded into another node) */
  nodeId?: string;
  /** the FlowAId node type or kind */
  targetType?: string;
  status: ImportNodeStatus;
  message?: string;
}

export interface ImportReport {
  format: ExternalFlowFormat;
  workflowName: string;
  counts: { imported: number; converted: number; needsConfig: number; unsupported: number };
  nodes: ImportNodeReport[];
  issues: ImportIssue[];
  /** secrets the imported workflow declares; bind them per environment */
  secrets: string[];
}

export interface ImportResult {
  definition: WorkflowDefinition;
  report: ImportReport;
}

export interface ImportOptions {
  /** the workflow id to write into the definition (default: a fresh uuid) */
  id?: string;
  /** the workflow name (default: the export's name, else "Imported flow") */
  name?: string;
}

export class ExternalFlowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExternalFlowError";
  }
}
