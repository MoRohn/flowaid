// A tiny stdio MCP server with no dependencies: newline-delimited JSON-RPC on stdin/stdout.
// It answers initialize, ping and tools/list, reports `TINY_GREETING` from its environment in
// the first tool's description (so tests see what reached the child), and refuses the rest.
import { createInterface } from "node:readline";

const tools = [
  {
    name: "search.docs",
    description: `Search the docs. ${process.env.TINY_GREETING ?? ""}`.trim(),
    inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
    annotations: { readOnlyHint: true },
  },
  { name: "echo", description: "Echoes its text.", inputSchema: { type: "object" } },
];

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.id === undefined) return; // notifications
  switch (msg.method) {
    case "initialize":
      return send({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          protocolVersion: msg.params?.protocolVersion ?? "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "tiny-stdio", version: "1.0.0" },
        },
      });
    case "ping":
      return send({ jsonrpc: "2.0", id: msg.id, result: {} });
    case "tools/list":
      return send({ jsonrpc: "2.0", id: msg.id, result: { tools } });
    case "tools/call":
      return send({
        jsonrpc: "2.0",
        id: msg.id,
        result: { content: [{ type: "text", text: JSON.stringify(msg.params?.arguments ?? {}) }] },
      });
    default:
      return send({
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: -32601, message: `method not found: ${msg.method}` },
      });
  }
});
process.stdin.on("end", () => process.exit(0));
