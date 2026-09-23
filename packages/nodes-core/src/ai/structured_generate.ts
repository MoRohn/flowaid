import { z } from "zod";
import { defineNode, ok } from "@flowaid/node-sdk";
import { SchemaValidationError, type JsonSchema, type JsonValue } from "@flowaid/workflow-core";
import { validateJson } from "../jsonSchema.js";
import { callCtx, modelRef, usageSchema } from "../common.js";
import { messagesFor } from "./generate.js";

/** Pulls the first JSON value out of model text (bare JSON or a fenced block). */
export function extractJson(text: string): JsonValue | undefined {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidates = [
    fenced?.[1],
    text,
    text.slice(Math.max(0, text.indexOf("{")), text.lastIndexOf("}") + 1),
  ];
  for (const c of candidates) {
    if (!c?.trim()) continue;
    try {
      return JSON.parse(c) as JsonValue;
    } catch {
      /* next */
    }
  }
  return undefined;
}

export const structuredGenerateNode = defineNode({
  id: "flowaid.ai.structured_generate",
  version: "1.0.0",
  metadata: {
    name: "Structured generation",
    description:
      "Asks a chat model for a JSON answer that matches `schema` (native structured output where the provider supports it, validated either way).",
    category: "generation",
    icon: "braces",
    tags: ["ai", "generation", "json"],
    summary: "{{ config.model.provider }}/{{ config.model.model }}",
  },
  configSchema: z.strictObject({
    model: modelRef,
    system: z
      .string()
      .max(32000)
      .optional()
      .meta({ "x-ui": { widget: "template" } }),
    temperature: z.number().min(0).max(2).default(1),
    maxOutputTokens: z.int().min(1).max(65536).default(1024),
    schema: z.record(z.string(), z.unknown()).meta({
      "x-ui": {
        widget: "schema",
        help: "JSON Schema the model's answer must match; it types the `structured` output.",
      },
    }),
  }),
  inputSchema: z.object({ prompt: z.string() }),
  outputSchema: z.object({
    structured: z.record(z.string(), z.unknown()),
    usage: usageSchema.loose(),
  }),
  portRules: [{ kind: "outputSchemaFromConfig", port: "structured", path: "/schema" }],
  credentials: [
    { name: "llm", types: ["openai.api_key", "anthropic.api_key", "ollama.none"], required: true },
  ],
  capabilities: ["generation", "credentials"],
  idempotency: "safe",
  generation: true,
  optionProviders: { models: () => Promise.resolve([]) },
  defaultPolicy: { timeoutMs: 120000 },
  execute: async (ctx, input) => {
    const schema = ctx.config.schema as JsonSchema;
    const provider = ctx.providers.generation(ctx.config.model, {
      credentialSlot: "llm",
    });
    const native = provider.capabilities.jsonSchema;
    const system = [
      ctx.config.system,
      native
        ? undefined
        : `Answer with JSON only, matching this JSON Schema:\n${JSON.stringify(schema)}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    const r = await provider.generate(
      {
        messages: messagesFor(system || undefined, input.prompt),
        temperature: ctx.config.temperature,
        maxOutputTokens: ctx.config.maxOutputTokens,
        ...(native
          ? { responseFormat: { type: "json_schema" as const, schema, strict: true } }
          : {}),
      },
      callCtx(ctx),
    );
    const structured = r.structured ?? extractJson(r.text);
    if (structured === undefined)
      throw new SchemaValidationError("the model did not return JSON", [
        { path: "", message: "no JSON value in the answer" },
      ]);
    const check = validateJson(schema, structured);
    if (!check.ok)
      throw new SchemaValidationError("the model's answer does not match the schema", check.errors);
    return ok(
      { structured: structured as Record<string, unknown>, usage: r.usage },
      { usage: r.usage, costUsd: r.costUsd },
    );
  },
});
