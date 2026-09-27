/**
 * Tool adapters (LANGCHAIN.md §2).
 *
 * - `toLangChainTool`: a flowaid tool (HTTP, MCP, OpenAPI, workflow-as-tool) as a LangChain
 *   `StructuredTool`, its Zod schema derived from the tool's JSON Schema, so LangChain/LangGraph
 *   agents can call it. Failures come back to the model as an error message by default (the agent
 *   can recover); `throwOnError` rethrows instead.
 * - `fromLangChainTool`: a LangChain tool as a flowaid `ToolDefinition` plus an executor that
 *   returns a `ToolResult`; idempotency and capability come from `tool.metadata`.
 * - `workflowAsLangChainTool`: a FlowAId workflow as a LangChain tool, run through the
 *   `@flowaid/workflow-sdk` client (server) or `runLocally` (embedded) via a small structural
 *   interface, so this package depends on neither.
 */
import { DynamicStructuredTool, type StructuredToolInterface } from "@langchain/core/tools";
import { toJsonSchema } from "@langchain/core/utils/json_schema";
import {
  IdempotencySchema,
  ToolNameSchema,
  toFlowaidError,
  type Idempotency,
  type JsonSchema,
  type JsonValue,
  type ToolDefinition,
  type ToolResult,
} from "@flowaid/workflow-core";
import { jsonSchemaToZod, type SchemaWarning } from "./schema.js";

export type ToolExecutor = (args: JsonValue, opts: { signal?: AbortSignal }) => Promise<ToolResult>;

export interface ToLangChainToolOptions {
  throwOnError?: boolean;
  /** called once with the JSON Schema constructs the Zod schema does not enforce */
  onSchemaWarnings?: (warnings: SchemaWarning[]) => void;
}

/** What a model sees from a tool result: the text, or the error. */
export function toolResultText(result: ToolResult): string {
  if (result.ok) return result.content;
  return `Error${result.error ? ` (${result.error.code})` : ""}: ${result.error?.message ?? result.content}`;
}

export function toLangChainTool(
  tool: ToolDefinition,
  execute: ToolExecutor,
  options: ToLangChainToolOptions = {},
): DynamicStructuredTool {
  const { schema, warnings } = jsonSchemaToZod(tool.inputSchema);
  if (warnings.length) options.onSchemaWarnings?.(warnings);
  return new DynamicStructuredTool({
    name: tool.name,
    description: tool.description || tool.name,
    schema: schema as never,
    responseFormat: "content_and_artifact",
    metadata: {
      idempotency: tool.idempotency,
      approvalRequired: tool.approvalRequired,
      ...(tool.capability ? { capability: tool.capability } : {}),
      flowaidSource: tool.source.kind,
    },
    func: async (args: unknown, _runManager, config) => {
      const signal = config?.signal;
      let result: ToolResult;
      try {
        result = await execute(args as JsonValue, signal ? { signal } : {});
      } catch (error) {
        if (options.throwOnError) throw error;
        const e = toFlowaidError(error);
        return [`Error (${e.code}): ${e.message}`, null];
      }
      if (!result.ok && options.throwOnError)
        throw new Error(result.error?.message ?? result.content);
      return [toolResultText(result), result.structured ?? null];
    },
  });
}

export interface FromLangChainTool {
  definition: ToolDefinition;
  execute: ToolExecutor;
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "content" in value) {
    const content = value.content;
    if (typeof content === "string") return content;
  }
  return JSON.stringify(value) ?? "";
}

export function fromLangChainTool(
  tool: StructuredToolInterface,
  opts: { now?: () => number } = {},
): FromLangChainTool {
  const now = opts.now ?? Date.now;
  const metadata = (tool as { metadata?: Record<string, unknown> }).metadata ?? {};
  const idempotency = IdempotencySchema.safeParse(metadata.idempotency);
  const name = ToolNameSchema.safeParse(tool.name).success
    ? tool.name
    : tool.name.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
  const inputSchema = toJsonSchema(tool.schema as never) as JsonSchema & { $schema?: string };
  delete inputSchema.$schema;
  const definition: ToolDefinition = {
    name,
    description: (tool.description || name).slice(0, 4000),
    inputSchema,
    ...(typeof metadata.capability === "string" ? { capability: metadata.capability } : {}),
    idempotency: (idempotency.success ? idempotency.data : "none") satisfies Idempotency,
    approvalRequired: metadata.approvalRequired === true,
    source: { kind: "builtin", id: name },
  };
  return {
    definition,
    execute: async (args, { signal }) => {
      const started = now();
      try {
        const out: unknown = await tool.invoke(args as never, signal ? { signal } : {});
        const content = stringify(out);
        let structured: JsonValue | undefined;
        if (typeof out === "object" && out !== null) structured = out as JsonValue;
        else {
          try {
            structured = JSON.parse(content) as JsonValue;
          } catch {
            structured = undefined;
          }
        }
        return {
          ok: true,
          content,
          ...(structured !== undefined ? { structured } : {}),
          latencyMs: now() - started,
        };
      } catch (error) {
        const e = toFlowaidError(error);
        return {
          ok: false,
          content: e.message,
          error: e.toInfo(),
          latencyMs: now() - started,
        };
      }
    },
  };
}

/** The part of a FlowAId client (or a `runLocally` wrapper) a workflow tool needs. */
export interface WorkflowRunClient {
  runWorkflow(
    workflowId: string,
    input: JsonValue,
    opts: { signal?: AbortSignal; environment?: string },
  ): Promise<{
    status: string;
    output?: JsonValue;
    error?: { code: string; message: string } | null;
    runId?: string;
  }>;
}

export interface WorkflowToolOptions {
  name: string;
  description: string;
  /** the workflow's `inputs` JSON Schema */
  inputSchema: JsonSchema;
  environment?: string;
}

/** A FlowAId workflow as a LangChain tool; the answer is the workflow's output as JSON. */
export function workflowAsLangChainTool(
  client: WorkflowRunClient,
  workflowId: string,
  opts: WorkflowToolOptions,
): DynamicStructuredTool {
  const definition: ToolDefinition = {
    name: opts.name,
    description: opts.description,
    inputSchema: opts.inputSchema,
    idempotency: "none",
    approvalRequired: false,
    source: { kind: "workflow", workflowId },
  };
  return toLangChainTool(definition, async (args, { signal }) => {
    const started = Date.now();
    const r = await client.runWorkflow(workflowId, args, {
      ...(signal ? { signal } : {}),
      ...(opts.environment ? { environment: opts.environment } : {}),
    });
    const ok = r.status === "completed" || r.status === "succeeded";
    return ok
      ? {
          ok: true,
          content: JSON.stringify(r.output ?? null),
          structured: r.output ?? null,
          latencyMs: Date.now() - started,
        }
      : {
          ok: false,
          content: r.error?.message ?? `the workflow ended ${r.status}`,
          error: {
            code: "SUBFLOW_ERROR",
            message:
              r.error?.message ??
              `the workflow ended ${r.status}${r.runId ? ` (run ${r.runId})` : ""}`,
            retryable: false,
          },
          latencyMs: Date.now() - started,
        };
  });
}
