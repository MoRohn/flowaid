import { z } from "zod";
import { defineNode, ok } from "@flowaid/node-sdk";
import {
  BadRequestError,
  NetworkError,
  ToolExecutionError,
  type JsonValue,
} from "@flowaid/workflow-core";
import { applyAuth } from "./http.js";

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/** The operation keyword of a GraphQL document (`query` for the shorthand `{ … }`). */
export function operationKind(document: string): "query" | "mutation" | "subscription" | null {
  // Strip comments and strings so a keyword inside either does not count.
  const clean = document
    .replace(/#[^\n]*/g, "")
    .replace(/"""[\s\S]*?"""/g, '""')
    .replace(/"(?:\\.|[^"\\])*"/g, '""');
  // An operation starts a document or follows the closing brace of a previous definition.
  const m = /(?:^|\})\s*(query|mutation|subscription)\b/.exec(clean);
  if (m?.[1]) return m[1] as "query" | "mutation" | "subscription";
  return /^\s*\{/.test(clean) ? "query" : null;
}

export const graphqlNode = defineNode({
  id: "flowaid.tools.graphql",
  version: "1.0.0",
  metadata: {
    name: "GraphQL",
    description:
      "Sends one GraphQL query or mutation to an endpoint with variables from the flow; returns `data` and any `errors`. Queries are safe to retry, mutations are not.",
    category: "tool",
    icon: "waypoints",
    tags: ["graphql", "api", "tool"],
    summary: "{{ config.operation }} {{ config.url }}",
  },
  configSchema: z.strictObject({
    url: z
      .string()
      .min(1)
      .max(2048)
      .meta({ "x-ui": { widget: "template", placeholder: "https://api.example.com/graphql" } }),
    operation: z
      .enum(["query", "mutation"])
      .default("query")
      .meta({ "x-ui": { widget: "select", help: "Must match the document's operation." } }),
    document: z
      .string()
      .min(1)
      .max(100_000)
      .meta({ "x-ui": { widget: "code", language: "graphql" } }),
    operationName: z.string().max(200).optional(),
    headers: z
      .record(z.string(), z.string().max(4096))
      .default({})
      .meta({ "x-ui": { widget: "keyvalue" } }),
    failOnErrors: z
      .boolean()
      .default(true)
      .meta({
        "x-ui": {
          widget: "switch",
          help: "Fail the node when the response has errors and no data.",
        },
      }),
    timeoutMs: z.int().min(100).max(300_000).default(30_000),
  }),
  inputSchema: z.object({ variables: z.record(z.string(), z.unknown()).optional() }),
  outputSchema: z.object({
    data: z.unknown(),
    errors: z.array(z.unknown()),
  }),
  credentials: [
    {
      name: "auth",
      types: ["http.bearer", "http.basic", "http.header", "http.api_key"],
      required: false,
      description: "Applied as Authorization or a custom header.",
    },
  ],
  capabilities: ["network", "credentials"],
  // an omitted operation is the default `query`
  idempotency: {
    byConfig: "/operation",
    cases: { query: "safe", mutation: "none" },
    default: "safe",
  },
  defaultPolicy: { timeoutMs: 30000 },
  execute: async (ctx, input) => {
    const { operation, document, timeoutMs } = ctx.config;
    const kind = operationKind(document);
    if (kind === "subscription")
      throw new BadRequestError("subscriptions are not supported; use a query or mutation");
    if (kind !== null && kind !== operation)
      throw new BadRequestError(
        `the document is a ${kind} but the node is configured as a ${operation}`,
      );
    let url: URL;
    try {
      url = new URL(ctx.config.url);
    } catch {
      throw new BadRequestError(`not an absolute URL: ${ctx.config.url}`);
    }
    if (url.protocol !== "https:" && url.protocol !== "http:")
      throw new BadRequestError(`unsupported scheme ${url.protocol}`);
    const headers = new Headers({
      "content-type": "application/json",
      accept: "application/graphql-response+json, application/json",
    });
    for (const [k, v] of Object.entries(ctx.config.headers)) {
      if (/[\r\n]/.test(v)) throw new BadRequestError(`header ${k} contains a line break`);
      headers.set(k, v);
    }
    if (ctx.credentials.has("auth")) applyAuth(await ctx.credentials.get("auth"), headers, url);
    const body = JSON.stringify({
      query: document,
      variables: input.variables ?? {},
      ...(ctx.config.operationName ? { operationName: ctx.config.operationName } : {}),
    });
    let res: Response;
    try {
      res = await ctx.http(url.toString(), {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(timeoutMs)]),
      });
    } catch (error) {
      if (ctx.signal.aborted) throw error;
      throw new NetworkError(
        `GraphQL ${url.origin}${url.pathname} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const text = await res.text();
    let parsed: { data?: unknown; errors?: unknown } | null = null;
    try {
      parsed = JSON.parse(text) as { data?: unknown; errors?: unknown };
    } catch {
      parsed = null;
    }
    if (!parsed || (res.status >= 400 && parsed.data === undefined))
      throw new ToolExecutionError(
        `GraphQL ${url.origin}${url.pathname} returned ${res.status}`,
        RETRYABLE_STATUS.has(res.status),
        "graphql",
        { status: res.status, body: text.slice(0, 2000) },
      );
    const errors = Array.isArray(parsed.errors) ? (parsed.errors as JsonValue[]) : [];
    const data = (parsed.data ?? null) as JsonValue;
    if (ctx.config.failOnErrors && errors.length > 0 && data === null)
      throw new ToolExecutionError(
        `GraphQL returned ${errors.length} error${errors.length > 1 ? "s" : ""} and no data`,
        false,
        "graphql",
        { errors },
      );
    return ok({ data, errors });
  },
});
