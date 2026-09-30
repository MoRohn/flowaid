import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { afterAll, beforeAll, expect, it } from "vitest";
import { z } from "zod";
import { describeDb } from "@flowaid/database/testing";
import { call, createTestApp, login, type Jar, type TestApp } from "./test/app.js";

const PETSTORE = readFileSync(
  fileURLToPath(
    new URL("../../../packages/openapi-tools/fixtures/petstore-3.0.yaml", import.meta.url),
  ),
  "utf8",
);

/** A local HTTP service standing in for both an OpenAPI server and an MCP server. */
async function startUpstream() {
  const seen: { method: string; url: string; auth?: string }[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      seen.push({
        method: req.method ?? "",
        url: req.url ?? "",
        ...(req.headers.authorization ? { auth: req.headers.authorization } : {}),
      });
      if (req.url?.startsWith("/mcp")) {
        const mcp = new McpServer(
          { name: "kb", version: "1.0.0" },
          { capabilities: { tools: {}, resources: {}, prompts: {} } },
        );
        mcp.registerTool(
          "search.docs",
          {
            description: "Search the docs.",
            inputSchema: { q: z.string() },
            annotations: { readOnlyHint: true },
          },
          ({ q }) => ({
            content: [{ type: "text", text: `found ${q}` }],
            structuredContent: { hits: [q] },
          }),
        );
        mcp.registerTool(
          "delete_all",
          { description: "Deletes everything.", inputSchema: {} },
          () => ({ content: [{ type: "text", text: "gone" }] }),
        );
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });
        res.on("close", () => void transport.close());
        void mcp
          .connect(transport)
          .then(() =>
            transport.handleRequest(
              req,
              res,
              JSON.parse(Buffer.concat(chunks).toString("utf8") || "null"),
            ),
          );
        return;
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify([{ id: 1, name: "Rex" }]));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    seen,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

describeDb("credentials, tools and MCP (Postgres)", () => {
  let t: TestApp;
  let jar: Jar;
  let upstream: Awaited<ReturnType<typeof startUpstream>>;
  beforeAll(async () => {
    t = await createTestApp();
    jar = await login(t.app);
    upstream = await startUpstream();
  });
  afterAll(async () => {
    await upstream.close();
    await t.close();
  });

  it("stores credentials encrypted, never returns values, masks hints and merges patches", async () => {
    const types = (await call(t.app, jar, "GET", "/v1/credential-types")).json() as {
      id: string;
      fields: { name: string; secret: boolean }[];
    }[];
    expect(types.find((x) => x.id === "http.bearer")?.fields).toEqual([
      expect.objectContaining({ name: "token", secret: true }),
    ]);
    const created = await call(t.app, jar, "POST", "/v1/credentials", {
      name: "crm",
      type: "http.bearer",
      values: { token: "sk-live-1234567890abcdef" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.body).not.toContain("1234567890");
    expect(created.json()).toMatchObject({ hints: { token: "sk-…cdef" }, storage: "db" });
    const [row] = await t.db
      .admin`select ciphertext, wrapped_data_key, key_version from credentials where id = ${created.json().id as string}`;
    expect(String(row?.ciphertext)).not.toContain("1234567890");
    expect(row?.key_version).toBe(1);
    const id = created.json().id as string;
    expect(
      (
        await call(t.app, jar, "POST", "/v1/credentials", {
          name: "crm",
          type: "http.bearer",
          values: { token: "x" },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await call(t.app, jar, "POST", "/v1/credentials", {
          name: "bad",
          type: "http.bearer",
          values: {},
        })
      ).statusCode,
    ).toBe(422);
    const basic = (
      await call(t.app, jar, "POST", "/v1/credentials", {
        name: "basic",
        type: "http.basic",
        values: { username: "ada", password: "pw-one" },
      })
    ).json();
    expect(basic.publicFields).toEqual({ username: "ada" });
    const patched = await call(t.app, jar, "PATCH", `/v1/credentials/${basic.id as string}`, {
      values: { password: "pw-two-longer" },
    });
    expect(patched.json()).toMatchObject({
      publicFields: { username: "ada" },
      hints: { password: "pw-…nger" },
    });
    expect(await t.ctx.credentials.decrypt(basic.id as string)).toEqual({
      username: "ada",
      password: "pw-two-longer",
    });
    const tested = (await call(t.app, jar, "POST", `/v1/credentials/${id}/test`)).json();
    expect(tested.ok).toBe(true);
    const ext = await call(t.app, jar, "POST", "/v1/credentials", {
      name: "ext",
      type: "http.bearer",
      storage: "external",
      externalRef: "vault:secret/data/crm#token",
    });
    expect(ext.statusCode).toBe(201);
    expect(
      (
        await call(t.app, jar, "POST", "/v1/credentials", {
          name: "ext2",
          type: "http.bearer",
          storage: "external",
          externalRef: "http://evil",
        })
      ).statusCode,
    ).toBe(400);
  });

  it("refuses to delete bound credentials unless forced by an admin", async () => {
    const cred = (
      await call(t.app, jar, "POST", "/v1/credentials", {
        name: "bound",
        type: "http.bearer",
        values: { token: "tok-bound-123" },
      })
    ).json().id as string;
    const w = (await call(t.app, jar, "POST", "/v1/workflows", { name: "Uses secret" })).json();
    const envs = (await call(t.app, jar, "GET", "/v1/environments")).json() as {
      id: string;
      name: string;
    }[];
    const dev = envs.find((e) => e.name === "dev")?.id as string;
    await call(
      t.app,
      jar,
      "PUT",
      `/v1/workflows/${w.id as string}/draft`,
      { definition: { ...w.draft, secrets: [{ name: "CRM", credentialType: "http.bearer" }] } },
      { "if-match": String(w.draftRevision) },
    );
    expect(
      (
        await call(t.app, jar, "PUT", `/v1/workflows/${w.id as string}/secrets/${dev}`, {
          CRM: cred,
        })
      ).statusCode,
    ).toBe(200);
    const blocked = await call(t.app, jar, "DELETE", `/v1/credentials/${cred}`);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.details.bindings).toHaveLength(1);
    expect(
      (await call(t.app, jar, "DELETE", `/v1/credentials/${cred}?force=true`)).statusCode,
    ).toBe(204);
  });

  it("previews and imports OpenAPI toolsets; private server overrides are refused in production", async () => {
    const preview = await call(t.app, jar, "POST", "/v1/tools/openapi/preview", {
      document: PETSTORE,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().operations.map((o: { name: string }) => o.name)).toContain("listPets");
    const cred = (
      await call(t.app, jar, "POST", "/v1/credentials", {
        name: "petstore",
        type: "http.bearer",
        values: { token: "pet-token-123" },
      })
    ).json().id as string;
    const imported = await call(t.app, jar, "POST", "/v1/tools/openapi/import", {
      name: "petstore",
      document: PETSTORE,
      serverUrl: upstream.url,
      credentialId: cred,
    });
    expect(imported.statusCode).toBe(201);
    const tool = imported.json();
    expect(tool.definitions.find((d: { name: string }) => d.name === "listPets")).toMatchObject({
      source: { kind: "openapi", toolsetId: tool.id, operationId: "listPets" },
    });
    const catalog = (await call(t.app, jar, "GET", "/v1/tools/catalog")).json() as {
      name: string;
    }[];
    expect(catalog.map((x) => x.name)).toContain("listPets");
    const invoked = await call(t.app, jar, "POST", `/v1/tools/${tool.id as string}/invoke`, {
      tool: "listPets",
      args: { query: { limit: "2" } },
    });
    expect(invoked.json()).toMatchObject({
      ok: true,
      structured: { status: 200, body: [{ id: 1, name: "Rex" }] },
      coerced: [{ path: "/query/limit" }],
    });
    expect(upstream.seen.at(-1)).toMatchObject({
      method: "GET",
      url: "/pets?limit=2",
      auth: "Bearer pet-token-123",
    });

    const strict = await createTestApp({ allowPrivateNetwork: false });
    try {
      const j = await login(strict.app);
      const refused = await call(strict.app, j, "POST", "/v1/tools/openapi/import", {
        name: "p",
        document: PETSTORE,
        serverUrl: upstream.url,
      });
      expect(refused.statusCode).toBe(400);
      expect(refused.json().error.message).toContain("E_TOOL_SERVER_PRIVATE");
    } finally {
      await strict.close();
    }
  });

  it("registers, tests and discovers an MCP server, applies its policy and test-calls tools", async () => {
    const created = await call(t.app, jar, "POST", "/v1/mcp/servers", {
      name: "kb",
      transport: "streamable_http",
      url: `${upstream.url}/mcp`,
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    expect((await call(t.app, jar, "POST", `/v1/mcp/servers/${id}/test`)).json()).toMatchObject({
      ok: true,
      server: { name: "kb" },
    });
    const discovered = await call(t.app, jar, "POST", `/v1/mcp/servers/${id}/discover`);
    expect(discovered.statusCode).toBe(200);
    expect(
      discovered
        .json()
        .tools.map((x: { name: string }) => x.name)
        .sort(),
    ).toEqual(["delete_all", "search_docs"]);
    expect((await call(t.app, jar, "GET", `/v1/mcp/servers/${id}`)).json()).toMatchObject({
      status: "connected",
      toolCount: 2,
    });
    const call1 = await call(t.app, jar, "POST", `/v1/mcp/servers/${id}/tools/search_docs/call`, {
      args: { q: "retry" },
    });
    expect(call1.json()).toMatchObject({
      ok: true,
      content: "found retry",
      structured: { hits: ["retry"] },
    });
    await call(t.app, jar, "PATCH", `/v1/mcp/servers/${id}/policy`, {
      allow: ["*"],
      deny: ["delete_*"],
      approvalRequired: [],
    });
    expect(
      (await call(t.app, jar, "POST", `/v1/mcp/servers/${id}/tools/delete_all/call`, { args: {} }))
        .statusCode,
    ).toBe(403);
    const catalog = (await call(t.app, jar, "GET", "/v1/tools/catalog")).json() as {
      name: string;
      source: { kind: string };
    }[];
    expect(catalog.filter((x) => x.source.kind === "mcp").map((x) => x.name)).toContain(
      "search_docs",
    );
    // stdio is off by default, so the API refuses to store one at all
    const stdio = await call(t.app, jar, "POST", "/v1/mcp/servers", {
      name: "local",
      transport: "stdio",
      command: "/usr/bin/true",
    });
    expect(stdio.statusCode).toBe(403);
    expect(stdio.body).toContain("MCP_STDIO_ENABLED=false");
    // nor turn an HTTP server into one
    expect(
      (
        await call(t.app, jar, "PATCH", `/v1/mcp/servers/${id}`, {
          transport: "stdio",
          command: "/bin/sh",
        })
      ).statusCode,
    ).toBe(403);
  });

  it("mints MCP tokens (service accounts pinned to workflows) and manages exposures", async () => {
    const w = (await call(t.app, jar, "POST", "/v1/workflows", { name: "Exposed" })).json()
      .id as string;
    const envs = (await call(t.app, jar, "GET", "/v1/environments")).json() as {
      id: string;
      name: string;
    }[];
    const dev = envs.find((e) => e.name === "dev")?.id as string;
    const token = await call(t.app, jar, "POST", "/v1/mcp/tokens", {
      name: "claude",
      workflowIds: [w],
      environmentId: dev,
    });
    expect(token.statusCode).toBe(201);
    const me = (
      await t.app.inject({
        method: "GET",
        url: "/v1/me",
        headers: { authorization: `Bearer ${token.json().key as string}` },
      })
    ).json();
    expect(me.principal).toMatchObject({
      type: "mcp_token",
      scopes: ["mcp:serve"],
      workflowIds: [w],
      environmentId: dev,
    });
    const exposure = await call(t.app, jar, "POST", "/v1/mcp/exposures", {
      workflowId: w,
      environmentId: dev,
      toolName: "exposed_tool",
      description: "Runs Exposed",
    });
    expect(exposure.json()).toMatchObject({ url: "http://localhost:3001/mcp/default" });
    expect(
      (
        await call(t.app, jar, "POST", "/v1/mcp/exposures", {
          workflowId: w,
          environmentId: dev,
          toolName: "exposed_tool",
          description: "x",
        })
      ).statusCode,
    ).toBe(409);
    const exposures = (await call(t.app, jar, "GET", "/v1/mcp/exposures?limit=1")).json();
    expect(exposures).toEqual({
      items: [expect.objectContaining({ toolName: "exposed_tool" })],
      next_cursor: null,
    });
  });

  /** Every page of a list, `limit` at a time, and the first page on its own. */
  const pages = async (path: string, limit: number) => {
    type Page = { items: { id: string; name: string }[]; next_cursor: string | null };
    const first = (await call(t.app, jar, "GET", `${path}?limit=${limit}`)).json() as Page;
    const all = [...first.items];
    for (let cursor = first.next_cursor; cursor;) {
      const next = (
        await call(t.app, jar, "GET", `${path}?limit=${limit}&cursor=${cursor}`)
      ).json() as Page;
      all.push(...next.items);
      cursor = next.next_cursor;
    }
    return { first, all };
  };

  it("pages credentials by name with a cursor", async () => {
    for (const name of ["Pager C", "Pager A", "Pager B"])
      await call(t.app, jar, "POST", "/v1/credentials", {
        name,
        type: "http.bearer",
        values: { token: "sk-live-1234567890abcdef" },
      });
    const { first, all } = await pages("/v1/credentials", 2);
    expect(first.items).toHaveLength(2);
    expect(first.next_cursor).toEqual(expect.any(String));
    const everything = (await call(t.app, jar, "GET", "/v1/credentials?limit=200")).json();
    expect(everything.next_cursor).toBeNull();
    expect(all.map((c) => c.id)).toEqual(everything.items.map((c: { id: string }) => c.id));
    expect(all.map((c) => c.name).filter((n) => n.startsWith("Pager"))).toEqual([
      "Pager A",
      "Pager B",
      "Pager C",
    ]);
    expect((await call(t.app, jar, "GET", "/v1/credentials?limit=500")).statusCode).toBe(400);
  });

  it("pages tools and MCP servers by name with a cursor", async () => {
    for (const name of ["Pager C", "Pager A", "Pager B"])
      await call(t.app, jar, "POST", "/v1/mcp/servers", {
        name,
        transport: "streamable_http",
        url: `${upstream.url}/mcp`,
      });
    const { first, all } = await pages("/v1/mcp/servers", 2);
    expect(first.items).toHaveLength(2);
    expect(first.next_cursor).toEqual(expect.any(String));
    const everything = (await call(t.app, jar, "GET", "/v1/mcp/servers?limit=200")).json();
    expect(all.map((x) => x.id)).toEqual(everything.items.map((x: { id: string }) => x.id));
    expect(all.map((x) => x.name).filter((n) => n.startsWith("Pager"))).toEqual([
      "Pager A",
      "Pager B",
      "Pager C",
    ]);
    for (const name of ["pager-b", "pager-a"])
      expect(
        (
          await call(t.app, jar, "POST", "/v1/tools/openapi/import", {
            name,
            document: PETSTORE,
            serverUrl: upstream.url,
          })
        ).statusCode,
      ).toBe(201);
    const tools = await pages("/v1/tools", 1);
    expect(tools.first.items).toHaveLength(1);
    expect(tools.first.next_cursor).toEqual(expect.any(String));
    const listed = (await call(t.app, jar, "GET", "/v1/tools")).json();
    expect(listed.next_cursor).toBeNull();
    expect(tools.all.map((x) => x.id)).toEqual(listed.items.map((x: { id: string }) => x.id));
    expect(tools.all.map((x) => x.name).filter((n) => n.startsWith("pager"))).toEqual([
      "pager-a",
      "pager-b",
    ]);
  });
});

describeDb("stdio MCP registration (Postgres)", () => {
  let t: TestApp;
  let jar: Jar;
  beforeAll(async () => {
    t = await createTestApp({
      mcpStdio: {
        enabled: true,
        allowedCommands: [
          { command: "/usr/bin/true" },
          { command: "/usr/bin/env", argsPattern: "--version" },
        ],
        envAllowlist: ["LOG_LEVEL"],
      },
    });
    jar = await login(t.app);
  });
  afterAll(async () => {
    await t.close();
  });
  const register = (body: Record<string, unknown>, headers?: Record<string, string>) =>
    call(
      t.app,
      headers ? null : jar,
      "POST",
      "/v1/mcp/servers",
      { transport: "stdio", ...body },
      headers,
    );

  it("checks the command, arguments and environment against the worker's policy", async () => {
    const ok = await register({
      name: "ok",
      command: "/usr/bin/true",
      env: { LOG_LEVEL: "debug" },
    });
    expect(ok.statusCode).toBe(201);
    expect((await register({ name: "sh", command: "/bin/sh" })).statusCode).toBe(403);
    expect((await register({ name: "rel", command: "true" })).statusCode).toBe(403);
    expect(
      (await register({ name: "args", command: "/usr/bin/env", args: ["node", "x.js"] }))
        .statusCode,
    ).toBe(403);
    const env = await register({
      name: "env",
      command: "/usr/bin/true",
      env: { NODE_OPTIONS: "-r x" },
    });
    expect(env.statusCode).toBe(400);
    expect(env.body).toContain("NODE_OPTIONS");
    const id = ok.json().id as string;
    expect(
      (await call(t.app, jar, "PATCH", `/v1/mcp/servers/${id}`, { command: "/bin/bash" }))
        .statusCode,
    ).toBe(403);
    expect(
      (await call(t.app, jar, "PATCH", `/v1/mcp/servers/${id}`, { name: "renamed" })).statusCode,
    ).toBe(200);
  });

  it("needs the admin scope, not just mcp:write", async () => {
    const key = (
      await call(t.app, jar, "POST", "/v1/api-keys", {
        name: "mcp-bot",
        scopes: ["mcp:read", "mcp:write"],
      })
    ).json().key as string;
    const auth = { authorization: `Bearer ${key}` };
    const res = await register({ name: "bot", command: "/usr/bin/true" }, auth);
    expect(res.statusCode).toBe(403);
    expect(res.body).toContain("admin scope");
    // HTTP servers still only need mcp:write
    expect(
      (
        await call(
          t.app,
          null,
          "POST",
          "/v1/mcp/servers",
          {
            name: "remote",
            transport: "streamable_http",
            url: "https://mcp.example.com/mcp",
          },
          auth,
        )
      ).statusCode,
    ).toBe(201);
  });
});
