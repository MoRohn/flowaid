# Tools

- **`toLangChainTool(definition, execute)`** wraps a FlowAId tool — HTTP, MCP, OpenAPI or a
  workflow — as a LangChain `StructuredTool`, with a Zod schema derived from the tool's JSON
  Schema. Failures return to the model as an error message unless `throwOnError` is set.
- **`fromLangChainTool(tool)`** turns a LangChain tool into a FlowAId `ToolDefinition` plus an
  executor; idempotency and capability come from `tool.metadata`.
- **`workflowAsLangChainTool(client, workflowId, opts)`** exposes a FlowAId workflow as a
  LangChain tool. The client is anything with `runWorkflow(id, input, opts)` — the SDK client
  against a server, or a `runLocally` wrapper in an exported code package. This is how a
  LangChain application calls a FlowAId flow, with its typed decisions and human approvals.

```ts
import { workflowAsLangChainTool } from "@flowaid/langchain";

const triage = workflowAsLangChainTool(client, "3e7a1c9b-…", {
  name: "triage_ticket",
  description: "Routes a support ticket and drafts a reply",
  inputSchema: {
    type: "object",
    properties: { message: { type: "string" } },
    required: ["message"],
  },
});
```

Code packages downloaded from FlowAId include `src/langchain.ts` with exactly this wiring when
the flow uses LangChain nodes.
