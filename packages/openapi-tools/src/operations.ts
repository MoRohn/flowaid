/**
 * `operationsToTools` (ARCHITECTURE.md §10.3): one `ToolDefinition` per operation with
 * `inputSchema = { path, query, headers, body }` and `outputSchema = { status, body }` from the 2xx
 * JSON response, idempotency from the method (`x-idempotent: true` makes POST/PATCH keyed),
 * capability from `x-flowaid-capability` or `<toolset>.<read|write>`, and the operation's auth.
 */
import {
  ToolDefinitionSchema,
  type Idempotency,
  type JsonSchema,
  type ToolDefinition,
} from "@flowaid/workflow-core";
import { HTTP_METHODS, resolveServerUrls } from "./parse.js";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type JsonObj = { [k: string]: Json };
const isObj = (v: unknown): v is JsonObj =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export type HttpMethod = (typeof HTTP_METHODS)[number];

export interface ParameterSpec {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required: boolean;
  schema: JsonSchema;
  style?: string;
  explode?: boolean;
}

export type SecurityRequirement =
  | { type: "http"; scheme: "bearer" | "basic" }
  | { type: "apiKey"; in: "header" | "query" | "cookie"; name: string }
  | { type: "oauth2"; tokenUrl?: string; scopes: string[] }
  | { type: "openIdConnect" };

export interface OperationSpec {
  name: string;
  operationId: string | null;
  method: HttpMethod;
  path: string;
  serverUrl: string;
  summary: string;
  parameters: ParameterSpec[];
  requestBody: { contentType: string; required: boolean; schema: JsonSchema } | null;
  /** alternatives; the first one a bound credential satisfies is applied */
  security: SecurityRequirement[];
  idempotency: Idempotency;
}

export interface ToolsetResult {
  tools: ToolDefinition[];
  operations: Record<string, OperationSpec>;
  skipped: { method: string; path: string; reason: string }[];
}

export interface OperationsToToolsOptions {
  toolsetId: string;
  /** short name used for capabilities, e.g. "petstore" */
  toolsetName?: string;
  serverUrl?: string;
  /** operationIds (or tool names) to keep; all when omitted */
  include?: readonly string[];
}

/** A valid tool name from an operationId, else from `<method>_<path>`. */
export function toolNameFor(operationId: string | null, method: string, path: string): string {
  const raw = operationId ?? `${method}_${path.replace(/\{([^}]+)\}/g, "by_$1")}`;
  const name = raw
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return (name || "operation").slice(0, 64);
}

export function idempotencyFor(method: HttpMethod, operation: JsonObj): Idempotency {
  if (method === "get" || method === "head" || method === "options" || method === "trace")
    return "safe";
  if (method === "put" || method === "delete") return "keyed";
  return operation["x-idempotent"] === true ? "keyed" : "none";
}

/** Leftover (circular) `$ref`s become unconstrained, described schemas. */
function clean(schema: Json | undefined): JsonSchema {
  if (!isObj(schema)) return {};
  const walk = (node: Json, depth: number): Json => {
    if (depth > 40) return {};
    if (Array.isArray(node)) return node.map((n) => walk(n, depth + 1));
    if (!isObj(node)) return node;
    if (typeof node.$ref === "string") return { description: `recursive: ${node.$ref}` };
    const out: JsonObj = {};
    for (const [k, v] of Object.entries(node)) {
      if (
        k === "example" ||
        k === "examples" ||
        k === "xml" ||
        k === "discriminator" ||
        k === "externalDocs"
      )
        continue;
      out[k] = walk(v, depth + 1);
    }
    return out;
  };
  return walk(schema, 0) as JsonSchema;
}

function securityOf(doc: JsonObj, operation: JsonObj): SecurityRequirement[] {
  const requirements = Array.isArray(operation.security)
    ? operation.security
    : Array.isArray(doc.security)
      ? doc.security
      : [];
  const schemes =
    isObj(doc.components) && isObj(doc.components.securitySchemes)
      ? doc.components.securitySchemes
      : {};
  const out: SecurityRequirement[] = [];
  for (const req of requirements) {
    if (!isObj(req)) continue;
    for (const [name, scopes] of Object.entries(req)) {
      const s = schemes[name];
      if (!isObj(s)) continue;
      if (s.type === "http" && typeof s.scheme === "string") {
        const scheme = s.scheme.toLowerCase();
        if (scheme === "bearer" || scheme === "basic") out.push({ type: "http", scheme });
      } else if (
        s.type === "apiKey" &&
        typeof s.name === "string" &&
        (s.in === "header" || s.in === "query" || s.in === "cookie")
      )
        out.push({ type: "apiKey", in: s.in, name: s.name });
      else if (s.type === "oauth2") {
        const flows = isObj(s.flows) ? s.flows : {};
        const cc = isObj(flows.clientCredentials) ? flows.clientCredentials : {};
        out.push({
          type: "oauth2",
          ...(typeof cc.tokenUrl === "string" ? { tokenUrl: cc.tokenUrl } : {}),
          scopes: Array.isArray(scopes)
            ? scopes.filter((x): x is string => typeof x === "string")
            : [],
        });
      } else if (s.type === "openIdConnect") out.push({ type: "openIdConnect" });
    }
  }
  return out;
}

function group(params: readonly ParameterSpec[], where: ParameterSpec["in"]): JsonSchema | null {
  const list = params.filter((p) => p.in === where);
  if (list.length === 0) return null;
  const required = list.filter((p) => p.required).map((p) => p.name);
  return {
    type: "object",
    properties: Object.fromEntries(list.map((p) => [p.name, p.schema])),
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  };
}

const JSON_TYPES = /^application\/(?:[\w.+-]+\+)?json$/i;

function requestBodyOf(operation: JsonObj): OperationSpec["requestBody"] {
  const rb = operation.requestBody;
  if (!isObj(rb) || !isObj(rb.content)) return null;
  const types = Object.keys(rb.content);
  const contentType =
    types.find((t) => JSON_TYPES.test(t)) ??
    types.find((t) => t === "application/x-www-form-urlencoded") ??
    types.find((t) => t === "multipart/form-data") ??
    types.find((t) => t.startsWith("text/")) ??
    types[0];
  if (!contentType) return null;
  const media = rb.content[contentType];
  return {
    contentType,
    required: rb.required === true,
    schema: clean(isObj(media) ? media.schema : undefined),
  };
}

function responseSchemaOf(operation: JsonObj): JsonSchema | undefined {
  const responses = isObj(operation.responses) ? operation.responses : {};
  const code =
    Object.keys(responses).find((c) => /^2\d\d$/.test(c)) ??
    (responses["2XX"] ? "2XX" : responses.default ? "default" : undefined);
  const r = code ? responses[code] : undefined;
  if (!isObj(r) || !isObj(r.content)) return undefined;
  const type = Object.keys(r.content).find((t) => JSON_TYPES.test(t));
  const media = type ? r.content[type] : undefined;
  return isObj(media) && isObj(media.schema) ? clean(media.schema) : undefined;
}

export function operationsToTools(document: JsonObj, o: OperationsToToolsOptions): ToolsetResult {
  const defaultServer = o.serverUrl ?? resolveServerUrls(document)[0] ?? "";
  const prefix = toolNameFor(
    o.toolsetName ??
      (isObj(document.info) && typeof document.info.title === "string"
        ? document.info.title
        : "api"),
    "",
    "",
  )
    .toLowerCase()
    .replace(/-/g, "_")
    .slice(0, 40);
  const tools: ToolDefinition[] = [];
  const operations: Record<string, OperationSpec> = {};
  const skipped: ToolsetResult["skipped"] = [];
  const used = new Set<string>();
  for (const [path, item] of Object.entries(isObj(document.paths) ? document.paths : {})) {
    if (!isObj(item)) continue;
    const shared = Array.isArray(item.parameters) ? item.parameters : [];
    for (const method of HTTP_METHODS) {
      const operation = item[method];
      if (!isObj(operation)) continue;
      const operationId = typeof operation.operationId === "string" ? operation.operationId : null;
      let name = toolNameFor(operationId, method, path);
      if (o.include && !o.include.includes(operationId ?? "") && !o.include.includes(name))
        continue;
      if (operation.deprecated === true)
        skipped.push({ method, path, reason: "deprecated (imported anyway)" });
      for (let i = 2; used.has(name); i++)
        name = `${toolNameFor(operationId, method, path).slice(0, 60)}_${i}`;
      used.add(name);
      const byKey = new Map<string, ParameterSpec>();
      for (const p of [
        ...shared,
        ...(Array.isArray(operation.parameters) ? operation.parameters : []),
      ]) {
        if (
          !isObj(p) ||
          typeof p.name !== "string" ||
          typeof p.in !== "string" ||
          !["path", "query", "header", "cookie"].includes(p.in)
        )
          continue;
        byKey.set(`${p.in}:${p.name}`, {
          name: p.name,
          in: p.in as ParameterSpec["in"],
          required: p.in === "path" || p.required === true,
          schema: {
            ...clean(p.schema),
            ...(typeof p.description === "string"
              ? { description: p.description.slice(0, 500) }
              : {}),
          },
          ...(typeof p.style === "string" ? { style: p.style } : {}),
          ...(typeof p.explode === "boolean" ? { explode: p.explode } : {}),
        });
      }
      const parameters = [...byKey.values()].filter((p) => p.in !== "cookie");
      const requestBody = requestBodyOf(operation);
      const own = Array.isArray(operation.servers)
        ? operation.servers
        : Array.isArray(item.servers)
          ? item.servers
          : [];
      const serverUrl = o.serverUrl ?? resolveServerUrls({ servers: own })[0] ?? defaultServer;
      const spec: OperationSpec = {
        name,
        operationId,
        method,
        path,
        serverUrl,
        summary: (typeof operation.summary === "string"
          ? operation.summary
          : typeof operation.description === "string"
            ? operation.description
            : `${method.toUpperCase()} ${path}`
        ).slice(0, 1000),
        parameters,
        requestBody,
        security: securityOf(document, operation),
        idempotency: idempotencyFor(method, operation),
      };
      operations[name] = spec;
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];
      for (const where of ["path", "query", "header"] as const) {
        const g = group(parameters, where);
        const key = where === "header" ? "headers" : where;
        if (g) {
          properties[key] = g;
          if (g.required?.length) required.push(key);
        }
      }
      if (requestBody) {
        properties.body = requestBody.schema;
        if (requestBody.required) required.push("body");
      }
      const response = responseSchemaOf(operation);
      const capability =
        typeof operation["x-flowaid-capability"] === "string"
          ? operation["x-flowaid-capability"]
          : `${prefix || "api"}.${spec.idempotency === "safe" ? "read" : "write"}`;
      tools.push(
        ToolDefinitionSchema.parse({
          name,
          description: spec.summary,
          inputSchema: {
            type: "object",
            properties,
            ...(required.length ? { required } : {}),
            additionalProperties: false,
          },
          outputSchema: {
            type: "object",
            properties: { status: { type: "integer" }, body: response ?? {} },
            required: ["status"],
          },
          capability,
          idempotency: spec.idempotency,
          approvalRequired: operation["x-flowaid-approval"] === true,
          source: { kind: "openapi", toolsetId: o.toolsetId, operationId: name },
        }),
      );
    }
  }
  return { tools, operations, skipped };
}
