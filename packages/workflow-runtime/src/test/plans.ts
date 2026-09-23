/** Test-only: the compiler's golden plans and a compiler over the fixture manifests. */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ExecutionPlanSchema,
  NodeManifestSchema,
  WORKFLOW_SCHEMA_URI,
  type ExecutionPlan,
  type NodeCatalog,
  type NodeManifest,
} from "@flowaid/workflow-core";
import { compile } from "@flowaid/workflow-compiler";

const HERE = dirname(fileURLToPath(import.meta.url));
const CORE = join(HERE, "../../../workflow-core/fixtures");
const PLANS = join(HERE, "../../../workflow-compiler/fixtures/plans");

export function goldenPlan(
  name: "support-triage" | "github-issue-triage" | "research-agent",
): ExecutionPlan {
  return ExecutionPlanSchema.parse(
    JSON.parse(readFileSync(join(PLANS, `${name}.plan.json`), "utf8")),
  );
}

const MANIFESTS: NodeManifest[] = readdirSync(join(CORE, "manifests"))
  .filter((f) => f.endsWith(".json"))
  .map((f) =>
    NodeManifestSchema.parse(JSON.parse(readFileSync(join(CORE, "manifests", f), "utf8"))),
  );

export const catalog: NodeCatalog = {
  get: (id, version) => MANIFESTS.find((m) => m.id === id && (!version || m.version === version)),
  list: () => [...MANIFESTS],
};

/** Compiles a small definition (nodes/edges/inputs/outputs) against the fixture manifests. */
export function planOf(def: {
  nodes: unknown[];
  edges?: unknown[];
  inputs?: unknown;
  outputs?: unknown;
  execution?: unknown;
  variables?: unknown[];
}): ExecutionPlan {
  const definition = {
    $schema: WORKFLOW_SCHEMA_URI,
    id: "00000000-0000-4000-8000-0000000000d1",
    name: "test",
    inputs: def.inputs ?? { type: "object", properties: { x: { type: "number" } } },
    outputs: def.outputs ?? {},
    nodes: def.nodes,
    edges: def.edges ?? [],
    variables: def.variables ?? [],
    execution: def.execution ?? {},
  };
  const result = compile(definition, { catalog, level: "draft" } as never);
  if (!result.ok) {
    throw new Error(
      `compile failed:\n${result.diagnostics
        .filter((d) => d.severity === "error")
        .map((d) => `${d.code} ${d.message}`)
        .join("\n")}`,
    );
  }
  return result.plan;
}

/** A binding referencing `node.port[path]`. */
export const ref = (node: string, port: string, path?: string, dflt?: unknown) => ({
  kind: "ref",
  ref: { kind: "port", node, port, ...(path ? { path } : {}) },
  ...(dflt !== undefined ? { default: dflt } : {}),
});
export const expr = (source: string) => ({ kind: "expr", source });
export const lit = (value: unknown) => ({ kind: "literal", value });
export const transform = (id: string, exprSource: string, extra: Record<string, unknown> = {}) => ({
  id,
  kind: "task",
  name: id,
  type: "flowaid.data.transform",
  typeVersion: "1.0.0",
  config: { expr: exprSource },
  ...extra,
});
