/**
 * The definition under construction: node ids, the input schema, variables, secrets, edges,
 * layout, and the migration report. Mappers add to it; `finish()` assembles the definition.
 */
import {
  isExpressionFunction,
  isExpressionKeyword,
  type Binding,
  type JsonSchema,
  type JsonValue,
  type WorkflowNode,
} from "@flowaid/workflow-core";
import type {
  ImportIssue,
  ImportIssueCode,
  ImportNodeReport,
  ImportNodeStatus,
  SourceNode,
} from "./types.js";

/** A provider as the importer writes it: the FlowAId provider id and its secret. */
export interface ProviderChoice {
  provider: string;
  model: string;
  secret: { name: string; credentialType: string };
}

export const TYPESAFE_SECRET = { name: "TYPESAFE_API_KEY", credentialType: "typesafe.api_key" };

/** What a source node became: its FlowAId id and the port other nodes read its result from. */
export interface Mapped {
  id: string;
  /** the port `{{ sourceNode }}` resolves to (`text` for a generation, `body` for HTTP, …) */
  port?: string;
  /** the control port its plain outgoing edges leave from */
  donePort: string;
  /** source output index → FlowAId control port (branches, routers, humans) */
  ports?: Record<string, string>;
}

const RESERVED = new Set(["start"]);

export function snake(text: string): string {
  const s = text
    .replace(/Agentflow/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^[^a-z]+/, "")
    .replace(/_+/g, "_")
    .replace(/_$/, "")
    .slice(0, 48);
  return s || "node";
}

export class Builder {
  readonly nodes: WorkflowNode[] = [];
  readonly edges: { id: string; from: { node: string; port: string }; to: { node: string } }[] = [];
  readonly inputProps = new Map<string, JsonSchema>();
  readonly requiredInputs = new Set<string>();
  readonly variables = new Map<
    string,
    { schema: JsonSchema; default?: JsonValue; source: "definition" | "environment" }
  >();
  readonly secrets = new Map<string, string>();
  readonly layout = new Map<string, { x: number; y: number }>();
  readonly issues: ImportIssue[] = [];
  readonly reports: ImportNodeReport[] = [];
  /** source node id → what it became */
  readonly mapped = new Map<string, Mapped>();
  private readonly taken = new Set<string>();
  outputProps = new Map<string, JsonSchema>();

  /** A fresh snake_case node id derived from `hint`. */
  id(hint: string): string {
    const base = snake(hint);
    let candidate = base;
    const blocked = (c: string) =>
      this.taken.has(c) || RESERVED.has(c) || isExpressionFunction(c) || isExpressionKeyword(c);
    for (let i = 1; blocked(candidate); i++) {
      candidate = `${base}_${i}`;
    }
    this.taken.add(candidate);
    return candidate;
  }

  reserve(id: string): string {
    this.taken.add(id);
    return id;
  }

  add(node: WorkflowNode, at?: { x?: number; y?: number }): void {
    this.nodes.push(node);
    if (at) this.layout.set(node.id, { x: Math.round(at.x ?? 0), y: Math.round(at.y ?? 0) });
  }

  edge(from: string, port: string, to: string): void {
    if (this.edges.some((e) => e.from.node === from && e.from.port === port && e.to.node === to))
      return;
    const base = `e_${from}_${port}_${to}`.slice(0, 76);
    let id = base;
    for (let i = 2; this.edges.some((e) => e.id === id); i++) id = `${base}_${i}`;
    this.edges.push({ id, from: { node: from, port }, to: { node: to } });
  }

  input(name: string, schema: JsonSchema = { type: "string" }, required = false): void {
    if (!this.inputProps.has(name)) this.inputProps.set(name, schema);
    if (required) this.requiredInputs.add(name);
  }

  variable(name: string, def: JsonValue | undefined, source: "definition" | "environment"): void {
    if (this.variables.has(name)) return;
    this.variables.set(name, {
      schema: {},
      ...(def !== undefined ? { default: def } : {}),
      source,
    });
  }

  secret(name: string, credentialType: string): string {
    this.secrets.set(name, credentialType);
    return name;
  }

  issue(
    code: ImportIssueCode,
    message: string,
    at: { nodeId?: string; sourceId?: string } = {},
  ): void {
    this.issues.push({
      code,
      severity: code === "E_IMPORT_UNSUPPORTED" ? "error" : "warning",
      message,
      ...at,
    });
  }

  report(
    src: SourceNode,
    status: ImportNodeStatus,
    extra: { nodeId?: string; targetType?: string; message?: string } = {},
  ): void {
    this.reports.push({
      sourceId: src.id,
      sourceType: src.data.name,
      name: src.data.label ?? src.data.name,
      status,
      ...extra,
    });
  }

  /** A placeholder for a node the importer cannot translate; compiling it fails loudly. */
  todo(
    src: SourceNode,
    reason: string,
    controlPorts: string[] = ["done"],
    source?: unknown,
    planned?: string,
  ): string {
    const id = planned ?? this.id(src.id);
    this.add(
      {
        id,
        kind: "task",
        name: src.data.label ?? src.data.name,
        type: "flowaid.dev.todo",
        typeVersion: "1.0.0",
        config: {
          sourceType: src.data.name,
          reason,
          controlPorts,
          ...(source !== undefined ? { source: source as JsonValue } : {}),
        },
        inputs: {},
        credentials: {},
        disabled: false,
      },
      src.position,
    );
    this.issue("E_IMPORT_UNSUPPORTED", `${src.data.label ?? src.data.name}: ${reason}`, {
      nodeId: id,
      sourceId: src.id,
    });
    this.report(src, "unsupported", {
      nodeId: id,
      targetType: "flowaid.dev.todo",
      message: reason,
    });
    return id;
  }
}

export const lit = (value: JsonValue): Binding => ({ kind: "literal", value });
export const portRef = (node: string, port: string, path?: string): Binding => ({
  kind: "ref",
  ref: { kind: "port", node, port, ...(path ? { path } : {}) },
});
