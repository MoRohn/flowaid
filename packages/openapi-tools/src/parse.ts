/**
 * `parseOpenApi` (ARCHITECTURE.md §10.3): loads an OpenAPI 3.0/3.1 document from text or a URL and
 * returns it validated and dereferenced. External `$ref`s are resolved here — through the caller's
 * fetch, at most 10 documents, 3 hops and 5 MiB each, never to private addresses — and inlined, so
 * the parser runs with external and file resolution switched off. YAML is read with the core schema
 * only; documents are capped at 2 MiB, 500 operations and schema depth 32; `servers[]` resolving to
 * private addresses are rejected (`E_TOOL_SERVER_PRIVATE`); 3.0 `nullable` is normalised.
 */
import { dereference, validate } from "@readme/openapi-parser";
import { parseDocument } from "yaml";
import { OpenApiImportError } from "./errors.js";
import { isPrivateUrl } from "./network.js";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type JsonObj = { [k: string]: Json };

export const LIMITS = {
  textBytes: 2 * 1024 * 1024,
  externalBytes: 5 * 1024 * 1024,
  externalDocs: 10,
  hops: 3,
  operations: 500,
  depth: 32,
} as const;
export const HTTP_METHODS = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
] as const;

export interface ParseOptions {
  /** Fetch for the document and its external refs (the API passes SafeFetch). */
  fetch?: FetchLike;
  /** Base URL for relative external refs and servers when the input is text. */
  baseUrl?: string;
  /** Development only: allow private servers and refs (never in production). */
  allowPrivate?: boolean;
  signal?: AbortSignal;
}

export interface ParsedOpenApi {
  document: JsonObj;
  version: "3.0" | "3.1";
  title: string;
  operationCount: number;
  servers: string[];
  warnings: string[];
}

const isObj = (v: unknown): v is JsonObj =>
  typeof v === "object" && v !== null && !Array.isArray(v);

async function readCapped(res: Response, max: number, what: string): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > max)
    throw new OpenApiImportError("E_OPENAPI_TOO_LARGE", `${what} is larger than ${max} bytes`);
  const reader: ReadableStreamDefaultReader<Uint8Array> | undefined = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new OpenApiImportError("E_OPENAPI_TOO_LARGE", `${what} is larger than ${max} bytes`);
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** JSON or YAML (core schema: no custom tags, no merge keys, bounded aliases). */
export function parseText(text: string, format?: "json" | "yaml"): JsonObj {
  if (Buffer.byteLength(text) > LIMITS.textBytes)
    throw new OpenApiImportError(
      "E_OPENAPI_TOO_LARGE",
      `the document is larger than ${LIMITS.textBytes} bytes`,
    );
  let value: unknown;
  try {
    if (format === "json" || (format === undefined && /^\s*[{[]/.test(text)))
      value = JSON.parse(text);
    else {
      const doc = parseDocument(text, {
        schema: "core",
        merge: false,
        customTags: [],
        uniqueKeys: true,
        logLevel: "silent",
      });
      const problem = doc.errors[0] ?? doc.warnings.find((w) => w.code === "TAG_RESOLVE_FAILED");
      if (problem) throw new Error(problem.message);
      value = doc.toJS({ maxAliasCount: 100 });
    }
  } catch (error) {
    throw new OpenApiImportError(
      "E_OPENAPI_INVALID",
      `cannot parse the document: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isObj(value))
    throw new OpenApiImportError("E_OPENAPI_INVALID", "the document is not an object");
  return value;
}

function unescapeToken(t: string) {
  return decodeURIComponent(t).replace(/~1/g, "/").replace(/~0/g, "~");
}

function atPointer(doc: Json, pointer: string): Json | undefined {
  if (pointer === "" || pointer === "/") return doc;
  let cur: Json | undefined = doc;
  for (const token of pointer.replace(/^\//, "").split("/").map(unescapeToken)) {
    if (Array.isArray(cur)) cur = cur[Number(token)];
    else if (isObj(cur)) cur = cur[token];
    else return undefined;
  }
  return cur;
}

/** Inlines every external `$ref` under `x-flowaid-external` and rewrites refs to local pointers. */
async function resolveExternalRefs(
  root: JsonObj,
  baseUrl: string | undefined,
  o: ParseOptions,
): Promise<void> {
  const docs = new Map<string, { doc: JsonObj; hop: number }>();
  const store: JsonObj = {};
  const placed = new Map<string, string>();
  const load = async (url: string, hop: number): Promise<JsonObj> => {
    const hit = docs.get(url);
    if (hit) return hit.doc;
    if (hop > LIMITS.hops)
      throw new OpenApiImportError(
        "E_OPENAPI_EXTERNAL_REF",
        `external references nest deeper than ${LIMITS.hops} hops (${url})`,
      );
    if (docs.size >= LIMITS.externalDocs)
      throw new OpenApiImportError(
        "E_OPENAPI_EXTERNAL_REF",
        `more than ${LIMITS.externalDocs} external documents`,
      );
    if (!/^https?:/i.test(url))
      throw new OpenApiImportError(
        "E_OPENAPI_EXTERNAL_REF",
        `only http(s) external references are allowed (${url})`,
      );
    if (!o.allowPrivate && isPrivateUrl(url))
      throw new OpenApiImportError(
        "E_OPENAPI_EXTERNAL_REF",
        `external reference to a private address: ${url}`,
      );
    if (!o.fetch)
      throw new OpenApiImportError(
        "E_OPENAPI_EXTERNAL_REF",
        `external reference ${url} cannot be fetched here`,
      );
    const res = await o.fetch(url, {
      redirect: "error",
      ...(o.signal ? { signal: o.signal } : {}),
    });
    if (!res.ok)
      throw new OpenApiImportError(
        "E_OPENAPI_EXTERNAL_REF",
        `external reference ${url} returned ${res.status}`,
      );
    const doc = parseText(await readCapped(res, LIMITS.externalBytes, url));
    docs.set(url, { doc, hop });
    return doc;
  };
  const visit = async (node: Json, docUrl: string | undefined, hop: number): Promise<Json> => {
    if (Array.isArray(node)) return Promise.all(node.map((n) => visit(n, docUrl, hop)));
    if (!isObj(node)) return node;
    const ref = node.$ref;
    if (typeof ref === "string" && (!ref.startsWith("#") || docUrl !== baseUrl)) {
      const [target = "", fragment = ""] = ref.split("#");
      if (!docUrl && target !== "" && !/^https?:/i.test(target))
        throw new OpenApiImportError(
          "E_OPENAPI_EXTERNAL_REF",
          `relative reference ${ref} needs a document URL`,
        );
      const url = target === "" ? (docUrl ?? "") : new URL(target, docUrl).toString();
      const key = `${url}#${fragment}`;
      let local = placed.get(key);
      if (!local) {
        const name = `ref${placed.size + 1}`;
        local = `#/components/x-flowaid-external/${name}`;
        placed.set(key, local);
        const doc = url === baseUrl || url === "" ? root : await load(url, hop + 1);
        const value = atPointer(doc, fragment);
        if (value === undefined)
          throw new OpenApiImportError("E_OPENAPI_EXTERNAL_REF", `${ref} points at nothing`);
        store[name] = await visit(value, url, url === docUrl ? hop : hop + 1);
      }
      return { ...node, $ref: local };
    }
    const out: JsonObj = {};
    for (const [k, v] of Object.entries(node)) out[k] = await visit(v, docUrl, hop);
    return out;
  };
  const resolved = (await visit(root, baseUrl, 0)) as JsonObj;
  for (const k of Object.keys(root)) delete root[k];
  Object.assign(root, resolved);
  if (placed.size > 0) {
    const components = isObj(root.components) ? root.components : {};
    components["x-flowaid-external"] = store;
    root.components = components;
  }
}

/** 3.0 `nullable: true` → a `null` type (or `anyOf` with null); applied in place. */
export function normalizeNullable(node: Json, depth = 0): void {
  if (depth > 200) return;
  if (Array.isArray(node)) return node.forEach((n) => normalizeNullable(n, depth + 1));
  if (!isObj(node)) return;
  if (node.nullable === true) {
    delete node.nullable;
    if (typeof node.type === "string") node.type = [node.type, "null"];
    else if (Array.isArray(node.type)) {
      if (!node.type.includes("null")) node.type.push("null");
    } else if (Array.isArray(node.enum)) node.enum.push(null);
  } else if (node.nullable === false) delete node.nullable;
  for (const v of Object.values(node)) normalizeNullable(v, depth + 1);
}

/** Maximum nesting depth, visiting each shared (dereferenced) node once per depth bound. */
function schemaDepth(root: unknown): number {
  const best = new Map<object, number>();
  let max = 0;
  const walk = (node: unknown, depth: number) => {
    if (typeof node !== "object" || node === null || depth > LIMITS.depth + 9) return;
    if ((best.get(node) ?? -1) >= depth) return;
    best.set(node, depth);
    max = Math.max(max, depth);
    for (const v of Object.values(node)) walk(v, depth + 1);
  };
  walk(root, 0);
  return max;
}

export function resolveServerUrls(doc: JsonObj, baseUrl?: string): string[] {
  const servers = Array.isArray(doc.servers) ? doc.servers.filter(isObj) : [];
  return servers
    .map((s) => {
      let url = typeof s.url === "string" ? s.url : "";
      const vars = isObj(s.variables) ? s.variables : {};
      url = url.replace(/\{([^}]+)\}/g, (_m, name: string) => {
        const v = vars[name];
        return isObj(v) && typeof v.default === "string" ? v.default : "";
      });
      try {
        return new URL(url, baseUrl).toString();
      } catch {
        return url;
      }
    })
    .filter(Boolean);
}

export function checkServers(urls: readonly string[], allowPrivate = false): void {
  if (allowPrivate) return;
  for (const url of urls)
    if (isPrivateUrl(url))
      throw new OpenApiImportError(
        "E_TOOL_SERVER_PRIVATE",
        `server ${url} resolves to a private address`,
      );
}

export async function parseOpenApi(
  input: { url: string } | { text: string; format?: "json" | "yaml" },
  o: ParseOptions = {},
): Promise<ParsedOpenApi> {
  let root: JsonObj;
  let baseUrl = o.baseUrl;
  if ("url" in input) {
    if (!o.allowPrivate && isPrivateUrl(input.url))
      throw new OpenApiImportError(
        "E_TOOL_SERVER_PRIVATE",
        `the document URL is a private address: ${input.url}`,
      );
    if (!o.fetch)
      throw new OpenApiImportError("E_OPENAPI_INVALID", "no fetch was provided for a URL import");
    const res = await o.fetch(input.url, { ...(o.signal ? { signal: o.signal } : {}) });
    if (!res.ok)
      throw new OpenApiImportError("E_OPENAPI_INVALID", `${input.url} returned ${res.status}`);
    root = parseText(await readCapped(res, LIMITS.textBytes, "the document"));
    baseUrl = input.url;
  } else root = parseText(input.text, input.format);

  const version =
    typeof root.openapi === "string"
      ? root.openapi
      : typeof root.swagger === "string"
        ? `swagger ${root.swagger}`
        : "";
  if (!/^3\.[01]\./.test(version))
    throw new OpenApiImportError(
      "E_OPENAPI_UNSUPPORTED",
      `only OpenAPI 3.0 and 3.1 are supported (got ${version || "no version"})`,
    );

  await resolveExternalRefs(root, baseUrl, o);
  const opts = {
    resolve: { external: false, file: false },
    dereference: { circular: "ignore" as const },
    validate: {
      errors: { colorize: false },
      rules: { openapi: { "array-without-items": "warning" as const } },
    },
  };
  const result = await validate(structuredClone(root) as never, opts);
  if (!result.valid)
    throw new OpenApiImportError(
      "E_OPENAPI_INVALID",
      result.errors
        .map((e) => e.message)
        .slice(0, 5)
        .join("; "),
    );

  let operationCount = 0;
  for (const item of Object.values(isObj(root.paths) ? root.paths : {}))
    if (isObj(item)) for (const m of HTTP_METHODS) if (isObj(item[m])) operationCount++;
  if (operationCount > LIMITS.operations)
    throw new OpenApiImportError(
      "E_OPENAPI_TOO_LARGE",
      `${operationCount} operations (limit ${LIMITS.operations})`,
    );

  const servers = resolveServerUrls(root, baseUrl);
  const nested: string[] = [];
  for (const item of Object.values(isObj(root.paths) ? root.paths : {})) {
    if (!isObj(item)) continue;
    nested.push(...resolveServerUrls(item, baseUrl));
    for (const m of HTTP_METHODS)
      if (isObj(item[m])) nested.push(...resolveServerUrls(item[m], baseUrl));
  }
  checkServers([...servers, ...nested], o.allowPrivate);

  const document = (await dereference(root as never, opts)) as unknown as JsonObj;
  if (schemaDepth(document) > LIMITS.depth + 8)
    throw new OpenApiImportError(
      "E_OPENAPI_TOO_LARGE",
      `schemas nest deeper than ${LIMITS.depth} levels`,
    );
  if (version.startsWith("3.0")) normalizeNullable(document);
  const info = isObj(document.info) ? document.info : {};
  return {
    document,
    version: version.startsWith("3.0") ? "3.0" : "3.1",
    title: typeof info.title === "string" ? info.title : "API",
    operationCount,
    servers,
    warnings: result.warnings.map((w) => w.message),
  };
}
