import { z } from "zod";
import { defineNode, ok } from "@flowaid/node-sdk";
import { SandboxError, type JsonObject } from "@flowaid/workflow-core";

export const codeNode = defineNode({
  id: "flowaid.tools.code",
  version: "1.0.0",
  metadata: {
    name: "Code",
    description:
      "Runs JavaScript or TypeScript in the sandbox: the code is an async function body that receives `inputs` and returns `result`. It has no Node APIs; `fetch` only with allowNetwork to allow-listed hosts, `tools.call` only for the listed tools, and `state.get/set` scoped to the run.",
    category: "tool",
    icon: "code",
    tags: ["code", "sandbox", "javascript", "typescript"],
    summary: "{{ config.language }}",
  },
  configSchema: z.strictObject({
    language: z
      .enum(["typescript", "javascript"])
      .default("typescript")
      .meta({ "x-ui": { widget: "select" } }),
    code: z
      .string()
      .min(1)
      .max(100_000)
      .meta({
        "x-ui": {
          widget: "code",
          language: "typescript",
          placeholder: "return { total: inputs.items.length };",
        },
      }),
    inputs: z
      .record(z.string(), z.unknown())
      .optional()
      .meta({
        "x-ui": { widget: "schema", help: "JSON Schema of `inputs`; it types the input port." },
      }),
    output: z
      .record(z.string(), z.unknown())
      .optional()
      .meta({
        "x-ui": {
          widget: "schema",
          help: "JSON Schema of the return value; checked at run time and it types `result`.",
        },
      }),
    allowNetwork: z
      .boolean()
      .default(false)
      .meta({ "x-ui": { widget: "switch" } }),
    allowedHosts: z
      .array(z.string().regex(/^(?:\*\.)?[a-z0-9.-]+$/i))
      .max(50)
      .default([])
      .meta({
        "x-ui": {
          widget: "list",
          showWhen: { path: "/allowNetwork", truthy: true },
          help: "Exact host names or *.suffix.",
        },
      }),
    tools: z
      .array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/))
      .max(20)
      .default([])
      .meta({
        "x-ui": {
          widget: "list",
          help: "Tools the code may call (tools that need approval are refused).",
        },
      }),
    idempotent: z
      .boolean()
      .default(false)
      .meta({
        "x-ui": {
          widget: "switch",
          help: "Declare the code free of side effects so it may be retried.",
        },
      }),
    timeoutMs: z.int().min(100).max(120_000).default(10_000),
    memoryMb: z.int().min(16).max(512).default(128),
  }),
  inputSchema: z.object({ inputs: z.record(z.string(), z.unknown()).default({}) }),
  outputSchema: z.object({
    result: z.unknown(),
    logs: z.array(z.object({ level: z.string(), message: z.string() })),
    duration_ms: z.int().min(0),
  }),
  portRules: [
    { kind: "inputSchemaFromConfig", port: "inputs", path: "/inputs" },
    { kind: "outputSchemaFromConfig", port: "result", path: "/output" },
  ],
  capabilities: ["sandbox"],
  pool: "code",
  idempotency: { byConfig: "/idempotent", cases: { true: "safe", false: "none" }, default: "none" },
  defaultPolicy: { timeoutMs: 30_000 },
  execute: async (ctx, input) => {
    if (!ctx.sandbox)
      throw new SandboxError("SANDBOX_UNAVAILABLE: this worker pool has no sandbox executor");
    const c = ctx.config;
    const r = await ctx.sandbox.run({
      language: c.language,
      code: c.code,
      inputs: input.inputs as JsonObject,
      timeoutMs: Math.min(c.timeoutMs, ctx.budget.remainingMs || c.timeoutMs),
      memoryMb: c.memoryMb,
      allowNetwork: c.allowNetwork,
      allowedHosts: c.allowedHosts,
      tools: c.tools,
      ...(c.output ? { outputSchema: c.output } : {}),
    });
    for (const line of r.logs) ctx.logger[line.level](line.message);
    return ok({ result: r.output, logs: r.logs, duration_ms: r.durationMs });
  },
});
