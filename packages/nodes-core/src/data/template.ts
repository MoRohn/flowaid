import { z } from "zod";
import { defineNode, ok } from "@flowaid/node-sdk";

/** Renders a `{{ … }}` template (compiled and rendered by the runtime before execute). */
export const templateNode = defineNode({
  id: "flowaid.data.template",
  version: "1.0.0",
  metadata: {
    name: "Template",
    description:
      "Renders text from a template with `{{ node.port }}` holes and filters (`json`, `upper`, `trim`, …).",
    category: "data",
    icon: "text-cursor-input",
    tags: ["data", "text", "template"],
    summary: "{{ config.template }}",
  },
  configSchema: z.strictObject({
    template: z
      .string()
      .max(100000)
      .meta({ "x-ui": { widget: "template", placeholder: "Hello {{ start.name }}" } }),
  }),
  inputSchema: z.object({}),
  outputSchema: z.object({ text: z.string() }),
  capabilities: [],
  idempotency: "safe",
  defaultPolicy: { timeoutMs: 10000 },
  execute: (ctx) => Promise.resolve(ok({ text: ctx.config.template })),
});
