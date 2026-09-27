/**
 * `langchain.runnable`: executes an LCEL runnable registered by a plugin (`registerRunnable`) with a
 * typed input (`inputSchemaFromConfig`) and a typed output (`outputSchemaFromConfig`, checked at
 * run time). The factory receives the node's chat model and embeddings (bound to
 * `ctx.providers`), the selected workflow tools as LangChain tools, and the node's signal; the
 * callback handler records every inner model, tool and retriever call and enforces the bounds.
 */
import { z } from "zod";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { listRunnables, runnableFromRegistry, toLangChainTool } from "@flowaid/langchain";
import { defineNode, ok } from "@flowaid/node-sdk";
import { OutputSchemaMismatchError, type JsonObject, type JsonValue } from "@flowaid/workflow-core";
import {
  Spend,
  chatModelFor,
  combined,
  embeddingsFor,
  handlerFor,
  modelRef,
  nodeId,
  rethrow,
} from "../common.js";
import { describeIssues, validateJson } from "../jsonSchema.js";

export const runnableNode = defineNode({
  id: nodeId("runnable"),
  version: "1.0.0",
  metadata: {
    name: "LangChain runnable",
    description:
      "Runs a registered LangChain (LCEL) runnable by name with a typed input and output. Inner model, tool and retriever calls appear in the trace and count against the node's bounds.",
    category: "generation",
    icon: "workflow",
    tags: ["langchain", "lcel", "chain"],
    summary: "{{ config.runnable }}",
  },
  configSchema: z.strictObject({
    runnable: z
      .string()
      .regex(/^[a-z0-9][a-z0-9_.-]{0,127}$/)
      .meta({ "x-ui": { widget: "select", optionsProvider: "runnables" } }),
    params: z
      .record(z.string(), z.unknown())
      .default({})
      .meta({ "x-ui": { widget: "keyvalue", help: "Passed to the runnable's factory." } }),
    model: modelRef.optional(),
    embeddingModel: modelRef.optional(),
    tools: z
      .array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/))
      .max(32)
      .default([])
      .meta({ "x-ui": { widget: "list", help: "Workflow tools handed to the runnable." } }),
    inputSchema: z
      .record(z.string(), z.unknown())
      .optional()
      .meta({
        "x-ui": { widget: "schema", help: "JSON Schema of `input`; types the input port." },
      }),
    outputSchema: z
      .record(z.string(), z.unknown())
      .optional()
      .meta({
        "x-ui": { widget: "schema", help: "JSON Schema of `output`; checked at run time." },
      }),
    maxTokens: z.int().min(1).optional(),
    maxCostUsd: z.number().min(0).optional(),
    idempotent: z
      .boolean()
      .default(false)
      .meta({ "x-ui": { widget: "switch", help: "Declare the runnable free of side effects." } }),
  }),
  inputSchema: z.object({ input: z.unknown() }),
  outputSchema: z.object({ output: z.unknown() }),
  portRules: [
    { kind: "inputSchemaFromConfig", port: "input", path: "/inputSchema" },
    { kind: "outputSchemaFromConfig", port: "output", path: "/outputSchema" },
  ],
  credentials: [
    {
      name: "llm",
      types: ["openai.api_key", "anthropic.api_key", "ollama.host", "ollama.none"],
      required: false,
      description: "Credential of the configured chat/embedding model.",
    },
  ],
  capabilities: ["generation", "credentials", "streaming", "tools"],
  idempotency: { byConfig: "/idempotent", cases: { true: "safe", false: "none" }, default: "none" },
  generation: true,
  streams: true,
  optionProviders: {
    runnables: () =>
      Promise.resolve(
        listRunnables().map((r) => ({ value: r.name, label: r.name, description: r.description })),
      ),
  },
  defaultPolicy: { timeoutMs: 300_000 },
  execute: async (ctx, input) => {
    const c = ctx.config;
    const entry = runnableFromRegistry(c.runnable);
    const spend = new Spend();
    const handler = handlerFor(ctx, {
      ...(c.maxTokens !== undefined ? { maxTokens: c.maxTokens } : {}),
      ...(c.maxCostUsd !== undefined ? { maxCostUsd: c.maxCostUsd } : {}),
    });
    const signal = combined(ctx, handler);
    const defs = c.tools.length
      ? (await ctx.tools.list()).filter((t) => c.tools.includes(t.name))
      : [];
    const tools: StructuredToolInterface[] = defs.map((def) =>
      toLangChainTool(def, (args) => ctx.tools.call(def.source, def.name, args)),
    );
    const runnable = await entry.factory(c.params as JsonObject, {
      ...(c.model ? { chatModel: chatModelFor(ctx, c.model, { spend, handler, signal }) } : {}),
      ...(c.embeddingModel ? { embeddings: embeddingsFor(ctx, c.embeddingModel, { spend }) } : {}),
      tools,
      signal,
    });
    let output: unknown;
    try {
      output = await runnable.invoke(input.input, {
        callbacks: [handler],
        signal,
        runName: c.runnable,
      });
    } catch (error) {
      rethrow(handler, error);
    }
    const value = JSON.parse(JSON.stringify(output ?? null)) as JsonValue;
    if (c.outputSchema) {
      const check = validateJson(c.outputSchema, value);
      if (!check.ok)
        throw new OutputSchemaMismatchError(
          `runnable '${c.runnable}' returned output that does not match outputSchema: ${describeIssues(check.errors)}`,
        );
    }
    return ok({ output: value }, spend.extra);
  },
});
