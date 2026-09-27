import { z } from "zod";
import { defineNode, ok } from "@flowaid/node-sdk";
import { NodeExecutionError, SandboxError } from "@flowaid/workflow-core";

export const shellNode = defineNode({
  id: "flowaid.tools.shell",
  version: "1.0.0",
  metadata: {
    name: "Shell script",
    description:
      "Runs a shell script in a throwaway container (no network, read-only root, bounded memory and processes). Requires SANDBOX_MODE=container. Non-zero exits fail the node unless `allowNonZeroExit`.",
    category: "tool",
    icon: "terminal",
    tags: ["shell", "sandbox", "container"],
    summary: "{{ config.image }}",
  },
  configSchema: z.strictObject({
    script: z
      .string()
      .min(1)
      .max(100_000)
      .meta({ "x-ui": { widget: "code", language: "shell" } }),
    image: z
      .string()
      .regex(/^[a-z0-9][a-z0-9._/-]*(?::[A-Za-z0-9._-]+)?(?:@sha256:[a-f0-9]{64})?$/)
      .optional()
      .meta({
        "x-ui": {
          help: "Container image (must be on the operator's allow-list); the executor's default otherwise.",
        },
      }),
    env: z
      .record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string())
      .default({})
      .meta({ "x-ui": { widget: "keyvalue" } }),
    allowNonZeroExit: z
      .boolean()
      .default(false)
      .meta({ "x-ui": { widget: "switch" } }),
    timeoutMs: z.int().min(100).max(120_000).default(30_000),
    memoryMb: z.int().min(16).max(1024).default(128),
  }),
  inputSchema: z.object({ stdin: z.string().optional() }),
  outputSchema: z.object({
    exit_code: z.int(),
    stdout: z.string(),
    stderr: z.string(),
    duration_ms: z.int().min(0),
  }),
  controlPorts: [
    {
      name: "nonzero",
      label: "Non-zero exit",
      description: "The script exited with a non-zero code (only with allowNonZeroExit).",
    },
  ],
  capabilities: ["sandbox"],
  pool: "code",
  idempotency: "none",
  defaultPolicy: { timeoutMs: 60_000 },
  execute: async (ctx, input) => {
    if (!ctx.sandbox)
      throw new SandboxError("SANDBOX_UNAVAILABLE: this worker pool has no sandbox executor");
    const c = ctx.config;
    const r = await ctx.sandbox.shell({
      script: c.script,
      ...(c.image ? { image: c.image } : {}),
      ...(input.stdin !== undefined ? { stdin: input.stdin } : {}),
      env: c.env,
      timeoutMs: c.timeoutMs,
      memoryMb: c.memoryMb,
    });
    if (r.exitCode !== 0 && !c.allowNonZeroExit)
      throw new NodeExecutionError(
        `the script exited with ${r.exitCode}: ${r.stderr.slice(-2000)}`,
        false,
        { exitCode: r.exitCode },
      );
    return ok(
      { exit_code: r.exitCode, stdout: r.stdout, stderr: r.stderr, duration_ms: r.durationMs },
      r.exitCode !== 0 ? { route: "nonzero" } : {},
    );
  },
});
