import { z } from "zod";
import { defineNode, ok } from "@flowaid/node-sdk";
import {
  BadRequestError,
  ToolExecutionError,
  type JsonObject,
  type JsonValue,
} from "@flowaid/workflow-core";

/** The most rows one query returns; the rest are dropped and `truncated` is set. */
export const DB_QUERY_MAX_ROWS = 10_000;

/** A row value as JSON: dates as ISO strings, bigints and numerics as strings, bytes as base64. */
export function toJsonValue(value: unknown): JsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString("base64");
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (typeof value === "object") {
    const out: JsonObject = {};
    for (const [k, v] of Object.entries(value)) out[k] = toJsonValue(v);
    return out;
  }
  return null;
}

/** What the node needs from a PostgreSQL client (the `postgres` driver, or a test double). */
export interface DbQueryClient {
  /** Runs `fn` in one transaction with `statement_timeout` and, when set, READ ONLY. */
  transaction<T>(
    opts: { readOnly: boolean; timeoutMs: number },
    fn: (
      query: (
        sql: string,
        params: JsonValue[],
        maxRows: number,
      ) => Promise<{ rows: Record<string, unknown>[]; truncated: boolean }>,
    ) => Promise<T>,
  ): Promise<T>;
  close(): Promise<void>;
}

/** The default client over the `postgres` driver: one connection per execution, no prepared statements. */
export async function connectPostgres(dsn: string, signal: AbortSignal): Promise<DbQueryClient> {
  const { default: postgres } = await import("postgres");
  const sql = postgres(dsn, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 5,
    onnotice: () => undefined,
  });
  const close = () => sql.end({ timeout: 2 });
  signal.addEventListener("abort", () => void close(), { once: true });
  return {
    transaction: (opts, fn) =>
      sql.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL statement_timeout = ${Math.max(1, Math.floor(opts.timeoutMs))}`);
        if (opts.readOnly) await tx.unsafe("SET TRANSACTION READ ONLY");
        return fn(async (text, params, maxRows) => {
          const rows: Record<string, unknown>[] = [];
          let truncated = false;
          const query = tx.unsafe(text, params as never[]);
          // A cursor stops reading at the cap instead of buffering an unbounded result.
          for await (const batch of query.cursor(Math.min(500, maxRows + 1))) {
            for (const row of batch as Record<string, unknown>[]) {
              if (rows.length >= maxRows) {
                truncated = true;
                break;
              }
              rows.push(row);
            }
            if (truncated) break;
          }
          return { rows, truncated };
        });
      }) as never,
    close,
  };
}

/** Rejects documents with more than one statement (parameters are the only way values enter). */
export function assertSingleStatement(text: string): void {
  const clean = text
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/'(?:''|[^'])*'/g, "''")
    .replace(/"(?:""|[^"])*"/g, '""')
    .trim()
    .replace(/;\s*$/, "");
  if (clean.length === 0) throw new BadRequestError("the query is empty");
  if (clean.includes(";"))
    throw new BadRequestError("one statement per node: pass values as $1, $2, … parameters");
}

export const dbQueryNode = defineNode({
  id: "flowaid.tools.db_query",
  version: "1.0.0",
  metadata: {
    name: "Database query",
    description:
      "Runs one parameterised SQL statement against PostgreSQL ($1, $2, … from `params`), in a transaction with a statement timeout and, by default, read-only. Returns at most 10,000 rows.",
    category: "tool",
    icon: "database",
    tags: ["sql", "postgres", "database", "tool"],
    summary: "postgres",
  },
  configSchema: z.strictObject({
    sql: z
      .string()
      .min(1)
      .max(100_000)
      .meta({
        "x-ui": {
          widget: "code",
          language: "sql",
          help: "Values come only from params ($1, $2, …); the text is never templated.",
        },
      }),
    readOnly: z
      .boolean()
      .default(true)
      .meta({ "x-ui": { widget: "switch", help: "Runs in a READ ONLY transaction." } }),
    timeoutMs: z.int().min(100).max(300_000).default(10_000),
    maxRows: z.int().min(1).max(DB_QUERY_MAX_ROWS).default(1000),
  }),
  inputSchema: z.object({ params: z.array(z.unknown()).optional() }),
  outputSchema: z.object({
    rows: z.array(z.record(z.string(), z.unknown())),
    row_count: z.int().min(0),
    truncated: z.boolean(),
  }),
  credentials: [
    {
      name: "database",
      types: ["postgres.dsn"],
      required: true,
      description: "The postgres:// connection string the statement runs with.",
    },
  ],
  capabilities: ["network", "credentials"],
  // an omitted readOnly is the default `true`
  idempotency: { byConfig: "/readOnly", cases: { true: "safe", false: "none" }, default: "safe" },
  defaultPolicy: { timeoutMs: 60000 },
  execute: async (ctx, input) => {
    assertSingleStatement(ctx.config.sql);
    const { dsn } = await ctx.credentials.get("database");
    if (!dsn) throw new BadRequestError("the database credential has no dsn");
    const client = await dbQueryConnector.connect(dsn, ctx.signal);
    try {
      const params = (input.params ?? []).map(toJsonValue);
      const { rows, truncated } = await client.transaction(
        { readOnly: ctx.config.readOnly, timeoutMs: ctx.config.timeoutMs },
        (query) => query(ctx.config.sql, params, ctx.config.maxRows),
      );
      const out = rows.map((r) => toJsonValue(r) as JsonObject);
      return ok({ rows: out, row_count: out.length, truncated });
    } catch (error) {
      if (error instanceof BadRequestError || ctx.signal.aborted) throw error;
      const e = error as { code?: unknown; message?: unknown };
      const code = typeof e.code === "string" ? e.code : undefined;
      // 57014 query_canceled (timeout), 40001/40P01 serialization/deadlock, 08* connection
      const retryable = code === "40001" || code === "40P01" || (code?.startsWith("08") ?? false);
      throw new ToolExecutionError(
        `the query failed${code ? ` (${code})` : ""}: ${typeof e.message === "string" ? e.message : String(error)}`,
        retryable,
        "db_query",
        code ? { sqlState: code } : {},
      );
    } finally {
      await client.close();
    }
  },
});

/** Replaceable in tests. */
export const dbQueryConnector: {
  connect: (dsn: string, signal: AbortSignal) => Promise<DbQueryClient>;
} = { connect: connectPostgres };
