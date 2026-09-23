import { z } from "zod";
import { defineNode, ok } from "@flowaid/node-sdk";
import { NodeExecutionError, type JsonValue } from "@flowaid/workflow-core";

export const mockNode = defineNode({
  id: "flowaid.dev.mock",
  version: "1.0.0",
  metadata: {
    name: "Mock",
    description:
      "Returns a fixed value (optionally after a delay, or as a failure) — a stand-in for a node you have not built yet, or for tests.",
    category: "developer",
    icon: "flask-conical",
    tags: ["developer", "test", "stub"],
    summary: "mock",
  },
  configSchema: z.strictObject({
    output: z
      .unknown()
      .optional()
      .meta({ "x-ui": { widget: "json" } }),
    delayMs: z.int().min(0).max(60000).default(0),
    fail: z
      .strictObject({ message: z.string().min(1), retryable: z.boolean().default(false) })
      .optional()
      .meta({ "x-ui": { help: "Fail with this message instead of returning `output`." } }),
    route: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,63}$/)
      .optional()
      .meta({ "x-ui": { help: "A control port to fire (declare it in `ports`)." } }),
    ports: z
      .array(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/))
      .max(32)
      .default([]),
  }),
  inputSchema: z.object({}),
  outputSchema: z.object({ output: z.unknown() }),
  portRules: [{ kind: "controlPortsFromConfig", path: "/ports" }],
  capabilities: [],
  idempotency: "safe",
  defaultPolicy: { timeoutMs: 70000 },
  execute: async (ctx) => {
    if (ctx.config.delayMs > 0)
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, ctx.config.delayMs);
        ctx.signal.addEventListener(
          "abort",
          () => (clearTimeout(t), reject(ctx.signal.reason as Error)),
          { once: true },
        );
      });
    if (ctx.config.fail)
      throw new NodeExecutionError(ctx.config.fail.message, ctx.config.fail.retryable);
    const output = (ctx.config.output ?? null) as JsonValue;
    return ok({ output }, ctx.config.route ? { route: ctx.config.route } : {});
  },
});
