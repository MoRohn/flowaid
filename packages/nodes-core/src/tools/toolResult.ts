/** Shared handling of `ctx.tools.call` results for the tool nodes. */
import { ToolExecutionError, type ToolResult } from "@flowaid/workflow-core";

/** Throws the tool's error when the call did not succeed. */
export function expectOk(result: ToolResult, tool: string): ToolResult {
  if (result.ok) return result;
  throw new ToolExecutionError(
    result.error?.message ?? (result.content || `${tool} failed`),
    result.error?.retryable ?? false,
    tool,
    {
      content: result.content.slice(0, 2000),
    },
  );
}
