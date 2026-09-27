import { z } from "zod";
import { defineNode, ok } from "@flowaid/node-sdk";
import type { JsonValue } from "@flowaid/workflow-core";

export const traceNode = defineNode({
  id: "flowaid.dev.trace",
  version: "1.0.0",
  metadata: {
    name: "Trace marker",
    description:
      "Puts a named marker on the run timeline (a log line and a `trace.marker` metric with the name as a label), with optional attributes, and passes the value through.",
    category: "developer",
    icon: "milestone",
    tags: ["developer", "trace", "observability"],
    summary: "{{ config.name }}",
  },
  configSchema: z.strictObject({
    name: z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/),
    attributes: z
      .record(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), z.string().max(256))
      .default({})
      .meta({ "x-ui": { widget: "keyvalue", help: "Templated values are rendered per run." } }),
  }),
  inputSchema: z.object({ value: z.unknown().optional() }),
  outputSchema: z.object({ value: z.unknown(), at: z.string() }),
  capabilities: [],
  idempotency: "safe",
  defaultPolicy: { timeoutMs: 5000 },
  execute: (ctx, input) => {
    const at = ctx.clock.now().toISOString();
    ctx.logger.info(`trace: ${ctx.config.name}`, {
      marker: ctx.config.name,
      at,
      ...ctx.config.attributes,
    });
    ctx.events.emit({
      type: "METRIC",
      name: "trace.marker",
      value: 1,
      labels: { marker: ctx.config.name, ...ctx.config.attributes },
    });
    return Promise.resolve(ok({ value: (input.value ?? null) as JsonValue, at }));
  },
});
