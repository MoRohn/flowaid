/**
 * Pass 8 — emit (ARCHITECTURE.md §4.1). Assembles the immutable {@link ExecutionPlan}: plan nodes
 * with resolved policies, guards, groups and redaction rules; scopes with their deterministic
 * topological order; data edges; batch groups; the catalog snapshot; and `planHash`, the sha256
 * of the canonical plan without `planHash` itself.
 */
import { sha256Json } from "@flowaid/shared";
import {
  definitionHash,
  type CompiledBinding,
  type DataDependency,
  type ExecutionPlan,
  type NodeCapability,
  type PlanNode,
  type PlanOp,
  type PlanScope,
  type WorkerPool,
} from "@flowaid/workflow-core";
import { batchGroups } from "../batching.js";
import type { CompileContext, NodeInfo, TypedDependency } from "../context.js";
import { ALWAYS } from "../guards.js";
import { resolvePolicy } from "../policy.js";
import { redactionRules } from "../redaction.js";
import { cloneJson, compareStrings, sortedUnique } from "../util.js";
import type { ControlFlow } from "./controlflow.js";
import { costBound, decisionChain } from "./environment.js";

const EMPTY_OBJECT_SCHEMA = {};

function plainDependency(dep: TypedDependency): DataDependency {
  const out: DataDependency = {
    from: { node: dep.from.node, port: dep.from.port },
    to: { node: dep.to.node, port: dep.to.port },
    optional: dep.optional,
    via: dep.via,
  };
  if (dep.path !== undefined) out.path = dep.path;
  return out;
}

function compiled(info: NodeInfo, key: string): CompiledBinding {
  return info.compiled.get(key) ?? { kind: "literal", value: null, schema: { type: "null" } };
}

function prefixed(info: NodeInfo, prefix: string): Record<string, CompiledBinding> {
  const out: Record<string, CompiledBinding> = {};
  for (const [key, binding] of info.compiled) {
    if (key.startsWith(prefix)) out[key.slice(prefix.length)] = binding;
  }
  return out;
}

function opOf(ctx: CompileContext, info: NodeInfo, flow: ControlFlow): PlanOp {
  const node = info.node;
  switch (node.kind) {
    case "input":
      return { kind: "input" };
    case "output":
      return {
        kind: "output",
        value: compiled(info, "value"),
        outcome: node.outcome ?? null,
        earlyExit: node.earlyExit,
      };
    case "task": {
      const inputs: Record<string, CompiledBinding> = {};
      for (const port of Object.keys(node.inputs)) {
        const binding = info.compiled.get(port);
        if (binding) inputs[port] = binding;
      }
      if (!info.manifest) throw new Error(`task '${node.id}' reached emit without a manifest`);
      return {
        kind: "task",
        type: node.type,
        typeVersion: node.typeVersion,
        config: cloneJson(info.literalConfig ?? {}),
        configTemplates: Object.fromEntries(info.configTemplates),
        configBindings: Object.fromEntries(info.configBindings),
        inputs,
        credentials: { ...node.credentials },
        manifest: info.manifest,
        tool: info.tool ?? null,
      };
    }
    case "branch":
      return {
        kind: "branch",
        mode: node.mode,
        cases: node.cases.map((c, i) => {
          const when = info.compiled.get(`when/${i}`);
          return {
            port: c.port,
            when: when?.kind === "expr" ? when.ast : { kind: "literal", value: false },
            source: c.when,
          };
        }),
        defaultPort: node.defaultPort,
      };
    case "join":
      return {
        kind: "join",
        mode: node.mode,
        timeoutMs: node.timeoutMs ?? null,
        inputs: Object.fromEntries(
          Object.keys(node.inputs).map((name) => [name, compiled(info, name)]),
        ),
        privateSubgraphs: flow.privateSubgraphs.get(node.id) ?? {},
      };
    case "loop": {
      const exit = info.compiled.get("exitWhen");
      return {
        kind: "loop",
        carrySchema: node.carrySchema,
        initialCarry: node.carry.initial,
        next: prefixed(info, "next/"),
        result: prefixed(info, "result/"),
        exitWhen: exit?.kind === "expr" ? exit.ast : null,
        bounds: node.bounds,
        onExhausted: node.onExhausted,
        bodyScope: node.id,
      };
    }
    case "foreach": {
      const items = compiled(info, "items");
      const itemSchema =
        node.itemSchema ??
        (typeof items.schema.items === "object" &&
        items.schema.items !== null &&
        !Array.isArray(items.schema.items)
          ? items.schema.items
          : EMPTY_OBJECT_SCHEMA);
      const reduce = info.compiled.get("reduce");
      return {
        kind: "foreach",
        items,
        itemSchema,
        concurrency: node.concurrency,
        failurePolicy: node.failurePolicy,
        bounds: node.bounds,
        collect: info.compiled.get("collect") ?? null,
        reduce:
          node.reduce && reduce?.kind === "expr"
            ? { initial: node.reduce.initial, expr: reduce.ast }
            : null,
        bodyScope: node.id,
      };
    }
    case "subflow":
      return {
        kind: "subflow",
        workflowId: node.workflowId,
        versionId: node.version === "deployed" ? null : node.version.versionId,
        inputs: Object.fromEntries(
          Object.keys(node.inputs).map((key) => [key, compiled(info, key)]),
        ),
        inputSchema: info.subflowSignature?.inputs ?? EMPTY_OBJECT_SCHEMA,
        outputSchema: info.subflowSignature?.outputs ?? EMPTY_OBJECT_SCHEMA,
        timeoutMs: node.timeoutMs ?? null,
      };
    case "wait": {
      const until = node.until;
      return {
        kind: "wait",
        until:
          until.type === "delay"
            ? { type: "delay", ms: until.ms }
            : until.type === "timestamp"
              ? { type: "timestamp", at: compiled(info, "at") }
              : {
                  type: "event",
                  eventName: until.eventName,
                  timeoutMs: until.timeoutMs,
                  payloadSchema: until.payloadSchema ?? null,
                },
      };
    }
    case "human": {
      const mode = node.mode;
      return {
        kind: "human",
        mode:
          mode.type === "review"
            ? { type: "review", value: compiled(info, "value"), schema: mode.schema }
            : mode.type === "form"
              ? { type: "form", schema: mode.schema }
              : mode.type === "choice"
                ? {
                    type: "choice",
                    options: mode.options.map((o) => ({ id: o.id, label: o.label })),
                  }
                : { type: "approval" },
        title: compiled(info, "title"),
        context: prefixed(info, "context/"),
        assignees: [...node.assignees],
        expiresInMs: node.expiresInMs ?? null,
        onExpire: node.onExpire,
        escalation: node.escalation
          ? { afterMs: node.escalation.afterMs, to: [...node.escalation.to] }
          : null,
        externalReview: node.externalReview,
      };
    }
    case "note":
      throw new Error("note nodes are dropped before emit");
  }
}

function idempotencyOf(info: NodeInfo): PlanNode["idempotency"] {
  if (info.node.kind === "task") return info.idempotency;
  if (info.node.kind === "subflow") return "keyed";
  return "safe";
}

export function emitPass(ctx: CompileContext, flow: ControlFlow): ExecutionPlan {
  const { definition, options } = ctx;
  const active = ctx.active();
  const chain = decisionChain(ctx);
  const groups = batchGroups(ctx, flow.scopes, chain.primary);
  const groupOf = new Map<string, string>();
  for (const group of groups.values()) for (const id of group.nodes) groupOf.set(id, group.id);

  // successors: every node this one activates (control) or feeds (data), across scopes.
  const successors = new Map<string, Set<string>>(
    active.map((n) => [n.node.id, new Set<string>()]),
  );
  for (const info of active) {
    for (const dep of info.dataIn) successors.get(dep.from.node)?.add(info.node.id);
    for (const edge of info.controlIn) successors.get(edge.from.node)?.add(info.node.id);
  }

  const nodes: Record<string, PlanNode> = {};
  const capabilities = new Set<NodeCapability>();
  const pools = new Set<WorkerPool>();
  const catalogSnapshot: Record<string, string> = {};
  for (const info of active) {
    const node = info.node;
    if (node.kind === "note") continue;
    const policy = resolvePolicy(definition, node, info.manifest);
    const kind = node.kind;
    nodes[node.id] = {
      id: node.id,
      name: node.name,
      kind,
      scope: info.scope,
      controlIn: info.controlIn.map((edge) => ({
        edgeId: edge.id,
        from: { node: edge.from.node, port: edge.from.port },
        group: info.groups?.get(edge.id) ?? 0,
      })),
      dataIn: info.dataIn.filter((d) => !ctx.dropped.has(d.from.node)).map(plainDependency),
      controlOut: [...info.controlOut],
      outputs: Object.fromEntries(info.outputs),
      successors: [...(successors.get(node.id) ?? [])]
        .filter((id) => !ctx.dropped.has(id))
        .sort(compareStrings),
      guard: info.guard ?? ALWAYS,
      policy,
      idempotency: idempotencyOf(info),
      pool: info.pool,
      batchGroup: groupOf.get(node.id) ?? null,
      op: opOf(ctx, info, flow),
      redact: redactionRules(info, policy),
    };
    pools.add(info.pool);
    if (info.manifest) {
      for (const c of info.manifest.capabilities) capabilities.add(c);
      catalogSnapshot[info.manifest.id] = info.manifest.version;
    }
  }

  const scopes: Record<string, PlanScope> = {};
  for (const graph of flow.scopes.values()) {
    const container = graph.id === "" ? null : ctx.node(graph.id);
    scopes[graph.id] = {
      id: graph.id,
      parent: container ? container.scope : null,
      kind: container ? (container.node.kind === "loop" ? "loop" : "foreach") : "root",
      container: container ? container.node.id : null,
      nodes: [...graph.nodes],
      order: [...graph.order],
      entries: [...graph.entries],
      outputs: graph.nodes.filter((id) => ctx.node(id)?.node.kind === "output"),
    };
  }

  const plan: Omit<ExecutionPlan, "planHash"> = {
    planVersion: 1,
    workflowId: definition.id,
    definitionHash: definitionHash(definition),
    compilerVersion: options.compilerVersion,
    inputs: definition.inputs,
    outputs: definition.outputs,
    execution: definition.execution,
    variables: definition.variables,
    secrets: definition.secrets,
    triggers: definition.triggers,
    nodes,
    scopes,
    dataEdges: Object.values(nodes).flatMap((n) => n.dataIn),
    batchGroups: Object.fromEntries(groups),
    subflows: active
      .filter((n) => n.node.kind === "subflow")
      .map((n) => {
        const node = n.node;
        if (node.kind !== "subflow") throw new Error("unreachable");
        return {
          node: node.id,
          workflowId: node.workflowId,
          versionId: node.version === "deployed" ? null : node.version.versionId,
        };
      }),
    requiredCapabilities: sortedUnique(capabilities) as NodeCapability[],
    pools: sortedUnique(pools) as WorkerPool[],
    catalogSnapshot: Object.fromEntries(
      Object.entries(catalogSnapshot).sort(([a], [b]) => compareStrings(a, b)),
    ),
    estimate: { maxCostUsd: costBound(ctx), nodeCount: Object.keys(nodes).length },
  };
  const canonical = cloneJson(plan);
  return { ...canonical, planHash: sha256Json(canonical) };
}
