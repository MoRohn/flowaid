/**
 * `executeOperation` (ARCHITECTURE.md §10.3): coerces and validates arguments, builds the request
 * (path templating with `encodeURIComponent`, query serialisation, JSON / form / multipart / text
 * bodies), applies auth, forwards `Idempotency-Key` for keyed operations, refuses arguments that set
 * `Host`, `Content-Length` or an undeclared `Authorization` header or any CR/LF header value,
 * re-checks the server address, and maps ≥ 400 to `ToolExecutionError{ retryable }`. Response
 * bodies are read up to OPENAPI_RESPONSE_MAX_BYTES; a longer one is cut (and not parsed as JSON).
 */
import Ajv2020Module from "ajv/dist/2020.js";
import {
  BadRequestError,
  CredentialError,
  NetworkError,
  SchemaValidationError,
  ToolExecutionError,
  type JsonObject,
  type JsonValue,
  type ToolDefinition,
  type ToolResult,
} from "@flowaid/workflow-core";
import { coerceArgs } from "./coerce.js";
import { OpenApiImportError } from "./errors.js";
import type { FetchLike } from "./parse.js";
import { isPrivateUrl } from "./network.js";
import type { OperationSpec, ParameterSpec } from "./operations.js";

const Ajv2020 = Ajv2020Module.default;
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
const validators = new WeakMap<object, ReturnType<typeof ajv.compile>>();

export interface BoundCredential {
  /** credential type id, e.g. `http.bearer`, `oauth2.client_credentials` */
  type: string;
  fields: Readonly<Record<string, string>>;
}

export interface ExecuteOptions {
  fetch: FetchLike;
  credential?: BoundCredential | null;
  idempotencyKey?: string | null;
  signal?: AbortSignal;
  timeoutMs?: number;
  allowPrivate?: boolean;
  /** Token cache for the client-credentials grant, shared across calls. */
  tokenCache?: Map<string, { token: string; expiresAt: number }>;
  now?: () => number;
}

/** Query/form text for a JSON value (objects as JSON). */
const str = (v: JsonValue): string =>
  typeof v === "string"
    ? v
    : typeof v === "number" || typeof v === "boolean"
      ? String(v)
      : JSON.stringify(v);

/** UTF-8 bytes of a response body that are read; the rest is dropped and the result marked. */
export const OPENAPI_RESPONSE_MAX_BYTES = 1_048_576;

/** The body's text up to `max` bytes; reading stops (and the stream is cancelled) past it. */
async function readCapped(
  res: Response,
  max: number,
): Promise<{ text: string; truncated: boolean }> {
  if (!res.body) return { text: "", truncated: false };
  const reader: ReadableStreamDefaultReader<Uint8Array> = res.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    size += value.length;
    if (size > max) {
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
  }
  const bytes = new Uint8Array(Math.min(size, max));
  let at = 0;
  for (const part of parts) {
    const take = part.subarray(0, Math.min(part.length, bytes.length - at));
    bytes.set(take, at);
    at += take.length;
    if (at >= bytes.length) break;
  }
  // a multi-byte character cut at the boundary decodes to U+FFFD: drop it
  const text = new TextDecoder().decode(bytes);
  return { text: truncated ? text.replace(/\uFFFD$/, "") : text, truncated };
}

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);
const REFUSED_HEADERS = new Set(["host", "content-length", "transfer-encoding", "connection"]);

function serialiseQuery(url: URL, p: ParameterSpec, value: JsonValue) {
  if (value === null || value === undefined) return;
  const explode = p.explode ?? (p.style === undefined || p.style === "form");
  if (Array.isArray(value)) {
    if (explode) for (const v of value) url.searchParams.append(p.name, str(v));
    else
      url.searchParams.append(
        p.name,
        value
          .map(str)
          .join(p.style === "pipeDelimited" ? "|" : p.style === "spaceDelimited" ? " " : ","),
      );
  } else if (typeof value === "object") {
    if (p.style === "deepObject")
      for (const [k, v] of Object.entries(value))
        url.searchParams.append(`${p.name}[${k}]`, str(v));
    else if (explode)
      for (const [k, v] of Object.entries(value)) url.searchParams.append(k, str(v));
    else
      url.searchParams.append(
        p.name,
        Object.entries(value)
          .flatMap(([k, v]) => [k, str(v)])
          .join(","),
      );
  } else url.searchParams.append(p.name, str(value));
}

async function clientCredentialsToken(cred: BoundCredential, o: ExecuteOptions): Promise<string> {
  const f = cred.fields;
  if (!f.tokenUrl || !f.clientId || !f.clientSecret)
    throw new CredentialError(
      "oauth2.client_credentials needs tokenUrl, clientId and clientSecret",
    );
  const now = (o.now ?? Date.now)();
  const key = `${f.tokenUrl}|${f.clientId}|${f.scope ?? ""}`;
  const hit = o.tokenCache?.get(key);
  if (hit && hit.expiresAt - 30_000 > now) return hit.token;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    ...(f.scope ? { scope: f.scope } : {}),
    ...(f.audience ? { audience: f.audience } : {}),
  });
  const res = await o.fetch(f.tokenUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
      authorization: `Basic ${Buffer.from(`${encodeURIComponent(f.clientId)}:${encodeURIComponent(f.clientSecret)}`).toString("base64")}`,
    },
    body: body.toString(),
    ...(o.signal ? { signal: o.signal } : {}),
  });
  if (!res.ok)
    throw new CredentialError(`the client-credentials token request failed with ${res.status}`);
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new CredentialError("the token response has no access_token");
  o.tokenCache?.set(key, {
    token: json.access_token,
    expiresAt: now + (json.expires_in ?? 3600) * 1000,
  });
  return json.access_token;
}

async function applyAuth(
  op: OperationSpec,
  cred: BoundCredential | null | undefined,
  headers: Headers,
  url: URL,
  o: ExecuteOptions,
) {
  if (!cred) return;
  const f = cred.fields;
  switch (cred.type) {
    case "http.bearer":
      headers.set("authorization", `Bearer ${f.token ?? ""}`);
      return;
    case "http.basic":
      headers.set(
        "authorization",
        `Basic ${Buffer.from(`${f.username ?? ""}:${f.password ?? ""}`).toString("base64")}`,
      );
      return;
    case "http.header":
      if (f.name) headers.set(f.name, f.value ?? "");
      return;
    case "http.api_key": {
      // The operation's apiKey scheme decides where the key goes; the credential's own settings otherwise.
      const scheme = op.security.find((s) => s.type === "apiKey");
      const where = scheme?.type === "apiKey" ? scheme.in : (f.in ?? "header");
      const name = scheme?.type === "apiKey" ? scheme.name : (f.name ?? "X-API-Key");
      if (where === "query") url.searchParams.set(name, f.key ?? "");
      else if (where === "cookie")
        headers.set("cookie", `${name}=${encodeURIComponent(f.key ?? "")}`);
      else headers.set(name, f.key ?? "");
      return;
    }
    case "oauth2.client_credentials":
      headers.set("authorization", `Bearer ${await clientCredentialsToken(cred, o)}`);
      return;
    default:
      throw new CredentialError(`credential type ${cred.type} cannot authenticate OpenAPI calls`);
  }
}

function buildBody(
  op: OperationSpec,
  body: JsonValue | undefined,
  headers: Headers,
): string | FormData | undefined {
  if (body === undefined || !op.requestBody) return undefined;
  const type = op.requestBody.contentType;
  if (/json/i.test(type)) {
    headers.set("content-type", type);
    return JSON.stringify(body);
  }
  if (type === "application/x-www-form-urlencoded") {
    headers.set("content-type", type);
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries((body ?? {}) as JsonObject))
      form.append(k, typeof v === "string" ? v : JSON.stringify(v));
    return form.toString();
  }
  if (type === "multipart/form-data") {
    const form = new FormData();
    for (const [k, v] of Object.entries((body ?? {}) as JsonObject))
      form.append(k, typeof v === "string" ? v : JSON.stringify(v));
    return form; // fetch sets the boundary
  }
  headers.set("content-type", type);
  return typeof body === "string" ? body : JSON.stringify(body);
}

export async function executeOperation(
  op: OperationSpec,
  tool: ToolDefinition,
  rawArgs: JsonValue,
  o: ExecuteOptions,
): Promise<ToolResult> {
  const started = (o.now ?? Date.now)();
  const { value: args, coerced } = coerceArgs(tool.inputSchema, rawArgs ?? {});
  let validate = validators.get(tool.inputSchema);
  if (!validate) {
    validate = ajv.compile(tool.inputSchema as object);
    validators.set(tool.inputSchema, validate);
  }
  if (!validate(args))
    throw new SchemaValidationError(
      `arguments do not match ${tool.name}`,
      (validate.errors ?? []).map((e) => ({
        path: e.instancePath,
        message: e.message ?? e.keyword,
      })),
    );
  const a = (args ?? {}) as JsonObject;
  const pathArgs = (a.path ?? {}) as JsonObject;
  const queryArgs = (a.query ?? {}) as JsonObject;
  const headerArgs = (a.headers ?? {}) as JsonObject;

  let path = op.path;
  for (const p of op.parameters.filter((x) => x.in === "path")) {
    const v = pathArgs[p.name];
    if (v === undefined || v === null)
      throw new BadRequestError(`path parameter ${p.name} is required`);
    path = path.replaceAll(
      `{${p.name}}`,
      encodeURIComponent(Array.isArray(v) ? v.map(str).join(",") : str(v)),
    );
  }
  const base = op.serverUrl.endsWith("/") ? op.serverUrl.slice(0, -1) : op.serverUrl;
  let url: URL;
  try {
    url = new URL(base + path);
  } catch {
    throw new BadRequestError(`cannot build a URL from server ${op.serverUrl} and path ${path}`);
  }
  if (!o.allowPrivate && isPrivateUrl(url))
    throw new OpenApiImportError(
      "E_TOOL_SERVER_PRIVATE",
      `server ${url.origin} is a private address`,
    );
  for (const p of op.parameters.filter((x) => x.in === "query"))
    if (queryArgs[p.name] !== undefined) serialiseQuery(url, p, queryArgs[p.name] as JsonValue);

  const headers = new Headers({ accept: "application/json, text/plain;q=0.9, */*;q=0.5" });
  const declared = new Set(
    op.parameters.filter((p) => p.in === "header").map((p) => p.name.toLowerCase()),
  );
  for (const [k, v] of Object.entries(headerArgs)) {
    const lower = k.toLowerCase();
    if (REFUSED_HEADERS.has(lower))
      throw new BadRequestError(`the ${k} header cannot be set by arguments`);
    if (lower === "authorization" && !declared.has("authorization"))
      throw new BadRequestError("the Authorization header comes from the bound credential");
    const text = typeof v === "string" ? v : JSON.stringify(v);
    if (/[\r\n]/.test(text) || /[\r\n:]/.test(k))
      throw new BadRequestError(`header ${k} contains a line break`);
    headers.set(k, text);
  }
  await applyAuth(op, o.credential, headers, url, o);
  if (op.idempotency === "keyed" && o.idempotencyKey && !headers.has("idempotency-key"))
    headers.set("Idempotency-Key", o.idempotencyKey);
  const body = buildBody(op, a.body, headers);

  const signals = [o.signal, o.timeoutMs ? AbortSignal.timeout(o.timeoutMs) : undefined].filter(
    (s): s is AbortSignal => s !== undefined,
  );
  let res: Response;
  try {
    res = await o.fetch(url.toString(), {
      method: op.method.toUpperCase(),
      headers,
      ...(body !== undefined ? { body } : {}),
      ...(signals.length ? { signal: AbortSignal.any(signals) } : {}),
    });
  } catch (error) {
    if (o.signal?.aborted) throw error;
    throw new NetworkError(
      `${op.method.toUpperCase()} ${url.origin}${url.pathname} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const read =
    res.status === 204
      ? { text: "", truncated: false }
      : await readCapped(res, OPENAPI_RESPONSE_MAX_BYTES);
  const text = read.truncated
    ? `${read.text}\n[truncated: the response exceeded ${OPENAPI_RESPONSE_MAX_BYTES} bytes]`
    : read.text;
  let parsed: JsonValue = text === "" ? null : text;
  if (text && !read.truncated && /json/i.test(res.headers.get("content-type") ?? "")) {
    try {
      parsed = JSON.parse(text) as JsonValue;
    } catch {
      /* keep text */
    }
  }
  if (res.status >= 400)
    throw new ToolExecutionError(
      `${tool.name} returned ${res.status}`,
      RETRYABLE.has(res.status) || res.status >= 500,
      tool.name,
      {
        status: res.status,
        body: typeof parsed === "string" ? parsed.slice(0, 2000) : parsed,
      },
    );
  return {
    ok: true,
    content: typeof parsed === "string" ? parsed : JSON.stringify(parsed),
    structured: {
      status: res.status,
      body: parsed,
      ...(read.truncated ? { truncated: true } : {}),
    },
    ...(coerced.length ? { coerced } : {}),
    latencyMs: Math.max(0, (o.now ?? Date.now)() - started),
  };
}
