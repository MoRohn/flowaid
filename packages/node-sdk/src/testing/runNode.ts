/**
 * `runNode(def, options)`: executes a node the way the runtime does (ARCHITECTURE.md §3.1, §3.7):
 * config and input are validated against the node's Zod schemas before `execute`, the output
 * after it; throwing is turned into an error result; a route must be a declared control port;
 * suspending requires the `suspend` capability.
 */
import {
  ForbiddenError,
  NodeExecutionError,
  OutputSchemaMismatchError,
  SchemaValidationError,
  toFlowaidError,
  type JsonObject,
  type JsonValue,
} from "@flowaid/workflow-core";
import type { z } from "zod";
import type { AnyNodeDefinition, ExecutionContext, NodeResult } from "../types.js";
import { createTestContext, type Recorder, type TestContextOptions } from "./createTestContext.js";

export interface RunNodeOptions extends Omit<TestContextOptions, "config" | "capabilities"> {
  config?: JsonValue;
  input?: JsonValue;
}

export interface RunNodeResult<T> {
  result: NodeResult<T>;
  recorder: Recorder;
  ctx: ExecutionContext;
}

function issues(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.map((p) => `/${String(p)}`).join(""),
    message: issue.message,
  }));
}

/** Control ports a result may route to: declared ports plus those derived from config. */
export function allowedRoutes(def: AnyNodeDefinition, config: JsonObject): Set<string> {
  const routes = new Set<string>(["done", ...(def.controlPorts ?? []).map((p) => p.name)]);
  for (const rule of def.portRules ?? []) {
    if (rule.kind !== "controlPortsFromConfig") continue;
    let value: unknown = config;
    for (const token of rule.path.split("/").slice(1)) {
      value =
        typeof value === "object" && value !== null
          ? (value as Record<string, unknown>)[token]
          : undefined;
    }
    const names = Array.isArray(value)
      ? value
      : typeof value === "object" && value !== null
        ? Object.keys(value)
        : [];
    for (const name of names) if (typeof name === "string") routes.add(name);
  }
  return routes;
}

export async function runNode(
  def: AnyNodeDefinition,
  options: RunNodeOptions = {},
): Promise<RunNodeResult<unknown>> {
  const config = def.configSchema.safeParse(options.config ?? {});
  const { ctx, recorder } = createTestContext<JsonObject>({
    ...options,
    config: (config.success ? config.data : {}) as JsonObject,
    capabilities: def.capabilities,
    node: { type: def.id, ...options.node },
  });
  const done = (result: NodeResult<unknown>) => ({ result, recorder, ctx });

  if (!config.success) {
    return done({
      kind: "error",
      error: new SchemaValidationError(
        "config does not match the node's configSchema",
        issues(config.error),
      ),
    });
  }
  const input = def.inputSchema.safeParse(options.input ?? {});
  if (!input.success) {
    return done({
      kind: "error",
      error: new SchemaValidationError(
        "input does not match the node's inputSchema",
        issues(input.error),
      ),
    });
  }

  let result: NodeResult<unknown>;
  try {
    result = await def.execute(ctx, input.data);
  } catch (thrown) {
    return done({ kind: "error", error: toFlowaidError(thrown) });
  }

  // A decision node may suspend without the capability: the human hop of its failover chain.
  const failover =
    def.decision !== undefined && result.kind === "suspend" && result.wait.kind === "human";
  if (result.kind === "suspend" && !failover && !def.capabilities.includes("suspend")) {
    return done({
      kind: "error",
      error: new ForbiddenError("returning suspend needs the 'suspend' capability"),
    });
  }
  if (result.kind !== "ok") return done(result);

  if (
    result.route !== undefined &&
    !allowedRoutes(def, config.data as JsonObject).has(result.route)
  ) {
    return done({
      kind: "error",
      error: new NodeExecutionError(
        `route '${result.route}' is not a control port of ${def.id}`,
        false,
      ),
    });
  }
  const output = def.outputSchema.safeParse(result.output);
  if (!output.success) {
    return done({
      kind: "error",
      error: new OutputSchemaMismatchError(`output does not match the node's outputSchema`, {
        issues: issues(output.error),
      }),
    });
  }
  return done({ ...result, output: output.data });
}
