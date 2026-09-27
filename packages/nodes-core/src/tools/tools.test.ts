import { describe, expect, it } from "vitest";
import { runNode } from "@flowaid/node-sdk/testing";
import type { JsonValue, ToolDefinition, ToolResult } from "@flowaid/workflow-core";
import { mcpNode } from "./mcp.js";
import { mcpPromptNode } from "./mcp_prompt.js";
import { mcpResourceNode } from "./mcp_resource.js";
import { openapiNode } from "./openapi.js";

const SERVER = "00000000-0000-4000-8000-00000000abcd";
const TOOLSET = "00000000-0000-4000-8000-000000000042";

function tool(name: string, handler: (args: JsonValue) => Omit<ToolResult, "latencyMs">) {
  return {
    definition: {
      name,
      description: "",
      inputSchema: { type: "object" },
      idempotency: "safe",
      approvalRequired: false,
      source: { kind: "builtin", id: name },
    } satisfies ToolDefinition,
    handler: (args: JsonValue) => ({ ...handler(args), latencyMs: 1 }),
  };
}

describe("MCP and OpenAPI nodes", () => {
  it("mcp passes its input ports as the tool arguments", async () => {
    const r = await runNode(mcpNode, {
      config: { serverId: SERVER, tool: "search_playbooks" },
      input: { query: "phishing" },
      tools: [
        tool("search_playbooks", (args) => ({
          ok: true,
          content: "1 hit",
          structured: { hits: [args] },
        })),
      ],
    });
    expect(r.result).toMatchObject({
      kind: "ok",
      output: { result: { hits: [{ query: "phishing" }] }, content: "1 hit" },
    });
    expect(r.recorder.toolCalls[0]).toMatchObject({
      source: { kind: "mcp", serverId: SERVER, tool: "search_playbooks" },
      args: { query: "phishing" },
    });
  });

  it("mcp turns ok:false into a TOOL_EXECUTION_ERROR", async () => {
    const r = await runNode(mcpNode, {
      config: { serverId: SERVER, tool: "fails" },
      tools: [tool("fails", () => ({ ok: false, content: "backend exploded" }))],
    });
    expect(r.result).toMatchObject({
      kind: "error",
      error: { code: "TOOL_EXECUTION_ERROR", message: "backend exploded" },
    });
  });

  it("mcp_resource reads through the builtin and joins text", async () => {
    const r = await runNode(mcpResourceNode, {
      config: { serverId: SERVER, uri: "kb://guides/incident" },
      tools: [
        tool("mcp_resource_read", (a) => ({
          ok: true,
          content: "",
          structured: {
            contents: [
              { uri: (a as { uri: string }).uri, text: "# Guide" },
              { uri: "x", blob: "AA==" },
            ] as JsonValue,
          },
        })),
      ],
    });
    expect(r.result).toMatchObject({
      kind: "ok",
      output: { text: "# Guide", contents: [{ uri: "kb://guides/incident" }, { blob: "AA==" }] },
    });
  });

  it("mcp_prompt stringifies its dynamic inputs and returns messages", async () => {
    const r = await runNode(mcpPromptNode, {
      config: { serverId: SERVER, name: "triage" },
      input: { ticket: "T-1", priority: 2 },
      tools: [
        tool("mcp_prompt_get", (a) => ({
          ok: true,
          content: "",
          structured: {
            messages: [
              { role: "user", content: JSON.stringify((a as { arguments: unknown }).arguments) },
            ],
          },
        })),
      ],
    });
    expect(r.result).toMatchObject({
      kind: "ok",
      output: {
        messages: [{ role: "user", content: '{"ticket":"T-1","priority":"2"}' }],
        description: "",
      },
    });
  });

  it("openapi returns status and body", async () => {
    const r = await runNode(openapiNode, {
      config: { toolsetId: TOOLSET, operationId: "refundInvoice" },
      input: { path: { id: "inv_1" }, body: { amount: 5 } },
      tools: [
        tool("refundInvoice", () => ({
          ok: true,
          content: "{}",
          structured: { status: 200, body: { refundId: "r1" } },
        })),
      ],
    });
    expect(r.result).toMatchObject({
      kind: "ok",
      output: { status: 200, body: { refundId: "r1" } },
    });
    expect(r.recorder.toolCalls[0]?.source).toEqual({
      kind: "openapi",
      toolsetId: TOOLSET,
      operationId: "refundInvoice",
    });
  });
});
