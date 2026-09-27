import { z } from "zod";
import { defineNode, ok } from "@flowaid/node-sdk";
import type { JsonObject, JsonValue } from "@flowaid/workflow-core";
import { casUpdate } from "../state/cas.js";

export interface Bucket {
  tokens: number;
  at: number;
}

/** Token bucket: refill since `at`, then take `cost` when available. */
export function takeTokens(
  bucket: Bucket | null,
  now: number,
  capacity: number,
  refillPerMs: number,
  cost: number,
): { allowed: boolean; bucket: Bucket; retryAfterMs: number } {
  const start = bucket ?? { tokens: capacity, at: now };
  const tokens = Math.min(capacity, start.tokens + Math.max(0, now - start.at) * refillPerMs);
  if (tokens >= cost)
    return { allowed: true, bucket: { tokens: tokens - cost, at: now }, retryAfterMs: 0 };
  return {
    allowed: false,
    bucket: { tokens, at: now },
    retryAfterMs:
      refillPerMs > 0 ? Math.ceil((cost - tokens) / refillPerMs) : Number.MAX_SAFE_INTEGER,
  };
}

export const rateLimitNode = defineNode({
  id: "flowaid.safety.rate_limit",
  version: "1.0.0",
  metadata: {
    name: "Rate limit",
    description:
      "A token bucket kept in workspace state and keyed by a template (per user, per customer, per workflow…): fires `pass` while the budget allows, `limited` otherwise.",
    category: "safety",
    icon: "gauge",
    tags: ["safety", "rate limit", "quota"],
    summary: "{{ config.limit }} / {{ config.windowMs }} ms",
  },
  configSchema: z.strictObject({
    key: z
      .string()
      .min(1)
      .max(200)
      .meta({
        "x-ui": {
          widget: "template",
          help: "Who the limit applies to, e.g. customer:{{ ticket.customer_id }}.",
        },
      }),
    limit: z.int().min(1).max(1_000_000),
    windowMs: z.int().min(1000).max(31_536_000_000).default(60_000),
    burst: z
      .int()
      .min(1)
      .max(1_000_000)
      .optional()
      .meta({ "x-ui": { help: "Bucket size; defaults to the limit." } }),
    cost: z.int().min(1).max(1000).default(1),
    scope: z
      .enum(["workspace", "session", "run"])
      .default("workspace")
      .meta({ "x-ui": { widget: "select" } }),
  }),
  inputSchema: z.object({ value: z.unknown().optional() }),
  outputSchema: z.object({
    allowed: z.boolean(),
    remaining: z.number().min(0),
    retry_after_ms: z.int().min(0),
    value: z.unknown(),
  }),
  controlPorts: [
    { name: "pass", label: "Pass", description: "Within the limit; the cost was taken." },
    { name: "limited", label: "Limited", description: "Over the limit; nothing was taken." },
  ],
  capabilities: ["state"],
  // every pass consumes budget; a retry would consume it twice
  idempotency: "keyed",
  defaultPolicy: { timeoutMs: 10000 },
  execute: async (ctx, input) => {
    const { limit, windowMs, cost, scope } = ctx.config;
    const capacity = ctx.config.burst ?? limit;
    const refillPerMs = limit / windowMs;
    const now = ctx.clock.now().getTime();
    const key = ctx.node.idempotencyKey;
    let outcome = { allowed: false, bucket: { tokens: 0, at: now }, retryAfterMs: 0 };
    await casUpdate(ctx, scope, `ratelimit:${ctx.config.key}`, (current) => {
      const data = current?.data as
        | { tokens?: number; at?: number; lastKey?: string; lastAllowed?: boolean }
        | null
        | undefined;
      const bucket =
        data && typeof data.tokens === "number" && typeof data.at === "number"
          ? { tokens: data.tokens, at: data.at }
          : null;
      // A retry of the same node run (same idempotency key) repeats its answer without paying again.
      if (key && bucket && data?.lastKey === key) {
        outcome = { allowed: data.lastAllowed === true, bucket, retryAfterMs: 0 };
        return undefined;
      }
      outcome = takeTokens(bucket, now, capacity, refillPerMs, cost);
      const next: JsonObject = { tokens: outcome.bucket.tokens, at: outcome.bucket.at };
      if (key) {
        next.lastKey = key;
        next.lastAllowed = outcome.allowed;
      }
      return next;
    });
    return ok(
      {
        allowed: outcome.allowed,
        remaining: Math.floor(outcome.bucket.tokens),
        retry_after_ms:
          outcome.retryAfterMs === Number.MAX_SAFE_INTEGER ? windowMs : outcome.retryAfterMs,
        value: (input.value ?? null) as JsonValue,
      },
      { route: outcome.allowed ? "pass" : "limited" },
    );
  },
});
