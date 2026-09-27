/**
 * `compile()` over what the API serves (the same compiler the API and worker run): the node catalog,
 * the workspace's tool signatures and the subflow signatures the definition references.
 */
import { compile } from "@flowaid/workflow-compiler";
import type {
  CompileResult,
  NodeManifest,
  SubflowSignature,
  ToolDefinition,
  ToolSource,
} from "@flowaid/workflow-core";
import { Catalog } from "./model";

export interface CompileRequest {
  definition: unknown;
  manifests: readonly NodeManifest[];
  tools: readonly ToolDefinition[];
  subflows: Record<string, SubflowSignature | null>;
  level: "draft" | "publish";
}

function toolKey(s: ToolSource): string | null {
  switch (s.kind) {
    case "mcp":
      return `mcp|${s.serverId}|${s.tool}`;
    case "openapi":
      return `openapi|${s.toolsetId}|${s.operationId}`;
    case "workflow":
      return `workflow|${s.workflowId}`;
    case "http":
    case "builtin":
      return null;
  }
}

export function compileLocal(req: CompileRequest): CompileResult {
  const catalog = new Catalog(req.manifests);
  const tools = new Map<string, ToolDefinition>();
  for (const t of req.tools) {
    const k = toolKey(t.source);
    if (k) tools.set(k, t);
  }
  return compile(req.definition, {
    catalog: { get: (id, version) => catalog.get(id, version), list: () => [...req.manifests] },
    resolveTool: (source) => {
      const k = toolKey(source);
      return k ? tools.get(k) : undefined;
    },
    resolveSubflow: (workflowId) => req.subflows[workflowId] ?? undefined,
    level: req.level,
  });
}
