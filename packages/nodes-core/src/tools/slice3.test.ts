import { describe, expect, inject, it, onTestFinished } from "vitest";
import { runNode } from "@flowaid/node-sdk/testing";
import type { JsonValue } from "@flowaid/workflow-core";
import { graphqlNode, operationKind } from "./graphql.js";
import {
  assertSingleStatement,
  connectPostgres,
  dbQueryConnector,
  dbQueryNode,
  toJsonValue,
  type DbQueryClient,
} from "./db_query.js";

/** Set by vitest.config.ts from FLOWAID_TEST_DATABASE_URL (empty when unset). */
declare module "vitest" {
  export interface ProvidedContext {
    testDatabaseUrl: string;
  }
}

function recordingFetch(respond: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit; headers: Headers }[] = [];
  const http = (url: string, init: RequestInit = {}) => {
    calls.push({ url, init, headers: new Headers(init.headers) });
    return Promise.resolve(respond(url, init));
  };
  return { http, calls };
}

describe("flowaid.tools.graphql", () => {
  it("detects the operation, ignoring comments, strings and leading fragments", () => {
    expect(operationKind("{ viewer { login } }")).toBe("query");
    expect(operationKind("# mutation\nquery Q { a }")).toBe("query");
    expect(operationKind('query { a(b: "mutation") }')).toBe("query");
    expect(operationKind("fragment F on User { id }\nmutation M { b }")).toBe("mutation");
    expect(operationKind("subscription S { c }")).toBe("subscription");
  });

  it("POSTs the document with variables and returns data and errors", async () => {
    const { http, calls } = recordingFetch(() =>
      Response.json({ data: { issue: { id: 7 } }, errors: [{ message: "partial" }] }),
    );
    const r = await runNode(graphqlNode, {
      config: {
        url: "https://api.example.com/graphql",
        document: "query Issue($n: Int!) { issue(number: $n) { id } }",
      },
      input: { variables: { n: 7 } },
      credentials: { auth: { token: "t0k" } },
      http,
    });
    expect(r.result).toMatchObject({
      kind: "ok",
      output: { data: { issue: { id: 7 } }, errors: [{ message: "partial" }] },
    });
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
      query: "query Issue($n: Int!) { issue(number: $n) { id } }",
      variables: { n: 7 },
    });
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer t0k");
  });

  it("refuses a mutation document on a query node (the retry policy depends on it)", async () => {
    const r = await runNode(graphqlNode, {
      config: { url: "https://x.test/graphql", document: "mutation { close(id: 1) }" },
      http: recordingFetch(() => Response.json({})).http,
    });
    expect(r.result).toMatchObject({ kind: "error", error: { code: "BAD_REQUEST" } });
  });

  it("fails on errors without data, and on HTTP errors", async () => {
    const onlyErrors = await runNode(graphqlNode, {
      config: { url: "https://x.test/graphql", document: "{ a }" },
      http: recordingFetch(() => Response.json({ errors: [{ message: "nope" }] })).http,
    });
    expect(onlyErrors.result).toMatchObject({
      kind: "error",
      error: { code: "TOOL_EXECUTION_ERROR" },
    });
    const down = await runNode(graphqlNode, {
      config: { url: "https://x.test/graphql", document: "{ a }" },
      http: recordingFetch(() => new Response("bad gateway", { status: 502 })).http,
    });
    expect(down.result).toMatchObject({ kind: "error", error: { retryable: true } });
  });
});

describe("flowaid.tools.db_query", () => {
  it("allows one statement only", () => {
    expect(() => assertSingleStatement("select 1;")).not.toThrow();
    expect(() => assertSingleStatement("select ';' as x -- ; comment")).not.toThrow();
    expect(() => assertSingleStatement("select 1; drop table users")).toThrow(/one statement/);
    expect(() => assertSingleStatement("  -- nothing")).toThrow(/empty/);
  });

  it("converts rows to JSON", () => {
    expect(
      toJsonValue({
        id: 1n,
        at: new Date("2026-01-01T00:00:00Z"),
        b: new Uint8Array([1, 2]),
        n: null,
      }),
    ).toEqual({ id: "1", at: "2026-01-01T00:00:00.000Z", b: "AQI=", n: null });
  });

  it("runs the statement with its parameters in a read-only, time-limited transaction", async () => {
    const seen: { sql: string; params: JsonValue[]; maxRows: number; opts: object }[] = [];
    let closed = false;
    const client: DbQueryClient = {
      transaction: (opts, fn) =>
        fn((sql, params, maxRows) => {
          seen.push({ sql, params, maxRows, opts });
          return Promise.resolve({ rows: [{ id: 1, email: "a@b.c" }], truncated: false });
        }),
      close: () => ((closed = true), Promise.resolve()),
    };
    const original = dbQueryConnector.connect;
    dbQueryConnector.connect = () => Promise.resolve(client);
    try {
      const r = await runNode(dbQueryNode, {
        config: { sql: "select id, email from users where id = $1" },
        input: { params: [1] },
        credentials: { database: { dsn: "postgres://u:p@db/app" } },
      });
      expect(r.result).toMatchObject({
        kind: "ok",
        output: { rows: [{ id: 1, email: "a@b.c" }], row_count: 1, truncated: false },
      });
      expect(seen[0]).toMatchObject({
        params: [1],
        maxRows: 1000,
        opts: { readOnly: true, timeoutMs: 10000 },
      });
      expect(closed).toBe(true);
    } finally {
      dbQueryConnector.connect = original;
    }
  });

  it("reports SQL errors with their SQLSTATE, retryable only for transient ones", async () => {
    const original = dbQueryConnector.connect;
    dbQueryConnector.connect = () =>
      Promise.resolve({
        transaction: () =>
          Promise.reject(Object.assign(new Error("deadlock detected"), { code: "40P01" })),
        close: () => Promise.resolve(),
      });
    try {
      const r = await runNode(dbQueryNode, {
        config: { sql: "update t set a = 1", readOnly: false },
        credentials: { database: { dsn: "postgres://x" } },
      });
      expect(r.result).toMatchObject({
        kind: "error",
        error: { code: "TOOL_EXECUTION_ERROR", retryable: true },
      });
    } finally {
      dbQueryConnector.connect = original;
    }
  });

  it("refuses database hosts at loopback, private or metadata addresses before connecting", async () => {
    const signal = new AbortController().signal;
    for (const dsn of [
      "postgres://u:p@127.0.0.1:5432/app",
      "postgres://u:p@localhost/app",
      "postgres://u:p@169.254.169.254/app",
      // every host of a multi-host DSN is checked
      "postgres://u:p@8.8.8.8,10.0.0.1/app",
    ])
      await expect(connectPostgres(dsn, signal)).rejects.toMatchObject({ code: "FORBIDDEN" });
    // a public name that resolves to a private address
    await expect(
      connectPostgres("postgres://u:p@db.example.com/app", signal, {
        lookup: (_h, _o, cb) => cb(null, [{ address: "10.0.0.5", family: 4 }]),
      }),
    ).rejects.toThrow(/private or reserved/);
    const r = await runNode(dbQueryNode, {
      config: { sql: "select 1" },
      credentials: { database: { dsn: "postgres://u:p@127.0.0.1/app" } },
    });
    expect(r.result).toMatchObject({ kind: "error", error: { code: "FORBIDDEN" } });
  });

  it("connects to loopback hosts when the private network is allowed (FLOWAID_ALLOW_PRIVATE_NETWORK)", async () => {
    // nothing listens on port 1: past the address policy, the driver fails to connect instead
    dbQueryConnector.network = { allowPrivate: true };
    onTestFinished(() => {
      dbQueryConnector.network = {};
    });
    const r = await runNode(dbQueryNode, {
      config: { sql: "select 1" },
      credentials: { database: { dsn: "postgres://u:p@127.0.0.1:1/app" } },
    });
    expect(r.result).toMatchObject({ kind: "error" });
    expect(r.result).not.toMatchObject({ error: { code: "FORBIDDEN" } });
  });

  it("re-checks the address at connect time (DNS rebinding)", async () => {
    let calls = 0;
    const client = await connectPostgres(
      "postgres://u:p@rebind.example.com/app",
      new AbortController().signal,
      {
        lookup: (_h, _o, cb) =>
          cb(null, [{ address: calls++ === 0 ? "93.184.216.34" : "127.0.0.1", family: 4 }]),
      },
    );
    try {
      await expect(
        client.transaction({ readOnly: true, timeoutMs: 1000 }, (q) => q("select 1", [], 1)),
      ).rejects.toThrow(/private or reserved/);
    } finally {
      await client.close();
    }
  });

  const pg = inject("testDatabaseUrl");
  it.skipIf(!pg)("against PostgreSQL: caps rows, and read-only refuses writes", async () => {
    // the test database is on this computer: a development-only allowance
    dbQueryConnector.network = { allowPrivate: true };
    onTestFinished(() => {
      dbQueryConnector.network = {};
    });
    const run = (sql: string, params: JsonValue[] = [], extra: object = {}) =>
      runNode(dbQueryNode, {
        config: { sql, maxRows: 3, ...extra },
        input: { params },
        credentials: { database: { dsn: pg } },
      });
    const rows = await run("select g as n from generate_series(1, $1::int) g", [10]);
    expect(rows.result).toMatchObject({
      kind: "ok",
      output: { row_count: 3, truncated: true, rows: [{ n: 1 }, { n: 2 }, { n: 3 }] },
    });
    const write = await run("create temp table t (a int)");
    expect(write.result).toMatchObject({
      kind: "error",
      error: { details: { sqlState: "25006" } },
    });
    const slow = await run("select pg_sleep(1)", [], { timeoutMs: 100 });
    expect(slow.result).toMatchObject({ kind: "error", error: { details: { sqlState: "57014" } } });
  });
});
