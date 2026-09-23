/**
 * Pass 3 — structure (ARCHITECTURE.md §4.1): ids, the input/output nodes, container nesting,
 * control edges, declared secrets and variables, credential slots, decision and human configs,
 * side-effect policies, subflow signatures and trigger conflicts.
 */
import Ajv2020Module from "ajv/dist/2020.js";
import { RESERVED_IDS, type JsonSchema, type TaskNode, type Trigger } from "@flowaid/workflow-core";
import type { CompileContext, NodeInfo } from "../context.js";
import { edgePath, nodePath } from "../diagnostics.js";
import { resolvePolicy } from "../policy.js";
import { isPlainObject } from "../util.js";

const MAX_SCOPE_DEPTH = 4;
const CHOICE_KEY = /^[a-z0-9_]{1,64}$/;

const Ajv2020 = Ajv2020Module.default;
const ajv = new Ajv2020({ strict: false, allErrors: false, validateFormats: false });

export function structurePass(ctx: CompileContext): void {
  checkIds(ctx);
  checkScopes(ctx);
  checkInputOutput(ctx);
  checkEdges(ctx);
  checkVariables(ctx);
  for (const info of ctx.active()) {
    if (info.node.kind === "task") {
      checkCredentials(ctx, info, info.node);
      checkDecisionConfig(ctx, info, info.node);
      checkAgentBounds(ctx, info, info.node);
    }
    if (info.node.kind === "human") checkHuman(ctx, info);
    if (info.node.kind === "subflow") checkSubflow(ctx, info);
    checkSideEffects(ctx, info);
  }
  checkTriggers(ctx);
}

function checkIds(ctx: CompileContext): void {
  const { diagnostics, definition } = ctx;
  const seen = new Map<string, number>();
  for (const info of ctx.nodes) {
    const { id } = info.node;
    const first = seen.get(id);
    if (first !== undefined) {
      diagnostics.add(
        "E_DUPLICATE_NODE_ID",
        `Node id '${id}' is used more than once`,
        { nodeId: id, path: nodePath(info.index, "id") },
        { related: [{ nodeId: id, message: `first used at /nodes/${first}` }] },
      );
      // The duplicate is excluded so every later pass sees unique ids.
      ctx.excludedIndexes.add(info.index);
      continue;
    }
    seen.set(id, info.index);
    if (RESERVED_IDS.has(id)) {
      diagnostics.add(
        "E_RESERVED_ID",
        `'${id}' is reserved (an expression keyword or function name)`,
        {
          nodeId: id,
          path: nodePath(info.index, "id"),
        },
      );
    }
  }
  const edgeIds = new Set<string>();
  definition.edges.forEach((edge, i) => {
    if (edgeIds.has(edge.id)) {
      diagnostics.add("E_DUPLICATE_EDGE_ID", `Edge id '${edge.id}' is used more than once`, {
        edgeId: edge.id,
        path: edgePath(i, "id"),
      });
    }
    edgeIds.add(edge.id);
  });
  const names = new Map<string, string>();
  for (const info of ctx.active()) {
    const other = names.get(info.node.name);
    if (other !== undefined && other !== info.node.id) {
      diagnostics.add(
        "W_DUPLICATE_NAME",
        `'${info.node.id}' has the same name as '${other}' ("${info.node.name}")`,
        { nodeId: info.node.id, path: nodePath(info.index, "name") },
        { related: [{ nodeId: other, message: "same name" }] },
      );
    } else {
      names.set(info.node.name, info.node.id);
    }
  }
}

/** Validates `parent` chains; the scope of an invalid parent falls back to the root. */
function checkScopes(ctx: CompileContext): void {
  const { diagnostics } = ctx;
  for (const info of ctx.nodes) {
    const parent = info.node.parent;
    if (parent === undefined || info.node.kind === "note") continue;
    const container = ctx.node(parent);
    if (!container || (container.node.kind !== "loop" && container.node.kind !== "foreach")) {
      diagnostics.add(
        "E_PARENT_NOT_CONTAINER",
        container
          ? `'${info.node.id}' has parent '${parent}', which is a ${container.node.kind}, not a loop or foreach`
          : `'${info.node.id}' has parent '${parent}', which does not exist`,
        { nodeId: info.node.id, path: nodePath(info.index, "parent") },
      );
      info.scope = "";
      continue;
    }
    if (info.node.kind === "input" || info.node.kind === "output") {
      diagnostics.add(
        "E_PARENT_NOT_CONTAINER",
        `${info.node.kind} nodes belong to the root scope; remove the parent of '${info.node.id}'`,
        { nodeId: info.node.id, path: nodePath(info.index, "parent") },
      );
      info.scope = "";
      continue;
    }
    // Depth and cycles along the parent chain.
    const chain: string[] = [info.node.id];
    let cursor: string | undefined = parent;
    let cyclic = false;
    while (cursor !== undefined) {
      if (chain.includes(cursor)) {
        cyclic = true;
        break;
      }
      chain.push(cursor);
      cursor = ctx.node(cursor)?.node.parent;
    }
    if (cyclic) {
      diagnostics.add(
        "E_PARENT_NOT_CONTAINER",
        `The parent chain of '${info.node.id}' loops back on itself`,
        {
          nodeId: info.node.id,
          path: nodePath(info.index, "parent"),
        },
      );
      info.scope = "";
      continue;
    }
    const depth = chain.length - 1;
    if (depth > MAX_SCOPE_DEPTH) {
      diagnostics.add(
        "E_SCOPE_DEPTH",
        `'${info.node.id}' is nested ${depth} containers deep; the limit is ${MAX_SCOPE_DEPTH}`,
        { nodeId: info.node.id, path: nodePath(info.index, "parent"), scope: parent },
      );
    }
  }
  for (const info of ctx.active()) {
    if (info.scope === "") continue;
    const body = ctx.bodies.get(info.scope) ?? [];
    body.push(info.node.id);
    ctx.bodies.set(info.scope, body);
  }
}

function checkInputOutput(ctx: CompileContext): void {
  const { diagnostics } = ctx;
  const inputs = ctx.active().filter((n) => n.node.kind === "input");
  const outputs = ctx.active().filter((n) => n.node.kind === "output" && n.scope === "");
  if (inputs.length === 0) {
    diagnostics.add("E_NO_INPUT_NODE", "The workflow needs exactly one input node", {
      path: "/nodes",
    });
  }
  for (const extra of inputs.slice(1)) {
    diagnostics.add(
      "E_MULTIPLE_INPUT_NODES",
      `'${extra.node.id}' is a second input node; keep exactly one`,
      {
        nodeId: extra.node.id,
        path: nodePath(extra.index),
      },
    );
  }
  if (outputs.length === 0) {
    diagnostics.add("E_NO_OUTPUT_NODE", "The workflow needs at least one output node", {
      path: "/nodes",
    });
  }
}

function checkEdges(ctx: CompileContext): void {
  const { diagnostics, definition } = ctx;
  const seenIds = new Set<string>();
  /** Targets that lost a control edge because its source is disabled. */
  const deadTargets = new Map<string, number>();
  definition.edges.forEach((edge, i) => {
    if (seenIds.has(edge.id)) return;
    seenIds.add(edge.id);
    const where = { edgeId: edge.id, path: edgePath(i) };
    const from = ctx.node(edge.from.node);
    const to = ctx.node(edge.to.node);
    const missing = [
      !from || from.node.kind === "note" ? `source '${edge.from.node}'` : null,
      !to || to.node.kind === "note" ? `target '${edge.to.node}'` : null,
    ].filter((m): m is string => m !== null);
    if (missing.length > 0) {
      diagnostics.add(
        "E_EDGE_ENDPOINT_MISSING",
        `Edge '${edge.id}' has no ${missing.join(" and no ")}`,
        where,
      );
      return;
    }
    if (!from || !to) return;
    if (edge.from.node === edge.to.node) {
      diagnostics.add(
        "E_SELF_EDGE",
        `Edge '${edge.id}' connects '${edge.from.node}' to itself`,
        where,
      );
      return;
    }
    if (to.node.kind === "input") {
      diagnostics.add(
        "E_EDGE_ENDPOINT_MISSING",
        `Edge '${edge.id}' targets the input node, which starts the run and has no control-in`,
        where,
      );
      return;
    }
    if (!from.unresolved && !from.controlOut.includes(edge.from.port)) {
      diagnostics.add(
        "E_UNKNOWN_CONTROL_PORT",
        `'${edge.from.node}' has no control-out '${edge.from.port}' (it has ${from.controlOut.map((p) => `'${p}'`).join(", ") || "none"})`,
        { ...where, nodeId: edge.from.node, port: edge.from.port },
      );
      return;
    }
    if (from.scope !== to.scope) {
      diagnostics.add(
        "E_EDGE_CROSSES_SCOPE",
        `Edge '${edge.id}' crosses a container boundary ('${edge.from.node}' in ${from.scope || "the root scope"}, '${edge.to.node}' in ${to.scope || "the root scope"})`,
        where,
      );
      return;
    }
    if (ctx.dropped.has(edge.from.node)) {
      deadTargets.set(edge.to.node, (deadTargets.get(edge.to.node) ?? 0) + 1);
      return;
    }
    if (ctx.dropped.has(edge.to.node)) return;
    to.controlIn.push(edge);
  });
  // A node activated only through disabled nodes never runs.
  for (const [target] of deadTargets) {
    const info = ctx.node(target);
    if (info && info.controlIn.length === 0 && !ctx.dropped.has(target)) {
      ctx.diagnostics.add(
        "W_UNREACHABLE",
        `'${target}' is activated only by disabled nodes and never runs`,
        {
          nodeId: target,
          path: nodePath(info.index),
        },
      );
      ctx.dropped.add(target);
    }
  }
}

function checkVariables(ctx: CompileContext): void {
  ctx.definition.variables.forEach((variable, i) => {
    if (variable.default === undefined) return;
    let valid: boolean;
    try {
      valid = ajv.validate(variable.schema as object, variable.default);
    } catch {
      valid = false;
    }
    if (!valid) {
      ctx.diagnostics.add(
        "E_VARIABLE_DEFAULT_INVALID",
        `The default of $vars.${variable.name} does not match its schema${ajv.errors?.[0] ? `: ${ajv.errorsText(ajv.errors)}` : ""}`,
        { path: `/variables/${i}/default` },
      );
    }
  });
}

function checkCredentials(ctx: CompileContext, info: NodeInfo, node: TaskNode): void {
  const { diagnostics, definition } = ctx;
  const manifest = info.manifest;
  if (!manifest) return;
  const declared = new Map(definition.secrets.map((s) => [s.name, s]));
  const slots = new Map(manifest.credentials.map((s) => [s.name, s]));
  for (const [slotName, secret] of Object.entries(node.credentials)) {
    const where = { nodeId: node.id, path: nodePath(info.index, "credentials", slotName) };
    ctx.usedSecrets.add(secret);
    const decl = declared.get(secret);
    if (!decl) {
      diagnostics.add(
        "E_SECRET_UNDECLARED",
        `Secret '${secret}' is not declared in the workflow's secrets`,
        where,
        {
          fix: {
            title: `Declare secret ${secret}`,
            patch: [
              {
                op: "add",
                path: "/secrets/-",
                value: {
                  name: secret,
                  credentialType: slots.get(slotName)?.types[0] ?? "http.bearer",
                  required: true,
                },
              },
            ],
          },
        },
      );
      continue;
    }
    const slot = slots.get(slotName);
    if (!slot) {
      diagnostics.add(
        "E_CREDENTIAL_TYPE_MISMATCH",
        `'${node.type}' has no credential slot '${slotName}' (slots: ${[...slots.keys()].join(", ") || "none"})`,
        where,
      );
      continue;
    }
    if (!slot.types.includes(decl.credentialType)) {
      diagnostics.add(
        "E_CREDENTIAL_TYPE_MISMATCH",
        `Slot '${slotName}' accepts ${slot.types.join(" | ")}, but '${secret}' is a ${decl.credentialType}`,
        where,
      );
    }
    const capability = info.tool?.capability;
    if (capability && slot.scopes && !slot.scopes.includes(capability)) {
      diagnostics.add(
        "E_CAPABILITY_MISSING",
        `Tool '${info.tool?.name ?? "?"}' needs capability '${capability}', which slot '${slotName}' does not grant`,
        where,
      );
    }
  }
  for (const slot of manifest.credentials) {
    if (slot.required && node.credentials[slot.name] === undefined) {
      diagnostics.add(
        "E_CREDENTIAL_SLOT_UNBOUND",
        `Credential slot '${slot.name}' (${slot.types.join(" | ")}) is required`,
        { nodeId: node.id, path: nodePath(info.index, "credentials") },
      );
    }
  }
  if (Object.keys(node.credentials).length > 0 && !manifest.capabilities.includes("credentials")) {
    diagnostics.add(
      "E_CAPABILITY_MISSING",
      `'${node.type}' does not declare the credentials capability, so its credentials cannot be used`,
      { nodeId: node.id, path: nodePath(info.index, "credentials") },
    );
  }
}

function checkDecisionConfig(ctx: CompileContext, info: NodeInfo, node: TaskNode): void {
  const kind = info.manifest?.decision?.kind;
  if (!kind) return;
  const config = node.config;
  const where = { nodeId: node.id, path: nodePath(info.index, "config") };
  const fail = (message: string, sub?: string) =>
    ctx.diagnostics.add(
      "E_DECISION_CONFIG",
      message,
      sub ? { ...where, path: `${where.path}/${sub}` } : where,
    );
  const needsInstructions =
    kind === "boolean" || kind === "choice" || kind === "score" || kind === "router";
  if (needsInstructions && Object.hasOwn(config, "instructions")) {
    const text = config.instructions;
    if (typeof text !== "string" || text.trim().length === 0)
      fail("Instructions must not be empty", "instructions");
  }
  if (kind === "choice" || kind === "router") {
    const field = kind === "router" ? "routes" : "options";
    const options = config[field];
    const keys = Array.isArray(options)
      ? options.map(String)
      : isPlainObject(options)
        ? Object.keys(options)
        : null;
    if (keys !== null) {
      if (keys.length < 2 || keys.length > 255)
        fail(`A choice needs 2 to 255 options (has ${keys.length})`, field);
      for (const key of keys) {
        if (!CHOICE_KEY.test(key)) fail(`Option key '${key}' must match ^[a-z0-9_]{1,64}$`, field);
      }
    }
  }
  if (kind === "score") {
    const levels = config.levels;
    if (Array.isArray(levels) && (levels.length < 2 || levels.length > 10)) {
      fail(`A score needs 2 to 10 levels (has ${levels.length})`, "levels");
    }
  }
  if (kind === "boolean" && Object.hasOwn(config, "criteria")) {
    const criteria = config.criteria;
    const t = isPlainObject(criteria) ? criteria.true : undefined;
    const f = isPlainObject(criteria) ? criteria.false : undefined;
    const has = (v: unknown) => typeof v === "string" && v.trim().length > 0;
    if (has(t) !== has(f))
      fail("Boolean criteria need both a true and a false description, or neither", "criteria");
  }
  if (kind === "consensus") {
    const voters = config.voters;
    if (Array.isArray(voters)) {
      if (voters.length < 2 || voters.length > 5)
        fail(`Consensus needs 2 to 5 voters (has ${voters.length})`, "voters");
      const keys = voters.map((v) => JSON.stringify(v));
      if (new Set(keys).size !== keys.length)
        fail("Consensus voters must be pairwise distinct", "voters");
    }
  }
}

/**
 * Agent nodes loop over model calls and tool calls, so they need a step limit (`maxSteps`) and a
 * spend limit (a cost or token bound on the node, its manifest defaults or the workflow).
 */
function checkAgentBounds(ctx: CompileContext, info: NodeInfo, node: TaskNode): void {
  if (info.manifest?.metadata.category !== "agent") return;
  const where = { nodeId: node.id, path: nodePath(info.index) };
  const steps = node.config.maxSteps;
  if (typeof steps !== "number" || !Number.isInteger(steps) || steps < 1) {
    ctx.diagnostics.add(
      "E_AGENT_UNBOUNDED",
      `Agent '${node.id}' needs config.maxSteps (a positive integer)`,
      {
        ...where,
        path: nodePath(info.index, "config", "maxSteps"),
      },
    );
  }
  const defaults = info.manifest.defaultPolicy;
  const execution = ctx.definition.execution;
  const spendBound =
    node.policy?.maxCostUsd ??
    node.policy?.maxTokens ??
    (typeof defaults.maxCostUsd === "number" ? defaults.maxCostUsd : undefined) ??
    (typeof defaults.maxTokens === "number" ? defaults.maxTokens : undefined) ??
    execution.maxCostUsd ??
    execution.maxTokens;
  if (spendBound === undefined) {
    ctx.diagnostics.add(
      "E_AGENT_UNBOUNDED",
      `Agent '${node.id}' has no cost or token bound; set policy.maxCostUsd, policy.maxTokens or execution.maxCostUsd`,
      where,
    );
  }
}

function checkHuman(ctx: CompileContext, info: NodeInfo): void {
  const node = info.node;
  if (node.kind !== "human") return;
  const where = (sub?: string) => ({
    nodeId: node.id,
    path: sub ? nodePath(info.index, sub) : nodePath(info.index),
  });
  if (node.mode.type === "choice") {
    const ids = node.mode.options.map((o) => o.id);
    if (new Set(ids).size !== ids.length) {
      ctx.diagnostics.add("E_HUMAN_CONFIG", "Choice option ids must be unique", where("mode"));
    }
    if (node.onExpire === "route" && ids.includes("expired")) {
      ctx.diagnostics.add(
        "E_HUMAN_CONFIG",
        "'expired' is reserved for the expiry route; rename that option",
        where("mode"),
      );
    }
  }
  if (
    (node.onExpire === "route" || node.onExpire === "escalate") &&
    node.expiresInMs === undefined
  ) {
    ctx.diagnostics.add(
      "E_HUMAN_CONFIG",
      `onExpire '${node.onExpire}' needs expiresInMs`,
      where("onExpire"),
    );
  }
  if (node.onExpire === "escalate" && !node.escalation) {
    ctx.diagnostics.add(
      "E_HUMAN_CONFIG",
      "onExpire 'escalate' needs an escalation",
      where("escalation"),
    );
  }
  if (
    node.escalation &&
    node.expiresInMs !== undefined &&
    node.escalation.afterMs >= node.expiresInMs
  ) {
    ctx.diagnostics.add(
      "E_HUMAN_CONFIG",
      "escalation.afterMs must be shorter than expiresInMs",
      where("escalation"),
    );
  }
  if (
    (node.mode.type === "form" || node.mode.type === "review") &&
    !isSchemaObject(node.mode.schema)
  ) {
    ctx.diagnostics.add(
      "E_HUMAN_CONFIG",
      `The ${node.mode.type} schema must be a JSON Schema object`,
      where("mode"),
    );
  }
}

function isSchemaObject(schema: JsonSchema): boolean {
  try {
    ajv.compile(schema as object);
    return true;
  } catch {
    return false;
  }
}

function checkSideEffects(ctx: CompileContext, info: NodeInfo): void {
  if (info.idempotency !== "none") return;
  const policy = resolvePolicy(ctx.definition, info.node, info.manifest);
  const where = { nodeId: info.node.id, path: nodePath(info.index, "policy") };
  if (policy.retry.maxAttempts > 1) {
    if (policy.retry.allowOnIrreversible) {
      ctx.diagnostics.add(
        "W_RETRY_SIDE_EFFECT",
        `'${info.node.id}' is irreversible and retried up to ${policy.retry.maxAttempts} times; a retry may repeat its side effect`,
        where,
      );
    } else {
      ctx.diagnostics.add(
        "E_RETRY_ON_IRREVERSIBLE",
        `'${info.node.id}' is irreversible (idempotency 'none') and cannot be retried; set retry.allowOnIrreversible to accept duplicate side effects`,
        where,
        {
          fix: {
            title: "Do not retry",
            patch: [{ op: "add", path: `${where.path}/retry`, value: { maxAttempts: 1 } }],
          },
        },
      );
    }
  }
  if (policy.privacy.doNotPersist) {
    ctx.diagnostics.add(
      "E_DONOTPERSIST_SIDE_EFFECT",
      `'${info.node.id}' is irreversible, so its output must be persisted (doNotPersist would make a resumed run repeat it)`,
      where,
    );
  }
}

function checkSubflow(ctx: CompileContext, info: NodeInfo): void {
  const node = info.node;
  if (node.kind !== "subflow") return;
  const { options, definition, diagnostics } = ctx;
  const where = { nodeId: node.id, path: nodePath(info.index) };
  if (node.workflowId === definition.id) {
    diagnostics.add("E_SUBFLOW_CYCLE", `'${node.id}' runs this workflow inside itself`, where);
    return;
  }
  if (!options.resolveSubflow) return;
  const signature = options.resolveSubflow(node.workflowId, node.version);
  if (!signature) {
    diagnostics.add(
      "E_SUBFLOW_UNRESOLVED",
      `Workflow ${node.workflowId} (${node.version === "deployed" ? "deployed version" : node.version.versionId}) was not found`,
      where,
    );
    return;
  }
  info.outputs.set("output", signature.outputs);
  info.subflowSignature = signature;
  // Required child inputs must be bound, unknown ones rejected when the child schema is closed.
  const childProps = isPlainObject(signature.inputs.properties)
    ? Object.keys(signature.inputs.properties)
    : [];
  const required = Array.isArray(signature.inputs.required) ? signature.inputs.required : [];
  for (const key of required) {
    if (!Object.hasOwn(node.inputs, key)) {
      diagnostics.add("E_SUBFLOW_SIGNATURE", `Child input '${key}' is required but not bound`, {
        ...where,
        path: nodePath(info.index, "inputs"),
      });
    }
  }
  if (signature.inputs.additionalProperties === false) {
    for (const key of Object.keys(node.inputs)) {
      if (!childProps.includes(key)) {
        diagnostics.add("E_SUBFLOW_SIGNATURE", `The child workflow has no input '${key}'`, {
          ...where,
          path: nodePath(info.index, "inputs", key),
        });
      }
    }
  }
  // Cycles and depth through the child's own subflow references (deployed versions).
  const maxDepth = definition.execution.maxSubflowDepth;
  const visit = (references: string[], depth: number, trail: string[]): boolean => {
    for (const ref of references) {
      if (ref === definition.id || trail.includes(ref)) {
        diagnostics.add(
          "E_SUBFLOW_CYCLE",
          `Subflows form a cycle: ${[definition.id, ...trail, ref].join(" → ")}`,
          where,
        );
        return false;
      }
      if (depth + 1 > maxDepth) {
        diagnostics.add(
          "E_SUBFLOW_DEPTH",
          `Subflows nest deeper than maxSubflowDepth (${maxDepth})`,
          where,
        );
        return false;
      }
      const child = options.resolveSubflow?.(ref, "deployed");
      if (child && !visit(child.references, depth + 1, [...trail, ref])) return false;
    }
    return true;
  };
  visit(signature.references, 1, [node.workflowId]);
}

function triggerKey(trigger: Trigger): string | null {
  switch (trigger.type) {
    case "webhook":
      return `webhook:${trigger.path}`;
    case "mcp":
      return `mcp:${trigger.toolName}`;
    case "schedule":
      return `schedule:${trigger.cron}:${JSON.stringify(trigger.input)}`;
    case "event":
      return `event:${trigger.eventName}`;
    case "manual":
      return null;
  }
}

function checkTriggers(ctx: CompileContext): void {
  const seen = new Map<string, number>();
  ctx.definition.triggers.forEach((trigger, i) => {
    const key = triggerKey(trigger);
    if (key === null) return;
    const first = seen.get(key);
    if (first !== undefined) {
      ctx.diagnostics.add(
        "E_TRIGGER_CONFLICT",
        `Trigger ${i} duplicates trigger ${first} (${key.split(":")[0]})`,
        {
          path: `/triggers/${i}`,
        },
      );
      return;
    }
    seen.set(key, i);
  });
}
