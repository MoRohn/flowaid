import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { JsonSchema, JsonValue, ToolDefinition } from "@flowaid/workflow-core";
import type { OperationSpec } from "./operations.js";
import { coerceArgs } from "./coerce.js";
import { executeOperation, OPENAPI_RESPONSE_MAX_BYTES, type ExecuteOptions } from "./execute.js";
import { isPrivateAddress } from "./network.js";
import { operationsToTools } from "./operations.js";
import { parseOpenApi } from "./parse.js";

const fixture = (name: string) =>
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../fixtures", name), "utf8");
const TOOLSET = "00000000-0000-4000-8000-000000000042";

/** The operation and tool named `name` (throws when missing). */
function pick(
  r: { tools: ToolDefinition[]; operations: Record<string, OperationSpec> },
  name: string,
): [OperationSpec, ToolDefinition] {
  const op = r.operations[name];
  const tool = r.tools.find((t) => t.name === name);
  if (!op || !tool) throw new Error(`no operation ${name}`);
  return [op, tool];
}

async function petstore() {
  const parsed = await parseOpenApi({ text: fixture("petstore-3.0.yaml") });
  return {
    parsed,
    ...operationsToTools(parsed.document, { toolsetId: TOOLSET, toolsetName: "petstore" }),
  };
}
async function billing() {
  const parsed = await parseOpenApi({ text: fixture("billing-3.1.json") });
  return {
    parsed,
    ...operationsToTools(parsed.document, { toolsetId: TOOLSET, toolsetName: "billing" }),
  };
}

function recorder(
  respond: (url: string, init: RequestInit) => Response = () => Response.json({ ok: true }),
) {
  const calls: { url: string; method: string; headers: Headers; body: unknown }[] = [];
  const fetch: ExecuteOptions["fetch"] = (url, init = {}) => {
    calls.push({
      url,
      method: String(init.method),
      headers: new Headers(init.headers),
      body: init.body,
    });
    return Promise.resolve(respond(url, init));
  };
  return { fetch, calls };
}

describe("parseOpenApi", () => {
  it("parses Petstore 3.0 YAML, resolves server variables, dereferences and normalises nullable", async () => {
    const { parsed } = await petstore();
    expect(parsed).toMatchObject({
      version: "3.0",
      title: "Swagger Petstore",
      operationCount: 5,
      servers: ["https://petstore.example.com/v1"],
    });
    const tag = (
      parsed.document.components as never as {
        schemas: { NewPet: { properties: { tag: unknown } } };
      }
    ).schemas.NewPet.properties.tag;
    expect(tag).toEqual({ type: ["string", "null"] });
  });

  it("parses 3.1 JSON", async () => {
    expect((await billing()).parsed.version).toBe("3.1");
  });

  it("rejects Swagger 2, invalid documents and oversized text", async () => {
    await expect(
      parseOpenApi({ text: '{"swagger":"2.0","info":{"title":"x","version":"1"},"paths":{}}' }),
    ).rejects.toMatchObject({ diagnostic: "E_OPENAPI_UNSUPPORTED" });
    await expect(parseOpenApi({ text: '{"openapi":"3.0.0","paths":{}}' })).rejects.toMatchObject({
      diagnostic: "E_OPENAPI_INVALID",
    });
    await expect(
      parseOpenApi({ text: `{"openapi":"3.0.0","x":"${"a".repeat(2 * 1024 * 1024)}"}` }),
    ).rejects.toMatchObject({ diagnostic: "E_OPENAPI_TOO_LARGE" });
  });

  it("refuses YAML custom tags", async () => {
    await expect(
      parseOpenApi({ text: "openapi: 3.0.0\ninfo: !!js/function 'x'\npaths: {}" }),
    ).rejects.toThrow(/cannot parse the document: .*tag/i);
  });

  it("rejects a private servers[] entry and a private document URL", async () => {
    const doc = {
      openapi: "3.0.3",
      info: { title: "x", version: "1" },
      servers: [{ url: "http://10.0.0.5/api" }],
      paths: {},
    };
    await expect(parseOpenApi({ text: JSON.stringify(doc) })).rejects.toMatchObject({
      diagnostic: "E_TOOL_SERVER_PRIVATE",
    });
    const nested = {
      ...doc,
      servers: [{ url: "https://ok.example.com" }],
      paths: {
        "/a": {
          servers: [{ url: "http://169.254.169.254" }],
          get: { responses: { "200": { description: "ok" } } },
        },
      },
    };
    await expect(parseOpenApi({ text: JSON.stringify(nested) })).rejects.toMatchObject({
      diagnostic: "E_TOOL_SERVER_PRIVATE",
    });
    await expect(
      parseOpenApi(
        { url: "http://localhost:8080/openapi.json" },
        { fetch: () => Promise.reject(new Error("must not fetch")) },
      ),
    ).rejects.toMatchObject({
      diagnostic: "E_TOOL_SERVER_PRIVATE",
    });
  });

  it("rejects an external $ref to the metadata address without fetching it", async () => {
    let fetched = false;
    const doc = {
      openapi: "3.0.3",
      info: { title: "x", version: "1" },
      paths: {
        "/a": {
          get: {
            responses: {
              "200": {
                description: "ok",
                content: {
                  "application/json": {
                    schema: { $ref: "http://169.254.169.254/latest/meta-data#/x" },
                  },
                },
              },
            },
          },
        },
      },
    };
    await expect(
      parseOpenApi(
        { text: JSON.stringify(doc) },
        { fetch: () => ((fetched = true), Promise.resolve(Response.json({}))) },
      ),
    ).rejects.toMatchObject({
      diagnostic: "E_OPENAPI_EXTERNAL_REF",
    });
    expect(fetched).toBe(false);
  });

  it("inlines public external refs, relative to their document, within the limits", async () => {
    const docs: Record<string, unknown> = {
      "https://schemas.example.com/v1/common.json": {
        Money: { type: "object", properties: { cur: { $ref: "./currency.json#/Currency" } } },
      },
      "https://schemas.example.com/v1/currency.json": {
        Currency: { type: "string", enum: ["USD", "EUR"] },
      },
    };
    const fetched: string[] = [];
    const fetch = (url: string) => (
      fetched.push(url),
      Promise.resolve(docs[url] ? Response.json(docs[url]) : new Response("", { status: 404 }))
    );
    const doc = {
      openapi: "3.1.0",
      info: { title: "x", version: "1" },
      servers: [{ url: "https://api.example.com" }],
      paths: {
        "/a": {
          get: {
            operationId: "a",
            responses: {
              "200": {
                description: "ok",
                content: {
                  "application/json": {
                    schema: { $ref: "https://schemas.example.com/v1/common.json#/Money" },
                  },
                },
              },
            },
          },
        },
      },
    };
    const parsed = await parseOpenApi({ text: JSON.stringify(doc) }, { fetch });
    const { tools } = operationsToTools(parsed.document, { toolsetId: TOOLSET });
    expect(tools[0]?.outputSchema?.properties).toMatchObject({
      body: { type: "object", properties: { cur: { type: "string", enum: ["USD", "EUR"] } } },
    });
    expect(fetched.sort()).toEqual(Object.keys(docs).sort());
  });

  it("stops external ref chains deeper than three hops", async () => {
    const fetch = (url: string) => {
      const n = Number(/d(\d+)/.exec(url)?.[1] ?? 0);
      return Promise.resolve(
        Response.json({ S: { $ref: `https://x.example.com/d${n + 1}.json#/S` } }),
      );
    };
    const doc = {
      openapi: "3.1.0",
      info: { title: "x", version: "1" },
      paths: {},
      components: { schemas: { A: { $ref: "https://x.example.com/d1.json#/S" } } },
    };
    await expect(parseOpenApi({ text: JSON.stringify(doc) }, { fetch })).rejects.toMatchObject({
      diagnostic: "E_OPENAPI_EXTERNAL_REF",
    });
  });
});

describe("operationsToTools", () => {
  it("makes one tool per operation with grouped inputs, outputs, idempotency and capability", async () => {
    const { tools, operations } = await petstore();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(Object.keys(byName).sort()).toEqual([
      "createPet",
      "deletePet",
      "listPets",
      "patch_pets_by_petId",
      "showPetById",
    ]);
    expect(byName.listPets).toMatchObject({
      idempotency: "safe",
      capability: "petstore.read",
      source: { kind: "openapi", toolsetId: TOOLSET, operationId: "listPets" },
    });
    expect(byName.listPets?.inputSchema).toMatchObject({
      properties: { query: { properties: { limit: { type: "integer" } } } },
    });
    expect(byName.createPet).toMatchObject({
      idempotency: "none",
      capability: "petstore.write",
      inputSchema: { required: ["body"] },
    });
    expect(byName.deletePet?.idempotency).toBe("keyed");
    expect(byName.patch_pets_by_petId?.idempotency).toBe("keyed");
    expect(byName.showPetById?.inputSchema).toMatchObject({
      required: ["path"],
      properties: { path: { required: ["petId"] } },
    });
    // The recursive `parent` stays unconstrained instead of looping.
    expect(JSON.stringify(byName.showPetById?.outputSchema)).toContain("recursive");
    expect(operations.patch_pets_by_petId?.requestBody?.contentType).toBe(
      "application/x-www-form-urlencoded",
    );
  });

  it("reads security schemes and flowaid extensions", async () => {
    const { tools, operations } = await billing();
    const refund = tools.find((t) => t.name === "refundInvoice");
    expect(refund).toMatchObject({
      capability: "billing.refund",
      approvalRequired: true,
      idempotency: "none",
    });
    expect(operations.refundInvoice?.security).toEqual([{ type: "http", scheme: "bearer" }]);
    expect(operations.listInvoices?.security).toEqual([
      { type: "apiKey", in: "query", name: "api_key" },
    ]);
    expect(operations.putReport?.security).toEqual([
      { type: "oauth2", tokenUrl: "https://auth.example.com/token", scopes: ["reports:write"] },
    ]);
  });

  it("filters with include", async () => {
    const parsed = await parseOpenApi({ text: fixture("petstore-3.0.yaml") });
    expect(
      operationsToTools(parsed.document, { toolsetId: TOOLSET, include: ["listPets"] }).tools.map(
        (t) => t.name,
      ),
    ).toEqual(["listPets"]);
  });
});

describe("coerceArgs", () => {
  const schema: JsonSchema = {
    type: "object",
    properties: {
      n: { type: "integer" },
      f: { type: "number" },
      b: { type: "boolean" },
      s: { type: "string" },
      list: { type: "array", items: { type: "integer" } },
      obj: { type: "object", properties: { x: { type: "integer" } } },
      maybe: { type: ["string", "null"] },
    },
  };
  it.each([
    [{ n: "42" }, { n: 42 }, [{ path: "/n", from: "string", to: "number" }]],
    [{ f: "2.5" }, { f: 2.5 }, [{ path: "/f", from: "string", to: "number" }]],
    [{ b: "TRUE" }, { b: true }, [{ path: "/b", from: "string", to: "boolean" }]],
    [{ s: 7 }, { s: "7" }, [{ path: "/s", from: "number", to: "string" }]],
    [
      { list: "3" },
      { list: [3] },
      expect.arrayContaining([{ path: "/list", from: "string", to: "array" }]),
    ],
    [{ list: ["1", 2] }, { list: [1, 2] }, [{ path: "/list/0", from: "string", to: "number" }]],
    [
      { obj: '{"x":"1"}' },
      { obj: { x: 1 } },
      expect.arrayContaining([{ path: "/obj", from: "string", to: "object" }]),
    ],
    [{ n: "abc" }, { n: "abc" }, []],
    [{ maybe: null }, { maybe: null }, []],
  ] as const)("%j → %j", (input, expected, log) => {
    const r = coerceArgs(schema, input as JsonValue);
    expect(r.value).toEqual(expected);
    expect(r.coerced).toEqual(log);
  });
});

describe("executeOperation", () => {
  it("builds path, query and JSON body, applies bearer auth and reports coercions", async () => {
    const set = await petstore();
    const { fetch, calls } = recorder();
    const r = await executeOperation(
      ...pick(set, "listPets"),
      { query: { limit: "5", tags: ["a b", "c"] } },
      { fetch, credential: { type: "http.bearer", fields: { token: "T" } } },
    );
    expect(calls[0]?.url).toBe("https://petstore.example.com/v1/pets?limit=5&tags=a+b&tags=c");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer T");
    expect(r).toMatchObject({
      ok: true,
      structured: { status: 200, body: { ok: true } },
      coerced: [{ path: "/query/limit" }],
    });

    await executeOperation(...pick(set, "showPetById"), { path: { petId: "a/b c" } }, { fetch });
    expect(calls[1]?.url).toBe("https://petstore.example.com/v1/pets/a%2Fb%20c");

    await executeOperation(...pick(set, "createPet"), { body: { name: "Rex" } }, { fetch });
    expect(calls[2]).toMatchObject({ method: "POST", body: '{"name":"Rex"}' });
    expect(calls[2]?.headers.get("content-type")).toBe("application/json");
  });

  it("stops reading a response body at the cap and marks the result truncated", async () => {
    const set = await petstore();
    let pulled = 0;
    const chunk = new TextEncoder().encode("x".repeat(65_536));
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(chunk);
      },
    });
    const { fetch } = recorder(
      () => new Response(endless, { headers: { "content-type": "application/json" } }),
    );
    const r = await executeOperation(...pick(set, "listPets"), {}, { fetch });
    expect(r.ok).toBe(true);
    expect(pulled * chunk.length).toBeLessThanOrEqual(
      OPENAPI_RESPONSE_MAX_BYTES + 2 * chunk.length,
    );
    expect(new TextEncoder().encode(r.content).length).toBeLessThanOrEqual(
      OPENAPI_RESPONSE_MAX_BYTES + 100,
    );
    expect(r.content).toMatch(/\[truncated: the response exceeded \d+ bytes\]$/);
    expect(r.structured).toMatchObject({ status: 200, truncated: true });
  });

  it("forwards Idempotency-Key only for keyed operations and encodes forms", async () => {
    const set = await petstore();
    const { fetch, calls } = recorder(() => new Response(null, { status: 204 }));
    const r = await executeOperation(
      ...pick(set, "deletePet"),
      { path: { petId: "1" } },
      { fetch, idempotencyKey: "k-1" },
    );
    expect(calls[0]?.headers.get("idempotency-key")).toBe("k-1");
    expect(r.structured).toEqual({ status: 204, body: null });
    await executeOperation(
      ...pick(set, "createPet"),
      { body: { name: "x" } },
      { fetch, idempotencyKey: "k-2" },
    );
    expect(calls[1]?.headers.has("idempotency-key")).toBe(false);
    await executeOperation(
      ...pick(set, "patch_pets_by_petId"),
      { path: { petId: "1" }, body: { name: "New" } },
      { fetch },
    );
    expect(calls[2]?.body).toBe("name=New");
  });

  it("applies apiKey placement from the scheme, client credentials with a token cache, and multipart", async () => {
    const set = await billing();
    const { fetch, calls } = recorder((url) =>
      url.endsWith("/token")
        ? Response.json({ access_token: "AT", expires_in: 3600 })
        : Response.json([]),
    );
    await executeOperation(
      ...pick(set, "listInvoices"),
      { query: { filter: { status: "open" } } },
      {
        fetch,
        credential: { type: "http.api_key", fields: { key: "K", in: "header", name: "X" } },
      },
    );
    expect(calls[0]?.url).toBe(
      "https://billing.example.com/api/invoices?filter%5Bstatus%5D=open&api_key=K",
    );
    const tokenCache = new Map();
    const cred = {
      type: "oauth2.client_credentials",
      fields: { tokenUrl: "https://auth.example.com/token", clientId: "id", clientSecret: "s" },
    };
    await executeOperation(
      ...pick(set, "putReport"),
      { body: { file: "csv" } },
      { fetch, credential: cred, tokenCache },
    );
    await executeOperation(
      ...pick(set, "putReport"),
      { body: { file: "csv" } },
      { fetch, credential: cred, tokenCache },
    );
    expect(calls.filter((c) => c.url.endsWith("/token"))).toHaveLength(1);
    expect(calls.at(-1)?.headers.get("authorization")).toBe("Bearer AT");
    expect(calls.at(-1)?.body).toBeInstanceOf(FormData);
  });

  it("refuses Host, Content-Length, undeclared Authorization and CR/LF headers", async () => {
    const [op, refund] = pick(await billing(), "refundInvoice");
    const { fetch } = recorder();
    const base = { path: { id: "1" }, body: { amount: 5 } };
    // additionalProperties: false on the header group already stops undeclared names at validation.
    for (const headers of <JsonValue[]>[
      { Host: "evil" },
      { "Content-Length": "1" },
      { Authorization: "Bearer x" },
    ])
      await expect(executeOperation(op, refund, { ...base, headers }, { fetch })).rejects.toThrow();
    await expect(
      executeOperation(
        op,
        refund,
        { ...base, headers: { "X-Reason": "a\r\nX-Evil: 1" } },
        { fetch },
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const ok = await executeOperation(
      op,
      refund,
      { ...base, headers: { "X-Reason": "dup" } },
      { fetch },
    );
    expect(ok.ok).toBe(true);
  });

  it("maps errors: schema, ≥ 400 with retryability, private servers", async () => {
    const [op, refund] = pick(await billing(), "refundInvoice");
    await expect(
      executeOperation(op, refund, { path: { id: "1" }, body: {} }, { fetch: recorder().fetch }),
    ).rejects.toMatchObject({ code: "SCHEMA_VALIDATION_ERROR" });
    await expect(
      executeOperation(
        op,
        refund,
        { path: { id: "1" }, body: { amount: 1 } },
        { fetch: recorder(() => new Response("busy", { status: 503 })).fetch },
      ),
    ).rejects.toMatchObject({
      code: "TOOL_EXECUTION_ERROR",
      retryable: true,
    });
    await expect(
      executeOperation(
        op,
        refund,
        { path: { id: "1" }, body: { amount: 1 } },
        { fetch: recorder(() => Response.json({ e: 1 }, { status: 422 })).fetch },
      ),
    ).rejects.toMatchObject({
      retryable: false,
    });
    await expect(
      executeOperation(
        { ...op, serverUrl: "http://192.168.1.2" },
        refund,
        { path: { id: "1" }, body: { amount: 1 } },
        { fetch: recorder().fetch },
      ),
    ).rejects.toMatchObject({
      diagnostic: "E_TOOL_SERVER_PRIVATE",
    });
  });
});

describe("isPrivateAddress", () => {
  it.each([
    ["127.0.0.1", true],
    ["169.254.169.254", true],
    ["10.1.2.3", true],
    ["172.20.0.1", true],
    ["100.64.0.1", true],
    ["::1", true],
    ["[fd00::1]", true],
    ["::ffff:10.0.0.1", true],
    ["localhost", true],
    ["db.internal", true],
    ["metadata", true],
    ["api.example.com", false],
    ["8.8.8.8", false],
    ["2606:4700::1111", false],
  ])("%s → %s", (host, expected) => expect(isPrivateAddress(host)).toBe(expected));
});
