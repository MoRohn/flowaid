/**
 * Pass 2 — catalog & config (ARCHITECTURE.md §4.1, §4.2).
 *
 * Builds one {@link NodeInfo} per node and fixes its ports: task nodes from their manifest,
 * config and port rules; runtime-owned kinds from their definition (§2.4). Config fields that
 * carry data move out of the literal config: `x-ui.bindable` fields holding a Binding go to
 * `configBindings`, `x-ui.widget: 'template'` fields containing a hole go to `configTemplates`.
 * The literal remainder is validated against `configSchema`.
 */
import Ajv2020Module from "ajv/dist/2020.js";
import type { ErrorObject, ValidateFunction } from "ajv";
import { z } from "zod";
import {
  DecisionQuestionSchema,
  DecisionResultJsonSchema,
  HumanDecisionSchema,
  escapePointerToken,
  parseTemplate,
  type Idempotency,
  type IdempotencySpec,
  type JsonSchema,
  type JsonValue,
  type NodeManifest,
  type PortSpec,
  type TaskNode,
  type ToolSource,
  type WorkflowNode,
} from "@flowaid/workflow-core";
import type { CompileContext, NodeInfo } from "../context.js";
import { nodePath } from "../diagnostics.js";
import {
  DATE_TIME_SCHEMA,
  STRING_SCHEMA,
  compareStrings,
  getAtPointer,
  isPlainObject,
  isPortName,
  looksLikeBinding,
  nullableSchema,
} from "../util.js";

/** The JSON Schema of `HumanDecision`, the `decision` output of every human node. */
export const HUMAN_DECISION_JSON_SCHEMA = z.toJSONSchema(HumanDecisionSchema, {
  target: "draft-2020-12",
}) as JsonSchema;

const TEMPLATE_SENTINEL = /^\$template\.[a-z]+\.[A-Za-z0-9_-]+$/;

// ajv is CommonJS: under NodeNext the default import is `module.exports`, whose `default` is the class.
const Ajv2020 = Ajv2020Module.default;
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
const validators = new Map<string, ValidateFunction | Error>();

/** Compiles (once per manifest version) the config validator; an invalid configSchema yields its error. */
function configValidator(manifest: NodeManifest, schema: JsonSchema): ValidateFunction | Error {
  const key = `${manifest.id}@${manifest.version}:${JSON.stringify(schema.required ?? [])}`;
  let validator = validators.get(key);
  if (!validator) {
    try {
      validator = ajv.compile(schema as object);
    } catch (error) {
      validator = error instanceof Error ? error : new Error(String(error));
    }
    validators.set(key, validator);
  }
  return validator;
}

function describeAjvError(error: ErrorObject): string {
  const at = `config${error.instancePath}`;
  if (error.keyword === "additionalProperties") {
    const extra = (error.params as { additionalProperty?: string }).additionalProperty;
    return `${at}: unknown field '${extra ?? "?"}'`;
  }
  if (error.keyword === "required") {
    const missing = (error.params as { missingProperty?: string }).missingProperty;
    return `${at}: missing required field '${missing ?? "?"}'`;
  }
  return `${at}: ${error.message ?? error.keyword}`;
}

function blankInfo(node: WorkflowNode, index: number): NodeInfo {
  return {
    node,
    index,
    scope: node.parent ?? "",
    unresolved: false,
    inputPorts: new Map(),
    outputs: new Map(),
    controlOut: [],
    exclusiveFamilies: [],
    idempotency: "safe",
    pool: "general",
    compiled: new Map(),
    configTemplates: new Map(),
    configBindings: new Map(),
    configExpressions: new Set(),
    dataIn: [],
    controlIn: [],
  };
}

function port(name: string, schema: JsonSchema, required: boolean): PortSpec {
  return { name, schema, required };
}

function uniqueInOrder(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export function catalogPass(ctx: CompileContext): void {
  const { definition, diagnostics } = ctx;
  definition.nodes.forEach((node, index) => {
    const info = blankInfo(node, index);
    if (!ctx.byId.has(node.id)) ctx.byId.set(node.id, info);
    ctx.nodes.push(info);
    if (node.kind === "note") {
      ctx.dropped.add(node.id);
      return;
    }
    if (node.disabled) ctx.dropped.add(node.id);
    switch (node.kind) {
      case "task":
        resolveTask(ctx, info, node);
        break;
      case "input":
        setupInput(ctx, info);
        break;
      case "output":
        info.inputPorts.set("value", port("value", {}, true));
        break;
      case "branch": {
        const cases = uniqueInOrder(node.cases.map((c) => c.port));
        info.controlOut = uniqueInOrder([...cases, node.defaultPort]);
        info.exclusiveFamilies = node.mode === "first" ? [info.controlOut] : [];
        info.outputs.set("taken", { type: "array", items: STRING_SCHEMA });
        break;
      }
      case "join":
        info.controlOut = node.timeoutMs === undefined ? ["done"] : ["done", "timeout"];
        info.exclusiveFamilies = [info.controlOut];
        // `values` is refined from the compiled inputs by the bindings pass.
        info.outputs.set("values", { type: "object" });
        info.outputs.set("first", { type: ["string", "null"] });
        break;
      case "loop":
        info.controlOut = uniqueInOrder([
          "done",
          ...(node.onExhausted === "route" ? ["exhausted"] : []),
          ...(node.policy?.onError === "route" ? ["failed"] : []),
        ]);
        info.exclusiveFamilies = [info.controlOut];
        info.outputs.set("result", { type: "object" });
        info.outputs.set("carry", node.carrySchema);
        info.outputs.set("iterations", { type: "integer", minimum: 0 });
        break;
      case "foreach":
        info.controlOut = node.policy?.onError === "route" ? ["done", "failed"] : ["done"];
        info.exclusiveFamilies = [info.controlOut];
        info.outputs.set("results", { type: "array" });
        info.outputs.set("errors", {
          type: "array",
          items: {
            type: "object",
            properties: { index: { type: "integer", minimum: 0 }, error: { type: "object" } },
            required: ["index", "error"],
          },
        });
        if (node.reduce) info.outputs.set("reduced", {});
        break;
      case "subflow":
        info.controlOut = ["done", "failed"];
        info.exclusiveFamilies = [info.controlOut];
        // Refined from the resolved signature by the structure pass.
        info.outputs.set("output", { type: "object" });
        break;
      case "wait":
        info.controlOut = node.until.type === "event" ? ["done", "timeout"] : ["done"];
        info.exclusiveFamilies = [info.controlOut];
        info.outputs.set(
          "payload",
          node.until.type === "event" && node.until.payloadSchema
            ? nullableSchema(node.until.payloadSchema)
            : { type: "null" },
        );
        info.outputs.set("fired_at", DATE_TIME_SCHEMA);
        if (node.until.type === "timestamp")
          info.inputPorts.set("at", port("at", DATE_TIME_SCHEMA, true));
        break;
      case "human": {
        const mode = node.mode;
        const outcomes =
          mode.type === "approval" || mode.type === "review"
            ? ["approved", "rejected"]
            : mode.type === "form"
              ? ["submitted"]
              : mode.options.map((o) => o.id);
        info.controlOut = uniqueInOrder([
          ...outcomes,
          ...(node.onExpire === "route" ? ["expired"] : []),
        ]);
        info.exclusiveFamilies = [info.controlOut];
        info.outputs.set("decision", HUMAN_DECISION_JSON_SCHEMA);
        if (mode.type === "review" || mode.type === "form") info.outputs.set("value", mode.schema);
        break;
      }
    }
    if (info.exclusiveFamilies.some((f) => f.length < 2)) {
      info.exclusiveFamilies = info.exclusiveFamilies.filter((f) => f.length >= 2);
    }
  });
  void diagnostics;
}

function setupInput(ctx: CompileContext, info: NodeInfo): void {
  info.controlOut = ["done"];
  const schema = ctx.definition.inputs;
  const properties = isPlainObject(schema.properties) ? schema.properties : {};
  for (const [name, propSchema] of Object.entries(properties)) {
    info.outputs.set(name, propSchema);
  }
}

function resolveTask(ctx: CompileContext, info: NodeInfo, node: TaskNode): void {
  const { diagnostics, options } = ctx;
  const path = nodePath(info.index);
  const manifest = options.catalog.get(node.type, node.typeVersion);
  if (!manifest) {
    info.unresolved = true;
    info.controlOut = ["done"];
    const latest = options.catalog.get(node.type);
    if (latest) {
      diagnostics.add(
        "E_NODE_VERSION_UNSUPPORTED",
        `Node type '${node.type}' has no version ${node.typeVersion} (available: ${latest.version})`,
        { nodeId: node.id, path: `${path}/typeVersion` },
        {
          fix: {
            title: `Use version ${latest.version}`,
            patch: [{ op: "replace", path: `${path}/typeVersion`, value: latest.version }],
          },
        },
      );
    } else {
      diagnostics.add("E_UNKNOWN_NODE_TYPE", `Unknown node type '${node.type}'`, {
        nodeId: node.id,
        path: `${path}/type`,
      });
    }
    return;
  }
  info.manifest = manifest;

  const latest = options.catalog.get(node.type);
  if (latest && latest.version !== manifest.version && newer(latest.version, manifest.version)) {
    diagnostics.add(
      "I_NODE_VERSION_OUTDATED",
      `'${node.type}' ${manifest.version} is outdated; ${latest.version} is available`,
      { nodeId: node.id, path: `${path}/typeVersion` },
      latest.migrations.includes(manifest.version) || latest.migrations.length === 0
        ? {
            fix: {
              title: `Migrate to ${latest.version}`,
              patch: [{ op: "replace", path: `${path}/typeVersion`, value: latest.version }],
            },
          }
        : {},
    );
  }
  if (manifest.metadata.deprecated) {
    const d = manifest.metadata.deprecated;
    diagnostics.add(
      "W_NODE_DEPRECATED",
      `'${node.type}' is deprecated since ${d.since}: ${d.message}${d.replaceWith ? ` (use ${d.replaceWith})` : ""}`,
      { nodeId: node.id, path: `${path}/type` },
    );
  }
  if (!node.type.startsWith("@") && !node.type.startsWith("flowaid.")) {
    diagnostics.add(
      "E_PLUGIN_ID_PREFIX",
      `Node type '${node.type}' must be scoped ('@scope/…'); unscoped ids are reserved for flowaid.*`,
      { nodeId: node.id, path: `${path}/type` },
    );
  }

  // Pool: sandboxed code runs only on the code pool, and only sandboxed code runs there.
  const sandboxed = manifest.capabilities.includes("sandbox");
  const requestedPool = node.policy?.pool;
  info.pool = requestedPool ?? manifest.pool;
  if (requestedPool !== undefined && requestedPool !== manifest.pool) {
    if (sandboxed || requestedPool === "code") {
      diagnostics.add(
        "E_POOL_NOT_ALLOWED",
        sandboxed
          ? `'${node.type}' runs sandboxed code and must use the '${manifest.pool}' pool`
          : `Only sandboxed code nodes may run on the 'code' pool`,
        { nodeId: node.id, path: `${path}/policy/pool` },
      );
      info.pool = manifest.pool;
    }
  }

  splitConfig(ctx, info, node, manifest);

  // Static ports, then port rules in manifest order.
  for (const input of manifest.inputs) info.inputPorts.set(input.name, input);
  for (const output of manifest.outputs) info.outputs.set(output.name, output.schema);
  if (manifest.dynamicInputs) info.dynamicInputSchema = manifest.dynamicInputs.schema;
  const rulePorts: string[] = [];
  for (let i = 0; i < manifest.portRules.length; i += 1) {
    applyPortRule(ctx, info, node, manifest, i, rulePorts);
  }
  info.controlOut = uniqueInOrder([
    "done",
    ...(node.policy?.onError === "route" ? ["failed"] : []),
    ...manifest.controlPorts.map((c) => c.name),
    ...rulePorts,
  ]);
  info.exclusiveFamilies = [info.controlOut];
  info.idempotency =
    info.tool?.idempotency ?? resolveIdempotency(manifest.idempotency, info.literalConfig ?? {});
}

function newer(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

function resolveIdempotency(spec: IdempotencySpec, config: Record<string, JsonValue>): Idempotency {
  if (typeof spec === "string") return spec;
  const value = getAtPointer(config, spec.byConfig);
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return spec.cases[String(value)] ?? spec.default;
  }
  return spec.default;
}

/** Moves bindings and templated strings out of the config, then validates the literal rest. */
function splitConfig(
  ctx: CompileContext,
  info: NodeInfo,
  node: TaskNode,
  manifest: NodeManifest,
): void {
  const { diagnostics } = ctx;
  const path = nodePath(info.index, "config");
  const schema = manifest.configSchema;
  const properties = isPlainObject(schema.properties) ? schema.properties : {};
  const literal: Record<string, JsonValue> = {};
  const moved = new Set<string>();
  for (const [key, value] of Object.entries(node.config)) {
    const prop = properties[key];
    const hints =
      prop && isPlainObject(prop["x-ui"]) ? (prop["x-ui"] as Record<string, unknown>) : {};
    const pointer = "/" + escapePointerToken(key);
    if (hints.bindable === true && looksLikeBinding(value)) {
      moved.add(key);
      // Compiled (and type-checked) by the bindings pass.
      info.configBindings.set(pointer, { kind: "literal", value: null, schema: {} });
      continue;
    }
    if (hints.widget === "code" && hints.language === "flowexpr" && typeof value === "string") {
      moved.add(key);
      info.configExpressions.add(pointer);
      // Compiled (and type-checked) by the bindings pass.
      info.configBindings.set(pointer, { kind: "literal", value: null, schema: {} });
      continue;
    }
    if (hints.widget === "template" && typeof value === "string" && /(^|[^\\])\{\{/.test(value)) {
      const parsed = parseTemplate(value);
      if (!parsed.ok) {
        diagnostics.add("E_TEMPLATE_SYNTAX", parsed.message, {
          nodeId: node.id,
          path: `${path}${pointer}`,
          range: { start: parsed.offset, end: parsed.offset + 1 },
        });
      } else {
        info.configTemplates.set(pointer, parsed.template);
      }
      moved.add(key);
      continue;
    }
    if (typeof value === "string" && TEMPLATE_SENTINEL.test(value)) {
      diagnostics.add(
        "E_TOOL_UNRESOLVED",
        `'${key}' still holds the template placeholder ${value}; choose the resource to use`,
        { nodeId: node.id, path: `${path}${pointer}` },
        { fix: { title: "Choose the resource", patch: [] } },
      );
      moved.add(key);
      continue;
    }
    literal[key] = value;
  }
  info.literalConfig = literal;

  // Required fields satisfied by a binding or template are checked by those passes instead.
  const required = Array.isArray(schema.required)
    ? schema.required.filter((r) => !moved.has(r))
    : undefined;
  const effective: JsonSchema = required === undefined ? schema : { ...schema, required };
  const validator = configValidator(manifest, effective);
  if (validator instanceof Error) {
    diagnostics.add(
      "E_CONFIG_INVALID",
      `The configSchema of '${manifest.id}@${manifest.version}' is invalid: ${validator.message}`,
      { nodeId: node.id, path },
    );
    return;
  }
  if (!validator(literal)) {
    for (const error of validator.errors ?? []) {
      diagnostics.add("E_CONFIG_INVALID", describeAjvError(error), {
        nodeId: node.id,
        path: `${path}${error.instancePath}`,
      });
    }
  }
}

function applyPortRule(
  ctx: CompileContext,
  info: NodeInfo,
  node: TaskNode,
  manifest: NodeManifest,
  index: number,
  rulePorts: string[],
): void {
  const { diagnostics, options } = ctx;
  const rule = manifest.portRules[index];
  if (!rule) return;
  const config = info.literalConfig ?? {};
  const where = { nodeId: node.id, path: nodePath(info.index, "config") };
  const invalid = (message: string, pointer?: string) =>
    diagnostics.add("E_PORT_RULE_INVALID", message, {
      ...where,
      ...(pointer ? { path: `${where.path}${pointer}` } : {}),
    });

  switch (rule.kind) {
    case "controlPortsFromConfig": {
      const value = getAtPointer(config, rule.path);
      if (value === undefined) {
        if (!info.configBindings.has(rule.path) && !info.configTemplates.has(rule.path)) {
          invalid(`Control ports come from config ${rule.path}, which is not set`, rule.path);
        } else {
          invalid(
            `Control ports come from config ${rule.path}, which must be a literal`,
            rule.path,
          );
        }
        return;
      }
      const names = Array.isArray(value) ? value : isPlainObject(value) ? Object.keys(value) : null;
      if (names === null) {
        invalid(
          `Config ${rule.path} must be a list or an object to derive control ports`,
          rule.path,
        );
        return;
      }
      for (const name of names) {
        if (typeof name !== "string" || !isPortName(name)) {
          invalid(
            `'${String(name)}' in ${rule.path} cannot be a control port (snake_case, ≤64 characters)`,
            rule.path,
          );
          continue;
        }
        rulePorts.push(name);
      }
      return;
    }
    case "outputSchemaFromConfig":
    case "inputSchemaFromConfig": {
      const value = getAtPointer(config, rule.path);
      if (value === undefined) return; // optional: the static port stays
      if (!isPlainObject(value) && typeof value !== "boolean") {
        invalid(`Config ${rule.path} must be a JSON Schema`, rule.path);
        return;
      }
      const schema = (
        typeof value === "boolean" ? (value ? {} : { not: {} }) : value
      ) as JsonSchema;
      if (rule.kind === "outputSchemaFromConfig") {
        info.outputs.set(rule.port, schema);
      } else {
        const existing = info.inputPorts.get(rule.port);
        info.inputPorts.set(rule.port, { ...(existing ?? port(rule.port, schema, true)), schema });
      }
      return;
    }
    case "decisionAnswersFromConfig": {
      const value = getAtPointer(config, rule.path);
      if (!isPlainObject(value)) {
        invalid(`Config ${rule.path} must map question ids to decision questions`, rule.path);
        return;
      }
      const properties: Record<string, JsonSchema> = {};
      for (const id of Object.keys(value).sort(compareStrings)) {
        const question = DecisionQuestionSchema.safeParse(value[id]);
        if (!question.success) {
          invalid(
            `Question '${id}' in ${rule.path} is not a valid decision question`,
            `${rule.path}/${escapePointerToken(id)}`,
          );
          continue;
        }
        properties[id] = DecisionResultJsonSchema[question.data.kind];
      }
      info.outputs.set(rule.port, {
        type: "object",
        properties,
        required: Object.keys(properties),
        additionalProperties: false,
      });
      return;
    }
    case "toolSignature": {
      const source = toolSource(rule.source, config);
      if (!source) {
        diagnostics.add(
          "E_TOOL_UNRESOLVED",
          `Choose the ${rule.source === "mcp" ? "MCP tool" : rule.source === "openapi" ? "OpenAPI operation" : "workflow"} this node calls`,
          where,
          { fix: { title: "Choose the tool", patch: [] } },
        );
        return;
      }
      const tool = options.resolveTool?.(source);
      if (!tool) {
        diagnostics.add(
          "E_TOOL_UNRESOLVED",
          `The ${rule.source} tool this node calls could not be found`,
          where,
        );
        return;
      }
      const inputSchema = tool.inputSchema;
      const props = isPlainObject(inputSchema.properties) ? inputSchema.properties : null;
      if (!props || (inputSchema.type !== undefined && inputSchema.type !== "object")) {
        diagnostics.add(
          "E_TOOL_SCHEMA_INVALID",
          `Tool '${tool.name}' has an input schema that is not an object with properties`,
          where,
        );
        return;
      }
      info.tool = tool;
      const required = new Set(Array.isArray(inputSchema.required) ? inputSchema.required : []);
      for (const [name, schema] of Object.entries(props)) {
        if (!isPortName(name)) {
          diagnostics.add(
            "E_TOOL_SCHEMA_INVALID",
            `Tool argument '${name}' cannot be a port name`,
            where,
          );
          continue;
        }
        info.inputPorts.set(name, port(name, schema, required.has(name)));
      }
      info.outputs.set("result", tool.outputSchema ?? {});
      info.outputs.set("content", STRING_SCHEMA);
      return;
    }
  }
}

function toolSource(
  kind: "mcp" | "openapi" | "workflow",
  config: Record<string, JsonValue>,
): ToolSource | null {
  const str = (key: string): string | null => {
    const v = config[key];
    return typeof v === "string" && v.length > 0 && !TEMPLATE_SENTINEL.test(v) ? v : null;
  };
  if (kind === "mcp") {
    const serverId = str("serverId");
    const tool = str("tool");
    return serverId && tool ? { kind: "mcp", serverId, tool } : null;
  }
  if (kind === "openapi") {
    const toolsetId = str("toolsetId");
    const operationId = str("operationId");
    return toolsetId && operationId ? { kind: "openapi", toolsetId, operationId } : null;
  }
  const workflowId = str("workflowId");
  return workflowId ? { kind: "workflow", workflowId } : null;
}
