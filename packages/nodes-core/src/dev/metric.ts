import { z } from "zod";
import { defineNode, ok } from "@flowaid/node-sdk";
import { BadRequestError, type JsonValue } from "@flowaid/workflow-core";

export const metricNode = defineNode({
  id: "flowaid.dev.metric",
  version: "1.0.0",
  metadata: {
    name: "Metric",
    description:
      "Records a numeric metric (name, value, labels) on the run timeline and the metrics pipeline, then passes the input through.",
    category: "developer",
    icon: "chart-line",
    tags: ["developer", "observability", "metric"],
    summary: "{{ config.name }}",
  },
  configSchema: z.strictObject({
    name: z.string().regex(/^[a-z][a-z0-9_.]{0,127}$/),
    labels: z
      .record(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), z.string().max(256))
      .default({})
      .meta({ "x-ui": { widget: "keyvalue" } }),
  }),
  inputSchema: z.object({ value: z.number(), passthrough: z.unknown().optional() }),
  outputSchema: z.object({ value: z.number(), passthrough: z.unknown() }),
  capabilities: [],
  idempotency: "safe",
  defaultPolicy: { timeoutMs: 5000 },
  execute: (ctx, input) => {
    if (!Number.isFinite(input.value))
      throw new BadRequestError(`metric ${ctx.config.name} needs a finite number`);
    ctx.events.emit({
      type: "METRIC",
      name: ctx.config.name,
      value: input.value,
      labels: ctx.config.labels,
    });
    return Promise.resolve(
      ok({ value: input.value, passthrough: (input.passthrough ?? null) as JsonValue }),
    );
  },
});
