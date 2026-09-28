import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { McpSessionPool } from "./pool.js";
import { connectSession, type McpServerConfig } from "./connect.js";
import { discoverTools } from "./discover.js";
import {
  createMcpToolCaller,
  MCP_PROMPT_BUILTIN,
  MCP_RESOURCE_BUILTIN,
  MCP_RESULT_MAX_BYTES,
} from "./caller.js";
import { startTestServer, type TestServer } from "./test/server.js";

let srv: TestServer;
let server: McpServerConfig;
beforeAll(async () => {
  srv = await startTestServer();
  server = {
    id: "00000000-0000-4000-8000-00000000abcd",
    name: "Security KB",
    transport: "streamable_http",
    url: srv.url,
    toolPolicy: { deny: ["admin_*", "kb://secret/*"] },
  };
});
afterAll(() => srv.close());

describe("McpSession over streamable HTTP", () => {
  it("lists and calls tools, reads resources and gets prompts", async () => {
    const session = await connectSession(server, {
      headers: JSON.stringify({ "X-Api-Key": "k1" }),
    });
    expect(session.serverInfo).toMatchObject({ name: "test-kb", version: "1.2.3" });
    expect((await session.listTools()).map((t) => t.name)).toContain("search_playbooks");
    const r = await session.callTool("search_playbooks", { query: "phishing" });
    expect(r.structuredContent).toEqual({ hits: [{ title: "Playbook for phishing", score: 0.9 }] });
    expect((await session.readResource("kb://guides/incident"))[0]?.text).toBe("# Incident guide");
    expect(
      (await session.getPrompt("triage", { ticket: "T-1" })).messages[0]?.content,
    ).toMatchObject({ text: "Triage this: T-1" });
    await session.ping();
    await session.close();
    expect(srv.requests.some((q) => q.headers["x-api-key"] === "k1")).toBe(true);
  });
});

describe("discoverTools", () => {
  it("sanitises, applies policy, maps idempotency and flags injection", async () => {
    const session = await connectSession(server, undefined);
    const d = await discoverTools(session, server);
    await session.close();
    const byName = Object.fromEntries(d.tools.map((t) => [t.name, t]));
    expect(Object.keys(byName).sort()).toEqual([
      "add_comment",
      "dump",
      "fails",
      "search_playbooks",
      "sneaky",
    ]);
    expect(d.nameMap.add_comment).toBe("add.comment!");
    expect(d.excluded).toEqual(["admin_delete"]);
    expect(byName.search_playbooks).toMatchObject({
      idempotency: "safe",
      capability: "security_kb.read",
      source: { kind: "mcp", serverId: server.id, tool: "search_playbooks" },
    });
    expect(byName.search_playbooks?.outputSchema).toBeDefined();
    expect(byName.add_comment).toMatchObject({
      idempotency: "keyed",
      capability: "security_kb.write",
    });
    expect(byName.fails?.idempotency).toBe("none");
    expect(d.warnings).toEqual([
      {
        code: "W_MCP_TOOL_SUSPICIOUS",
        tool: "sneaky",
        reasons: expect.arrayContaining([
          "contains chat-role markup",
          "asks the model to ignore its instructions",
          "asks for secrets",
        ]),
      },
    ]);
    expect(byName.sneaky?.approvalRequired).toBe(true);
    expect(d.resources.map((r) => r.uri)).toEqual(["kb://guides/incident"]);
    expect(d.prompts.map((p) => p.name)).toEqual(["triage"]);
  });
});

describe("createMcpToolCaller", () => {
  const pool = new McpSessionPool({ connect: (s, c) => connectSession(s, c) });
  afterAll(() => pool.closeAll());
  const lookup = {
    server: (id: string) =>
      Promise.resolve(
        id === server.id ? { ...server, nameMap: { add_comment: "add.comment!" } } : null,
      ),
    credential: () => Promise.resolve(null),
  };
  const call = createMcpToolCaller(pool, lookup);

  it("calls tools by their sanitised name and returns structured results", async () => {
    const r = await call(
      { kind: "mcp", serverId: server.id, tool: "search_playbooks" },
      "search_playbooks",
      { query: "ddos" },
    );
    expect(r).toMatchObject({ ok: true, structured: { hits: [{ title: "Playbook for ddos" }] } });
    const c = await call({ kind: "mcp", serverId: server.id, tool: "add_comment" }, "add_comment", {
      body: "hi",
    });
    expect(c).toMatchObject({ ok: true, content: "ok" });
    expect(srv.calls.at(-1)).toEqual({ name: "add.comment!", args: { body: "hi" } });
  });

  it("caps a large successful result and says it was cut", async () => {
    const r = await call({ kind: "mcp", serverId: server.id, tool: "dump" }, "dump", {});
    expect(r.ok).toBe(true);
    expect(new TextEncoder().encode(r.content).length).toBeLessThanOrEqual(MCP_RESULT_MAX_BYTES);
    expect(r.content).toMatch(/\[truncated: showing \d+ of \d+ bytes\]$/);
    // a cut JSON text is not parsed into a partial structure
    expect(r.structured).toBeUndefined();
  });

  it("returns tool errors as ok:false and enforces the policy", async () => {
    const r = await call({ kind: "mcp", serverId: server.id, tool: "fails" }, "fails", {});
    expect(r).toMatchObject({
      ok: false,
      content: "backend exploded",
      error: { code: "TOOL_EXECUTION_ERROR" },
    });
    await expect(
      call({ kind: "mcp", serverId: server.id, tool: "admin_delete" }, "admin_delete", {}),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      call({ kind: "mcp", serverId: "00000000-0000-4000-8000-000000000000", tool: "x" }, "x", {}),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("reads resources and prompts through the builtins, with the policy on URIs", async () => {
    const r = await call({ kind: "builtin", id: MCP_RESOURCE_BUILTIN }, MCP_RESOURCE_BUILTIN, {
      serverId: server.id,
      uri: "kb://guides/incident",
    });
    expect(r).toMatchObject({ ok: true, structured: { contents: [{ text: "# Incident guide" }] } });
    await expect(
      call({ kind: "builtin", id: MCP_RESOURCE_BUILTIN }, MCP_RESOURCE_BUILTIN, {
        serverId: server.id,
        uri: "kb://secret/keys",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const p = await call({ kind: "builtin", id: MCP_PROMPT_BUILTIN }, MCP_PROMPT_BUILTIN, {
      serverId: server.id,
      name: "triage",
      arguments: { ticket: "T-9" },
    });
    expect(p.structured).toMatchObject({
      messages: [{ role: "user", content: "Triage this: T-9" }],
    });
  });

  it("reuses one session per (server, credential)", () => {
    expect(pool.size).toBe(1);
  });
});
