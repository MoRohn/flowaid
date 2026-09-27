// A stdio MCP server for the stdio transport tests. It starts a long-lived grandchild so the
// test can check that closing the transport kills the whole process group.
import { spawn } from "node:child_process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  stdio: "ignore",
});
const server = new McpServer({ name: "stdio-test", version: "0.0.1" });
server.registerTool("env", { description: "Reports its environment and helper pid." }, () => ({
  content: [
    {
      type: "text",
      text: JSON.stringify({ env: process.env, cwd: process.cwd(), grandchild: grandchild.pid }),
    },
  ],
}));
process.stderr.write("stdio-test ready\n");
await server.connect(new StdioServerTransport());
