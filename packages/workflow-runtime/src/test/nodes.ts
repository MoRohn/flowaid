/** Test-only node definitions and a provider registry with a scripted decision provider. */
import { z } from "zod";
import { defineNode, definePackage, ok, suspend, fail } from "@flowaid/node-sdk";
import { DefaultModelCatalog, ProviderRegistry, booleanDecision } from "@flowaid/providers";
import {
  NodeExecutionError,
  WORKFLOW_SCHEMA_URI,
  type DecisionProvider,
  type ProviderFactory,
} from "@flowaid/workflow-core";

const meta = (name: string) => ({
  name,
  description: name,
  category: "developer" as const,
  icon: "box",
  tags: [],
});

export const addNode = defineNode({
  id: "@test/kit.add",
  version: "1.0.0",
  metadata: meta("Add"),
  configSchema: z.object({ amount: z.number().default(1) }),
  inputSchema: z.object({ value: z.number() }),
  outputSchema: z.object({ value: z.number() }),
  capabilities: [],
  idempotency: "safe",
  execute: (ctx, input) => Promise.resolve(ok({ value: input.value + ctx.config.amount })),
});

const attempts = new Map<string, number>();
export const flakyNode = defineNode({
  id: "@test/kit.flaky",
  version: "1.0.0",
  metadata: meta("Flaky"),
  configSchema: z.object({ failTimes: z.number() }),
  inputSchema: z.object({ value: z.number() }),
  outputSchema: z.object({ value: z.number(), attempt: z.number() }),
  capabilities: [],
  idempotency: "safe",
  execute: (ctx, input) => {
    const n = (attempts.get(ctx.run.id) ?? 0) + 1;
    attempts.set(ctx.run.id, n);
    return Promise.resolve(
      n <= ctx.config.failTimes
        ? fail(new NodeExecutionError("transient", true))
        : ok({ value: input.value, attempt: ctx.node.attempt }),
    );
  },
});

export const slowNode = defineNode({
  id: "@test/kit.slow",
  version: "1.0.0",
  metadata: meta("Slow"),
  configSchema: z.object({ ms: z.number() }),
  inputSchema: z.object({ value: z.number() }),
  outputSchema: z.object({ value: z.number() }),
  capabilities: [],
  idempotency: "safe",
  execute: (ctx, input) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => resolve(ok({ value: input.value })), ctx.config.ms);
      ctx.signal.addEventListener("abort", () => {
        clearTimeout(t);
        reject(ctx.signal.reason instanceof Error ? ctx.signal.reason : new Error("aborted"));
      });
    }),
});

export const decideNode = defineNode({
  id: "@test/kit.decide",
  version: "1.0.0",
  metadata: meta("Decide"),
  configSchema: z.object({ question: z.string() }),
  inputSchema: z.object({ state: z.string() }),
  outputSchema: z.object({ yes: z.boolean(), confidence: z.number() }),
  controlPorts: [
    { name: "yes", label: "Yes" },
    { name: "no", label: "No" },
  ],
  capabilities: ["decision"],
  idempotency: "safe",
  execute: async (ctx, input) => {
    const provider = ctx.providers.decision([{ provider: "custom", id: "acme", model: "acme-1" }]);
    const d = await provider.decideBoolean(
      input.state,
      { kind: "boolean", instructions: ctx.config.question },
      {
        signal: ctx.signal,
        runId: ctx.run.id,
        nodeRunId: ctx.node.nodeRunId,
        idempotencyKey: ctx.node.idempotencyKey,
      },
    );
    return ok(
      { yes: d.value, confidence: d.confidence },
      { route: d.value ? "yes" : "no", costUsd: d.costUsd, ...(d.usage ? { usage: d.usage } : {}) },
    );
  },
});

export const approvalNode = defineNode({
  id: "@test/kit.approval",
  version: "1.0.0",
  metadata: meta("Approval"),
  configSchema: z.object({}),
  inputSchema: z.object({ value: z.number() }),
  outputSchema: z.object({ approved: z.boolean(), value: z.number() }),
  capabilities: ["suspend"],
  idempotency: "safe",
  execute: (ctx, input) => {
    if (ctx.resume?.kind === "human")
      return Promise.resolve(
        ok({ approved: ctx.resume.response.action === "approve", value: input.value }),
      );
    return Promise.resolve(
      suspend(
        {
          kind: "human",
          request: {
            title: `Approve ${input.value}?`,
            context: { value: input.value },
            mode: { type: "approval" },
            assignees: [],
            expiresAt: null,
            externalReview: false,
          },
        },
        { asked: true },
      ),
    );
  },
});

export const testPackage = definePackage({
  name: "@test/kit",
  version: "1.0.0",
  sdk: "^1.0.0",
  nodes: [addNode, flakyNode, slowNode, decideNode, approvalNode],
});

/** A registry whose `custom:acme` decision provider answers pYes from a script. */
export function acmeRegistry(pYes: number[] = [0.9]): {
  registry: ProviderRegistry;
  calls: { n: number; credential: unknown };
} {
  const registry = new ProviderRegistry({ catalog: new DefaultModelCatalog() });
  const calls = { n: 0, credential: undefined as unknown };
  const factory: ProviderFactory<DecisionProvider> = {
    id: "acme",
    kind: "decision",
    credentialType: "http.bearer",
    create: ({ credential }) => {
      calls.credential = credential;
      const d = (): DecisionProvider["decideBoolean"] => () => {
        const p = pYes[Math.min(calls.n, pYes.length - 1)] ?? 0.5;
        calls.n += 1;
        return Promise.resolve(
          booleanDecision(p, {
            provider: "acme",
            model: "acme-1",
            latencyMs: 5,
            costUsd: 0.003,
            usage: { inputTokens: 100, outputTokens: 0 },
          }),
        );
      };
      return {
        id: "acme",
        model: "acme-1",
        capabilities: {
          batch: false,
          maxQuestions: 1,
          maxStateTokens: 1000,
          kinds: ["boolean"],
          text: true,
          images: false,
        },
        decideBoolean: d(),
        decideChoice: () => Promise.reject(new Error("no")),
        decideScore: () => Promise.reject(new Error("no")),
        batch: () => Promise.reject(new Error("no")),
        health: () => ({
          status: "healthy",
          errorRate1m: 0,
          p95LatencyMs: 0,
          consecutiveFailures: 0,
          checkedAt: new Date().toISOString(),
        }),
      };
    },
  };
  registry.register(factory);
  return { registry, calls };
}

export const task = (
  id: string,
  type: string,
  config: Record<string, unknown>,
  inputs: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) => ({
  id,
  kind: "task",
  name: id,
  type,
  typeVersion: "1.0.0",
  config,
  inputs,
  ...extra,
});

export function definition(
  nodes: unknown[],
  edges: unknown[] = [],
  extra: Record<string, unknown> = {},
) {
  return {
    $schema: WORKFLOW_SCHEMA_URI,
    id: "00000000-0000-4000-8000-0000000000d2",
    name: "local test",
    inputs: { type: "object", properties: { x: { type: "number" } }, required: ["x"] },
    outputs: {},
    nodes,
    edges,
    ...extra,
  } as never;
}
