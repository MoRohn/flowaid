/**
 * Node definitions whose manifests must equal `workflow-core/fixtures/manifests/*.json` (P1-03 gate).
 * They describe the manifests only: the real executors live in `@flowaid/nodes-core` (P2-04), so
 * `execute` here reports that plainly instead of pretending to work.
 */
import { z } from "zod";
import { DecisionResultJsonSchema, NodeExecutionError } from "@flowaid/workflow-core";
import { defineNode } from "../define.js";
import type { AnyNodeDefinition } from "../types.js";

const execute = () =>
  Promise.resolve({
    kind: "error" as const,
    error: new NodeExecutionError(
      "manifest fixture: the executor ships in @flowaid/nodes-core",
      false,
    ),
  });

const state = z
  .union([z.string(), z.record(z.string(), z.unknown()), z.array(z.string())])
  .describe("TypeSafe state: text, an object (sent verbatim) or an array of text.");

const instructions = (help?: string) =>
  z
    .string()
    .min(1)
    .max(4000)
    .meta({ "x-ui": help ? { widget: "textarea", help } : { widget: "textarea" } });

export const booleanNode = defineNode({
  id: "flowaid.decision.boolean",
  version: "1.0.0",
  metadata: {
    name: "Boolean",
    description:
      "Answers a yes/no question about `state` with `pYes` and `confidence = max(pYes, 1 - pYes)` (TypeSafe boolean decision).",
    category: "decision",
    icon: "toggle-left",
    tags: ["decision", "typesafe"],
    summary: "{{ config.instructions }}",
  },
  configSchema: z.strictObject({
    instructions: instructions(),
    criteria: z
      .strictObject({ true: z.string(), false: z.string() })
      .optional()
      .meta({
        "x-ui": {
          widget: "criteria",
          help: "Optional descriptions of what makes the answer true or false (both or none).",
        },
      }),
  }),
  inputSchema: z.object({ state }),
  outputSchema: z.object({
    decision: z.unknown().meta({ "x-jsonSchema": DecisionResultJsonSchema.boolean }),
  }),
  credentials: [{ name: "typesafe", types: ["typesafe.api_key"], required: true }],
  capabilities: ["decision", "credentials"],
  idempotency: "safe",
  decision: { kind: "boolean" },
  defaultPolicy: { timeoutMs: 30000 },
  execute,
});

export const choiceNode = defineNode({
  id: "flowaid.decision.choice",
  version: "1.0.0",
  metadata: {
    name: "Choice",
    description:
      "Classifies `state` into one of the configured options and returns a probability per option (TypeSafe choice decision). Every option id is also a control-out port.",
    category: "decision",
    icon: "list-checks",
    tags: ["decision", "typesafe", "classification"],
    summary: "{{ config.instructions }}",
  },
  configSchema: z.strictObject({
    instructions: instructions("The question the model answers about `state`."),
    options: z.record(z.string().regex(/^[a-z0-9_]{1,64}$/), z.string()).meta({
      "x-ui": {
        widget: "keyvalue",
        help: "Option id → description. Each id becomes a control-out port.",
      },
      minProperties: 2,
      maxProperties: 255,
    }),
  }),
  inputSchema: z.object({
    state: state.meta({ "x-port": { description: "What the decision is about." } }),
  }),
  outputSchema: z.object({
    decision: z.unknown().meta({
      "x-jsonSchema": DecisionResultJsonSchema.choice,
      "x-port": { description: "The full DecisionResult (kind = choice)." },
    }),
  }),
  portRules: [{ kind: "controlPortsFromConfig", path: "/options" }],
  credentials: [
    {
      name: "typesafe",
      types: ["typesafe.api_key"],
      required: true,
      description: "TypeSafe API key used by the primary hop.",
    },
  ],
  capabilities: ["decision", "credentials"],
  idempotency: "safe",
  decision: { kind: "choice" },
  defaultPolicy: { timeoutMs: 30000 },
  execute,
});

const gateDecision = z.unknown().meta({
  "x-jsonSchema": {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["boolean", "choice", "score"] },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
    required: ["kind", "value", "confidence"],
  },
});

export const confidenceGateNode = defineNode({
  id: "flowaid.decision.confidence_gate",
  version: "1.0.0",
  metadata: {
    name: "Confidence gate",
    description:
      "Routes a decision by confidence: `pass` when it reaches `threshold` (and, with `requireValue`, a boolean value is true); otherwise `review` — or, with `reviewBand`, `review` only inside `[threshold − reviewBand, threshold)` and `fail` below it. Passes the decision through and reports `passed` and `outcome`.",
    category: "safety",
    icon: "shield-check",
    tags: ["decision", "safety", "routing"],
    summary: "threshold {{ config.threshold }}",
  },
  configSchema: z
    .strictObject({
      threshold: z
        .number()
        .min(0)
        .max(1)
        .meta({ "x-ui": { widget: "slider", bindable: true, min: 0, max: 1, step: 0.01 } }),
      requireValue: z
        .boolean()
        .default(false)
        .meta({
          "x-ui": {
            widget: "switch",
            help: "Also require a boolean decision value of true to pass.",
          },
        }),
      reviewBand: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .meta({
          "x-ui": {
            widget: "slider",
            min: 0,
            max: 1,
            step: 0.01,
            help: "Optional. Width of the review band below the threshold: confidences in [threshold − reviewBand, threshold) go to review, lower ones to fail. Unset, the gate is two-way (pass/review).",
          },
        }),
    })
    .describe(
      "`pass` iff `confidence ≥ threshold` and (`requireValue` is false or the decision is boolean with `value === true`); otherwise `fail` iff `reviewBand` is set and `confidence < threshold − reviewBand`; otherwise `review`. Without `reviewBand` the gate is two-way (`pass`/`review`, as in §2.9); with it the band `[threshold − reviewBand, threshold)` goes to review and everything below to `fail`; a `requireValue` failure routes `fail` when `reviewBand` is set, else `review`. The UI's two-threshold model maps onto this as `auto := threshold`, `review := threshold − (reviewBand ?? threshold)`, with outcome names `pass | review | fail`.",
    ),
  inputSchema: z.object({ decision: gateDecision }),
  outputSchema: z.object({
    decision: gateDecision.meta({ "x-port": { description: "The input decision, unchanged." } }),
    passed: z.boolean().meta({ "x-port": { description: "`true` iff `outcome` is `pass`." } }),
    outcome: z.enum(["pass", "review", "fail"]).meta({
      "x-port": {
        description:
          "The control port the gate fired: `pass`, `review` or `fail` (§6.3 gate semantics).",
      },
    }),
  }),
  controlPorts: [
    {
      name: "pass",
      label: "Pass",
      description: "confidence ≥ threshold (and, with requireValue, a boolean value of true).",
    },
    {
      name: "review",
      label: "Needs review",
      description:
        "Below threshold; with reviewBand only within [threshold − reviewBand, threshold).",
    },
    {
      name: "fail",
      label: "Fail",
      description:
        "Only with reviewBand: confidence < threshold − reviewBand, or a requireValue failure.",
    },
  ],
  capabilities: [],
  idempotency: "safe",
  decision: { kind: "gate" },
  execute,
});

const usage = z.object({ inputTokens: z.int().min(0), outputTokens: z.int().min(0) });

export const generateNode = defineNode({
  id: "flowaid.ai.generate",
  version: "1.0.0",
  metadata: {
    name: "Generate text",
    description:
      "Generates text from a prompt with a chat model; streams deltas when `stream` is on.",
    category: "generation",
    icon: "sparkles",
    tags: ["llm", "generation"],
    summary: "{{ config.model.provider }}/{{ config.model.model }}",
  },
  configSchema: z.strictObject({
    model: z
      .looseObject({ provider: z.string().min(1), model: z.string().min(1) })
      .meta({ "x-ui": { widget: "model" } }),
    system: z
      .string()
      .max(32000)
      .optional()
      .meta({ "x-ui": { widget: "template" } }),
    temperature: z.number().min(0).max(2).default(1),
    maxOutputTokens: z.int().min(1).max(65536).default(1024),
    stream: z.boolean().default(true),
  }),
  inputSchema: z.object({ prompt: z.string() }),
  outputSchema: z.object({ text: z.string(), finish_reason: z.string(), usage: usage.loose() }),
  credentials: [
    { name: "llm", types: ["openai.api_key", "anthropic.api_key", "ollama.none"], required: true },
  ],
  capabilities: ["generation", "credentials", "streaming"],
  idempotency: "safe",
  generation: true,
  streams: true,
  optionProviders: { models: () => Promise.resolve([]) },
  defaultPolicy: { timeoutMs: 120000 },
  execute,
});

export const httpNode = defineNode({
  id: "flowaid.tools.http",
  version: "1.0.0",
  metadata: {
    name: "HTTP request",
    description:
      "Calls an HTTP endpoint through the safe fetch (private-network, redirect and size limits) and returns status, headers and the parsed body.",
    category: "tool",
    icon: "globe",
    tags: ["http", "tool", "network"],
    summary: "{{ config.method }} {{ config.url }}",
  },
  configSchema: z.strictObject({
    method: z
      .enum(["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"])
      .meta({ default: "GET", "x-ui": { widget: "select" } }),
    url: z
      .string()
      .min(1)
      .meta({
        "x-ui": { widget: "template", placeholder: "https://api.example.com/items/{{ start.id }}" },
      }),
    headers: z
      .record(z.string(), z.string())
      .default({})
      .meta({ "x-ui": { widget: "keyvalue" } }),
    query: z
      .record(z.string(), z.string())
      .default({})
      .meta({ "x-ui": { widget: "keyvalue" } }),
    body: z
      .unknown()
      .optional()
      .meta({
        "x-ui": {
          widget: "json",
          showWhen: { path: "/method", oneOf: ["POST", "PUT", "PATCH"] },
          bindable: true,
        },
      }),
    responseType: z.enum(["json", "text", "binary"]).default("json"),
    timeoutMs: z.int().min(1).max(120000).default(30000),
  }),
  inputSchema: z.object({}),
  outputSchema: z.object({
    status: z.int().min(100).max(599),
    headers: z.record(z.string(), z.string()),
    body: z
      .unknown()
      .optional()
      .meta({
        "x-port": {
          description:
            'Parsed JSON or text; { "$artifact": id } for binary responses; null for empty bodies.',
        },
      }),
  }),
  credentials: [
    {
      name: "auth",
      types: ["http.bearer", "http.basic", "http.header", "http.api_key"],
      required: false,
      description: "Applied as Authorization or a custom header.",
    },
  ],
  capabilities: ["network", "credentials", "artifacts"],
  idempotency: {
    byConfig: "/method",
    cases: {
      GET: "safe",
      HEAD: "safe",
      OPTIONS: "safe",
      PUT: "keyed",
      DELETE: "keyed",
      POST: "none",
      PATCH: "none",
    },
    default: "none",
  },
  defaultPolicy: { timeoutMs: 30000 },
  execute,
});

export const FIXTURE_NODES: AnyNodeDefinition[] = [
  booleanNode,
  choiceNode,
  confidenceGateNode,
  generateNode,
  httpNode,
] as AnyNodeDefinition[];
