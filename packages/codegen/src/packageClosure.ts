/**
 * `packageClosure(plan)` (CODE_EXPORT.md §1): the `@flowaid/*` packages an exported flow needs —
 * the embedded runtime, the `provider-*` packages of the plan's model refs, `mcp` /
 * `openapi-tools` / `sandbox` by node type, `langchain` / `nodes-langchain` for `langchain.*` nodes
 * or `langchain:*` providers, and `workflow-sdk` for `src/workflow.ts` and `src/client.ts` — closed
 * over their own `@flowaid` dependencies so a vendored install needs nothing from a registry.
 */
import type { ExecutionPlan } from "@flowaid/workflow-core";

/** Direct `@flowaid` dependencies of every package an export can include (from their package.json). */
export const RUNTIME_DEPENDENCIES: Readonly<Record<string, readonly string[]>> = {
  shared: [],
  env: ["shared"],
  "workflow-core": ["shared"],
  "workflow-compiler": ["shared", "workflow-core"],
  "workflow-runtime": [
    "credentials",
    "env",
    "node-sdk",
    "observability",
    "providers",
    "shared",
    "workflow-compiler",
    "workflow-core",
  ],
  "node-sdk": ["shared", "workflow-core"],
  "nodes-core": ["knowledge", "mcp", "node-sdk", "providers", "shared", "workflow-core"],
  knowledge: ["shared", "workflow-core"],
  providers: ["shared", "workflow-core"],
  credentials: ["env", "shared", "workflow-core"],
  observability: ["credentials", "shared", "workflow-core"],
  "provider-typesafe": ["providers", "shared", "workflow-core"],
  "provider-openai": ["providers", "shared", "workflow-core"],
  "provider-anthropic": ["providers", "shared", "workflow-core"],
  "provider-ollama": ["providers", "shared", "workflow-core"],
  mcp: ["shared", "workflow-core"],
  "openapi-tools": ["shared", "workflow-core"],
  sandbox: ["shared", "workflow-core"],
  "workflow-sdk": ["shared", "workflow-core"],
  langchain: ["node-sdk", "providers", "shared", "workflow-core"],
  "nodes-langchain": ["langchain", "node-sdk", "providers", "shared", "workflow-core"],
};

/** The release each package ships at (npm-mode exports pin these; a test keeps them in sync). */
export const PACKAGE_VERSIONS: Readonly<Record<string, string>> = {
  shared: "0.1.0",
  env: "0.1.0",
  "workflow-core": "0.3.7",
  "workflow-compiler": "0.1.0",
  "workflow-runtime": "0.1.0",
  "node-sdk": "0.1.0",
  "nodes-core": "0.1.0",
  knowledge: "0.1.0",
  providers: "0.1.0",
  credentials: "0.1.0",
  observability: "0.1.0",
  "provider-typesafe": "0.1.0",
  "provider-openai": "0.1.0",
  "provider-anthropic": "0.1.0",
  "provider-ollama": "0.1.0",
  mcp: "0.1.0",
  "openapi-tools": "0.1.0",
  sandbox: "0.1.0",
  "workflow-sdk": "0.1.0",
  langchain: "0.1.0",
  "nodes-langchain": "0.1.0",
};

/** The embedded runtime every export needs (CODE_EXPORT.md §1). */
export const BASE_PACKAGES = [
  "workflow-core",
  "workflow-compiler",
  "workflow-runtime",
  "node-sdk",
  "nodes-core",
  "providers",
  "credentials",
  "observability",
  "workflow-sdk",
] as const;

/** Provider id → the package whose factories implement it. */
export const PROVIDER_PACKAGES: Readonly<Record<string, string>> = {
  typesafe: "provider-typesafe",
  openai: "provider-openai",
  google: "provider-openai",
  "openai-compatible": "provider-openai",
  anthropic: "provider-anthropic",
  ollama: "provider-ollama",
};

/** Every provider id the plan references: decision hops, `llm` hop models and model refs in configs. */
export function providerIds(plan: ExecutionPlan): string[] {
  const found = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const v of value) visit(v);
      return;
    }
    if (value === null || typeof value !== "object") return;
    const o = value as Record<string, unknown>;
    if (typeof o.provider === "string" && !["llm", "rule", "human", "custom"].includes(o.provider))
      found.add(o.provider);
    for (const v of Object.values(o)) visit(v);
  };
  visit(plan.execution);
  for (const node of Object.values(plan.nodes)) {
    visit(node.policy);
    if (node.op.kind === "task") visit(node.op.config);
  }
  for (const group of Object.values(plan.batchGroups)) visit(group.primary);
  return [...found].sort();
}

/** Node type ids of the plan's task nodes. */
export function nodeTypes(plan: ExecutionPlan): string[] {
  const types = new Set<string>();
  for (const node of Object.values(plan.nodes))
    if (node.op.kind === "task") types.add(node.op.type);
  return [...types].sort();
}

/** The `@flowaid/*` short names the flow needs, transitively closed and sorted. */
export function packageClosure(plan: ExecutionPlan): string[] {
  const wanted = new Set<string>(BASE_PACKAGES);
  for (const id of providerIds(plan)) {
    if (id.startsWith("langchain:")) wanted.add("langchain");
    const pkg = PROVIDER_PACKAGES[id];
    if (pkg) wanted.add(pkg);
  }
  for (const type of nodeTypes(plan)) {
    if (type.startsWith("flowaid.tools.mcp")) wanted.add("mcp");
    if (type === "flowaid.tools.openapi") wanted.add("openapi-tools");
    if (type === "flowaid.tools.code" || type === "flowaid.tools.shell") wanted.add("sandbox");
    if (type.startsWith("langchain.")) {
      wanted.add("langchain");
      wanted.add("nodes-langchain");
    }
  }
  if (
    Object.values(plan.nodes).some(
      (n) => n.op.kind === "task" && n.op.tool?.source.kind === "openapi",
    )
  )
    wanted.add("openapi-tools");
  const closed = new Set<string>();
  const add = (name: string): void => {
    if (closed.has(name)) return;
    closed.add(name);
    for (const dep of RUNTIME_DEPENDENCIES[name] ?? []) add(dep);
  };
  for (const name of wanted) add(name);
  return [...closed].sort();
}
