/**
 * `toManifest(def)`: the JSON projection of a node definition that the compiler, the API and the
 * browser consume (ARCHITECTURE.md §3.1). Schemas come from `z.toJSONSchema` (draft 2020-12);
 * `.meta()` hints (`x-ui`, `x-dataClass`, `x-secret`) pass through.
 *
 * Conventions on `.meta()`:
 * - `"x-port": { description }` on an input or output property describes the port itself (it
 *   becomes `PortSpec.description` and is removed from the schema, so a schema-level
 *   `description` can say what the value is).
 * - `"x-jsonSchema": <schema>` replaces the generated schema verbatim, for canonical shapes Zod
 *   cannot express (e.g. `DecisionResultJsonSchema`, or an object that requires a key it leaves
 *   untyped).
 *
 * Normalisation (outside verbatim schemas) removes what Zod adds but a manifest does not mean:
 * the ±2^53−1 bounds of integers, `propertyNames: { type: "string" }` on records (keys are
 * always strings), `additionalProperties: {}` on loose objects (the default), and `$schema` on
 * any schema that carries no `$defs` of its own.
 */
import { z } from "zod";
import {
  NodeManifestSchema,
  type DataClass,
  type JsonObject,
  type JsonSchema,
  type NodeManifest,
  type PortSpec,
} from "@flowaid/workflow-core";
import type { AnyNodeDefinition } from "./types.js";

const VERBATIM = "x-flowaid-verbatim";
const SAFE_MAX = Number.MAX_SAFE_INTEGER;
const SAFE_MIN = Number.MIN_SAFE_INTEGER;

type Io = "input" | "output";
type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** `z.toJSONSchema` with the `x-jsonSchema` override applied and the normalisation above. */
export function jsonSchemaOf(schema: z.ZodType, io: Io): JsonSchema {
  const raw = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    io,
    unrepresentable: "any",
    override: (ctx) => {
      const meta = z.globalRegistry.get(ctx.zodSchema);
      const verbatim = meta?.["x-jsonSchema"];
      if (!isObject(verbatim)) return;
      const target = ctx.jsonSchema as Json;
      for (const key of Object.keys(target)) delete target[key];
      const port = meta?.["x-port"];
      Object.assign(
        target,
        JSON.parse(JSON.stringify(verbatim)) as Json,
        isObject(port) ? { "x-port": port } : {},
        { [VERBATIM]: true },
      );
    },
  }) as Json;
  normalise(raw, true);
  return raw;
}

function normalise(node: unknown, root: boolean): void {
  if (Array.isArray(node)) {
    for (const item of node) normalise(item, false);
    return;
  }
  if (!isObject(node)) return;
  // Zod adds `$schema` to the root after overrides run, so this applies to verbatim roots too.
  if (root && !isObject(node.$defs)) delete node.$schema;
  if (node[VERBATIM] === true) {
    delete node[VERBATIM];
    return;
  }
  if (node.type === "integer") {
    if (node.maximum === SAFE_MAX) delete node.maximum;
    if (node.minimum === SAFE_MIN) delete node.minimum;
  }
  if (isObject(node.propertyNames)) {
    if (node.propertyNames.type === "string") delete node.propertyNames.type;
    if (Object.keys(node.propertyNames).length === 0) delete node.propertyNames;
  }
  if (isObject(node.additionalProperties) && Object.keys(node.additionalProperties).length === 0) {
    delete node.additionalProperties;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === "const" || key === "default" || key === "enum" || key === "examples") continue;
    normalise(value, false);
  }
}

function portsOf(shape: z.ZodObject, io: Io): PortSpec[] {
  const object = jsonSchemaOf(shape, io) as Json;
  const required = new Set(Array.isArray(object.required) ? (object.required as string[]) : []);
  return Object.entries(shape.shape).map(([name, property]) => {
    const schema = jsonSchemaOf(property as z.ZodType, io) as Json;
    const port: PortSpec = { name, schema: {}, required: required.has(name) };
    const portMeta = schema["x-port"];
    delete schema["x-port"];
    if (isObject(portMeta) && typeof portMeta.description === "string")
      port.description = portMeta.description;
    const dataClass = schema["x-dataClass"];
    if (
      dataClass === "public" ||
      dataClass === "internal" ||
      dataClass === "sensitive" ||
      dataClass === "pii"
    ) {
      port.dataClass = dataClass satisfies DataClass;
    }
    port.schema = schema;
    return port;
  });
}

export function toManifest(def: AnyNodeDefinition): NodeManifest {
  const manifest: NodeManifest = {
    id: def.id,
    version: def.version,
    metadata: JSON.parse(JSON.stringify(def.metadata)) as NodeManifest["metadata"],
    configSchema: jsonSchemaOf(def.configSchema, "input"),
    inputs: portsOf(def.inputSchema, "input"),
    outputs: portsOf(def.outputSchema, "output"),
    controlPorts: (def.controlPorts ?? []).map((p) => ({ ...p })),
    portRules: (def.portRules ?? []).map((r) => ({ ...r })),
    credentials: (def.credentials ?? []).map(
      (c) => JSON.parse(JSON.stringify(c)) as NodeManifest["credentials"][number],
    ),
    capabilities: [...def.capabilities],
    idempotency: JSON.parse(JSON.stringify(def.idempotency)) as NodeManifest["idempotency"],
    pool: def.pool ?? "general",
    generation: def.generation ?? false,
    streams: def.streams ?? false,
    optionProviders: Object.keys(def.optionProviders ?? {}),
    migrations: Object.keys(def.migrations ?? {}),
    defaultPolicy: JSON.parse(JSON.stringify(def.defaultPolicy ?? {})) as JsonObject,
  };
  if (def.dynamicInputs)
    manifest.dynamicInputs = { schema: jsonSchemaOf(def.dynamicInputs, "input") };
  if (def.decision) manifest.decision = { ...def.decision };
  // The manifest is a contract: validate it the way every consumer will.
  return NodeManifestSchema.parse(manifest);
}
