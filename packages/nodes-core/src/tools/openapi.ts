import { z } from "zod";
import { defineNode, ok } from "@flowaid/node-sdk";
import type { JsonValue } from "@flowaid/workflow-core";
import { expectOk } from "./toolResult.js";

export const openapiNode = defineNode({
  id: "flowaid.tools.openapi",
  version: "1.0.0",
  metadata: {
    name: "OpenAPI operation",
    description:
      "Calls one operation of an imported OpenAPI toolset. Inputs are the operation's `path`, `query`, `headers` and `body`; outputs its `status` and parsed `body`. Keyed operations send the node's Idempotency-Key.",
    category: "tool",
    icon: "webhook",
    tags: ["tool", "openapi", "http"],
    summary: "{{ config.operationId }}",
  },
  configSchema: z.strictObject({
    toolsetId: z
      .string()
      .min(1)
      .meta({ "x-ui": { widget: "select", optionsProvider: "openapiToolsets" } }),
    operationId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .meta({ "x-ui": { widget: "select", optionsProvider: "openapiOperations" } }),
    timeoutMs: z.int().min(1).max(120000).default(30000),
  }),
  inputSchema: z.looseObject({}),
  outputSchema: z.object({ status: z.int().min(100).max(599), body: z.unknown() }),
  portRules: [{ kind: "toolSignature", source: "openapi" }],
  credentials: [
    {
      name: "auth",
      types: [
        "http.bearer",
        "http.basic",
        "http.api_key",
        "http.header",
        "oauth2.client_credentials",
      ],
      required: false,
      description: "Applied according to the operation's security scheme.",
    },
  ],
  capabilities: ["network", "credentials", "tools"],
  idempotency: "none",
  optionProviders: {
    openapiToolsets: () => Promise.resolve([]),
    openapiOperations: () => Promise.resolve([]),
  },
  defaultPolicy: { timeoutMs: 30000 },
  execute: async (ctx, input) => {
    const { toolsetId, operationId, timeoutMs } = ctx.config;
    const r = expectOk(
      await ctx.tools.call(
        { kind: "openapi", toolsetId, operationId },
        operationId,
        input as JsonValue,
        { timeoutMs },
      ),
      operationId,
    );
    const s = (r.structured ?? {}) as { status?: number; body?: JsonValue };
    return ok({ status: s.status ?? 200, body: s.body ?? null });
  },
});
