/**
 * `langchain.output_parser`: turns model text into typed data with LangChain output parsers —
 * JSON (fenced or embedded, validated against `schema`), comma-separated list, line list, number
 * or boolean — with an optional repair loop in the spirit of `OutputFixingParser`: on a parse or
 * schema error a chat model rewrites the text given the error and the format instructions, up to
 * `maxRepairs` times.
 */
import { z } from "zod";
import {
  CommaSeparatedListOutputParser,
  JsonOutputParser,
  type BaseOutputParser,
} from "@langchain/core/output_parsers";
import { HumanMessage } from "@langchain/core/messages";
import { defineNode, ok } from "@flowaid/node-sdk";
import {
  BadRequestError,
  OutputSchemaMismatchError,
  type JsonSchema,
  type JsonValue,
} from "@flowaid/workflow-core";
import { Spend, chatModelFor, modelRef, nodeId } from "../common.js";
import { describeIssues, validateJson } from "../jsonSchema.js";

type ParserKind = "json" | "comma_list" | "line_list" | "number" | "boolean";

function instructions(kind: ParserKind, schema: JsonSchema | undefined): string {
  switch (kind) {
    case "json":
      return schema
        ? `Return one JSON value matching this JSON Schema, and nothing else:\n${JSON.stringify(schema)}`
        : "Return one valid JSON value, and nothing else.";
    case "comma_list":
      return new CommaSeparatedListOutputParser().getFormatInstructions();
    case "line_list":
      return "Return one item per line, nothing else.";
    case "number":
      return "Return a single number, nothing else.";
    case "boolean":
      return "Return exactly true or false, nothing else.";
  }
}

async function parse(
  kind: ParserKind,
  text: string,
  schema: JsonSchema | undefined,
): Promise<JsonValue> {
  let value: JsonValue;
  switch (kind) {
    case "json": {
      const parser: BaseOutputParser<unknown> = new JsonOutputParser();
      value = (await parser.parse(text)) as JsonValue;
      if (value === undefined || (value === null && !/null/.test(text)))
        throw new Error("no JSON value found in the text");
      break;
    }
    case "comma_list":
      value = await new CommaSeparatedListOutputParser().parse(text);
      break;
    case "line_list":
      value = text
        .split("\n")
        .map((l) => l.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim())
        .filter(Boolean);
      break;
    case "number": {
      const m = /-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/i.exec(text.replace(/,(?=\d{3})/g, ""));
      if (!m) throw new Error("no number found in the text");
      value = Number(m[0]);
      break;
    }
    case "boolean": {
      const t = text.trim().toLowerCase();
      if (/^(true|yes|y|1)\b/.test(t)) value = true;
      else if (/^(false|no|n|0)\b/.test(t)) value = false;
      else throw new Error("expected true or false");
      break;
    }
  }
  if (schema) {
    const check = validateJson(schema, value);
    if (!check.ok)
      throw new OutputSchemaMismatchError(
        `does not match the schema: ${describeIssues(check.errors)}`,
      );
  }
  return value;
}

export const outputParserNode = defineNode({
  id: nodeId("output_parser"),
  version: "1.0.0",
  metadata: {
    name: "Output parser",
    description:
      "Parses model text into JSON (validated against a schema), a list, a number or a boolean; optionally repairs unparseable text with a chat model.",
    category: "data",
    icon: "braces",
    tags: ["langchain", "parser", "json", "structured"],
    summary: "{{ config.parser }}",
  },
  configSchema: z.strictObject({
    parser: z
      .enum(["json", "comma_list", "line_list", "number", "boolean"])
      .default("json")
      .meta({ "x-ui": { widget: "select" } }),
    schema: z
      .record(z.string(), z.unknown())
      .optional()
      .meta({
        "x-ui": {
          widget: "schema",
          help: "JSON Schema the parsed value must match; types `output`.",
        },
      }),
    repair: z
      .boolean()
      .default(false)
      .meta({ "x-ui": { widget: "switch" } }),
    model: modelRef.optional().meta({
      "x-ui": { widget: "model", showWhen: { path: "/repair", truthy: true } },
    }),
    maxRepairs: z.int().min(1).max(3).default(1),
  }),
  inputSchema: z.object({ text: z.string() }),
  outputSchema: z.object({ output: z.unknown(), repaired: z.boolean() }),
  portRules: [{ kind: "outputSchemaFromConfig", port: "output", path: "/schema" }],
  credentials: [
    {
      name: "llm",
      types: ["openai.api_key", "anthropic.api_key", "ollama.host", "ollama.none"],
      required: false,
      description: "Chat model credential for the repair loop.",
    },
  ],
  capabilities: ["generation", "credentials"],
  idempotency: "safe",
  generation: true,
  execute: async (ctx, input) => {
    const c = ctx.config;
    const schema = c.schema;
    if (c.repair && !c.model) throw new BadRequestError("repair needs `model`");
    const spend = new Spend();
    let text = input.text;
    let lastError: unknown;
    for (let attempt = 0; attempt <= (c.repair ? c.maxRepairs : 0); attempt += 1) {
      try {
        const output = await parse(c.parser, text, schema);
        return ok({ output, repaired: attempt > 0 }, spend.extra);
      } catch (error) {
        lastError = error;
        if (!c.repair || !c.model || attempt === c.maxRepairs) break;
        const model = chatModelFor(ctx, c.model, { spend, settings: { temperature: 0 } });
        const fixed = await model.invoke([
          new HumanMessage(
            `The text below could not be parsed: ${error instanceof Error ? error.message : String(error)}\n\n${instructions(c.parser, schema)}\n\nText:\n${text}`,
          ),
        ]);
        text = fixed.text;
      }
    }
    if (lastError instanceof OutputSchemaMismatchError) throw lastError;
    throw new OutputSchemaMismatchError(
      `could not parse the text as ${c.parser}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
  },
});
