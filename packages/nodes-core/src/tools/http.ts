import { z } from "zod";
import { defineNode, ok } from "@flowaid/node-sdk";
import {
  BadRequestError,
  NetworkError,
  ToolExecutionError,
  type JsonValue,
} from "@flowaid/workflow-core";

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const FORBIDDEN_HEADERS = new Set(["host", "content-length", "connection", "transfer-encoding"]);

/** Applies a bound `http.*` credential (bearer, basic, api_key, header) to the request. */
export function applyAuth(cred: Record<string, string>, headers: Headers, url: URL): void {
  if (cred.token !== undefined) headers.set("authorization", `Bearer ${cred.token}`);
  else if (cred.username !== undefined && cred.password !== undefined)
    headers.set(
      "authorization",
      `Basic ${Buffer.from(`${cred.username}:${cred.password}`).toString("base64")}`,
    );
  else if (cred.key !== undefined) {
    const name = cred.name ?? "X-API-Key";
    if (cred.in === "query") url.searchParams.set(name, cred.key);
    else headers.set(name, cred.key);
  } else if (cred.name !== undefined && cred.value !== undefined)
    headers.set(cred.name, cred.value);
}

async function parseBody(
  res: Response,
  responseType: "json" | "text" | "binary",
  put: (bytes: Uint8Array, mime: string) => Promise<JsonValue>,
): Promise<JsonValue> {
  if (res.status === 204 || res.status === 205 || res.headers.get("content-length") === "0")
    return null;
  if (responseType === "binary") {
    const bytes = new Uint8Array(await res.arrayBuffer());
    return bytes.byteLength === 0
      ? null
      : put(bytes, res.headers.get("content-type") ?? "application/octet-stream");
  }
  const text = await res.text();
  if (text === "") return null;
  if (responseType === "text") return text;
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return text;
  }
}

export const httpNode = defineNode({
  id: "flowaid.tools.http",
  version: "1.0.0",
  metadata: {
    name: "HTTP request",
    description:
      "Calls an HTTP endpoint through the safe fetch (private-network, redirect and size limits) and returns status, headers and the parsed body.",
    category: "tool",
    icon: "globe",
    tags: ["http", "tool", "network"],
    summary: "{{ config.method }} {{ config.url }}",
  },
  configSchema: z.strictObject({
    method: z
      .enum(["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"])
      .meta({ default: "GET", "x-ui": { widget: "select" } }),
    url: z
      .string()
      .min(1)
      .meta({
        "x-ui": { widget: "template", placeholder: "https://api.example.com/items/{{ start.id }}" },
      }),
    headers: z
      .record(z.string(), z.string())
      .default({})
      .meta({ "x-ui": { widget: "keyvalue" } }),
    query: z
      .record(z.string(), z.string())
      .default({})
      .meta({ "x-ui": { widget: "keyvalue" } }),
    body: z
      .unknown()
      .optional()
      .meta({
        "x-ui": {
          widget: "json",
          showWhen: { path: "/method", oneOf: ["POST", "PUT", "PATCH"] },
          bindable: true,
        },
      }),
    responseType: z.enum(["json", "text", "binary"]).default("json"),
    timeoutMs: z.int().min(1).max(120000).default(30000),
  }),
  inputSchema: z.object({}),
  outputSchema: z.object({
    status: z.int().min(100).max(599),
    headers: z.record(z.string(), z.string()),
    body: z
      .unknown()
      .optional()
      .meta({
        "x-port": {
          description:
            'Parsed JSON or text; { "$artifact": id } for binary responses; null for empty bodies.',
        },
      }),
  }),
  credentials: [
    {
      name: "auth",
      types: ["http.bearer", "http.basic", "http.header", "http.api_key"],
      required: false,
      description: "Applied as Authorization or a custom header.",
    },
  ],
  capabilities: ["network", "credentials", "artifacts"],
  idempotency: {
    byConfig: "/method",
    cases: {
      GET: "safe",
      HEAD: "safe",
      OPTIONS: "safe",
      PUT: "keyed",
      DELETE: "keyed",
      POST: "none",
      PATCH: "none",
    },
    default: "none",
  },
  defaultPolicy: { timeoutMs: 30000 },
  execute: async (ctx) => {
    const { method, responseType, timeoutMs } = ctx.config;
    let url: URL;
    try {
      url = new URL(ctx.config.url);
    } catch {
      throw new BadRequestError(`not an absolute URL: ${ctx.config.url}`);
    }
    if (url.protocol !== "https:" && url.protocol !== "http:")
      throw new BadRequestError(`unsupported scheme ${url.protocol}`);
    for (const [k, v] of Object.entries(ctx.config.query)) url.searchParams.set(k, v);
    const headers = new Headers();
    for (const [k, v] of Object.entries(ctx.config.headers)) {
      if (FORBIDDEN_HEADERS.has(k.toLowerCase()))
        throw new BadRequestError(`the ${k} header is set by the transport`);
      if (/[\r\n]/.test(v)) throw new BadRequestError(`header ${k} contains a line break`);
      headers.set(k, v);
    }
    if (ctx.credentials.has("auth")) applyAuth(await ctx.credentials.get("auth"), headers, url);
    // Keyed requests (PUT/DELETE) carry the node run's idempotency key so the server can dedupe retries.
    if (
      ctx.node.idempotency === "keyed" &&
      ctx.node.idempotencyKey &&
      !headers.has("idempotency-key")
    )
      headers.set("Idempotency-Key", ctx.node.idempotencyKey);
    let body: string | undefined;
    if (ctx.config.body !== undefined && ["POST", "PUT", "PATCH"].includes(method)) {
      if (typeof ctx.config.body === "string") body = ctx.config.body;
      else {
        body = JSON.stringify(ctx.config.body);
        if (!headers.has("content-type")) headers.set("content-type", "application/json");
      }
    }
    if (!headers.has("accept") && responseType === "json")
      headers.set("accept", "application/json, text/plain;q=0.8, */*;q=0.5");
    const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(timeoutMs)]);
    let res: Response;
    try {
      res = await ctx.http(url.toString(), {
        method,
        headers,
        ...(body !== undefined ? { body } : {}),
        signal,
      });
    } catch (error) {
      if (ctx.signal.aborted) throw error;
      throw new NetworkError(
        `${method} ${url.origin}${url.pathname} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const parsed = await parseBody(res, responseType, async (bytes, mime) =>
      ctx.artifacts.put(url.pathname.split("/").pop() || "response", bytes, mime),
    );
    const outHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      outHeaders[k] = v;
    });
    if (res.status >= 400)
      throw new ToolExecutionError(
        `${method} ${url.origin}${url.pathname} returned ${res.status}`,
        RETRYABLE_STATUS.has(res.status),
        "http",
        {
          status: res.status,
          body: typeof parsed === "string" ? parsed.slice(0, 2000) : parsed,
        },
      );
    return ok({ status: res.status, headers: outHeaders, body: parsed });
  },
});
