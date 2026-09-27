/**
 * Workflows as MCP tools (ARCHITECTURE.md §10.2): the `tools/list` and `resources/list` views of a
 * workspace's MCP exposures, filtered by the calling token's workflow pin, and the mapping of a
 * run's outcome to a `tools/call` result.
 */
import type { JsonObject, JsonValue } from "@flowaid/workflow-core";
import { sanitizeToolDescription, sanitizeToolName } from "./sanitize.js";

export interface McpExposure {
  toolName: string;
  description: string;
  workflowId: string;
  workflowName?: string;
  enabled: boolean;
  inputSchema: JsonObject;
  outputSchema?: JsonObject;
}

export interface ExposedTool {
  name: string;
  description: string;
  inputSchema: JsonObject;
  outputSchema?: JsonObject;
  annotations: { title: string; openWorldHint: boolean };
}

/** Enabled exposures the principal may see (`workflowPin` null = unpinned), sorted by name. */
export function buildExposedTools(
  exposures: readonly McpExposure[],
  workflowPin: readonly string[] | null,
): ExposedTool[] {
  return exposures
    .filter((e) => e.enabled && (workflowPin === null || workflowPin.includes(e.workflowId)))
    .map((e) => ({
      name: sanitizeToolName(e.toolName),
      description: sanitizeToolDescription(e.description),
      inputSchema:
        e.inputSchema.type === undefined ? { ...e.inputSchema, type: "object" } : e.inputSchema,
      ...(e.outputSchema ? { outputSchema: e.outputSchema } : {}),
      annotations: { title: e.workflowName ?? e.toolName, openWorldHint: true },
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export const workflowSchemaUri = (workflowId: string) => `flowaid://workflows/${workflowId}/schema`;
export const runUri = (runId: string) => `flowaid://runs/${runId}`;

export function exposedResources(
  exposures: readonly McpExposure[],
  workflowPin: readonly string[] | null,
) {
  return buildExposedTools(exposures, workflowPin).map((t) => {
    const e = exposures.find((x) => sanitizeToolName(x.toolName) === t.name);
    return {
      uri: workflowSchemaUri(e?.workflowId ?? ""),
      name: `${t.name} schema`,
      mimeType: "application/json",
      description: `Input and output schema of ${t.annotations.title}`,
    };
  });
}

export type RunOutcome =
  | { status: "succeeded"; runId: string; output: JsonValue }
  | { status: "failed"; runId: string; error: { code: string; message: string } }
  | { status: "running" | "waiting"; runId: string };

/** `tools/call` result for a workflow run: structured output, an error, or a link to the run. */
export function runOutcomeToCallResult(outcome: RunOutcome) {
  switch (outcome.status) {
    case "succeeded": {
      const structured =
        typeof outcome.output === "object" &&
        outcome.output !== null &&
        !Array.isArray(outcome.output)
          ? outcome.output
          : { result: outcome.output };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(outcome.output) }],
        structuredContent: structured,
        isError: false,
      };
    }
    case "failed":
      return {
        content: [
          { type: "text" as const, text: `${outcome.error.code}: ${outcome.error.message}` },
        ],
        isError: true,
      };
    case "running":
    case "waiting":
      return {
        content: [
          {
            type: "text" as const,
            text: `The run is ${outcome.status === "waiting" ? "waiting for a person" : "still running"}; follow it at ${runUri(outcome.runId)}.`,
          },
          {
            type: "resource_link" as const,
            uri: runUri(outcome.runId),
            name: `run ${outcome.runId}`,
            mimeType: "application/json",
          },
        ],
        isError: false,
      };
  }
}
