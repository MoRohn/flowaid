/**
 * The AI workflow builder (UPGRADE_PLAN P6-02): a prompt becomes a `WorkflowDefinition` by
 * structured generation against a compact JSON Schema of the definition, with the allowed node
 * manifests in the system prompt. The compiler checks every attempt; its errors go back to the
 * model, at most `maxRepairs` times, until nothing is an error. Nothing is saved here: the caller
 * shows the result and stores it only when a person accepts it.
 */
import { z } from "zod";
import {
  WORKFLOW_SCHEMA_URI,
  WorkflowDefinitionSchema,
  type ChatMessage,
  type CompileResult,
  type Diagnostic,
  type GenerationRequest,
  type GenerationResult,
  type JsonSchema,
  type NodeManifest,
  type WorkflowDefinition,
} from "@flowaid/workflow-core";

export interface GenerateWorkflowInput {
  prompt: string;
  /** refine an existing workflow instead of starting from nothing */
  baseDefinition?: WorkflowDefinition;
  /** the node types the model may use (already filtered by the caller) */
  manifests: readonly NodeManifest[];
  generate: (req: GenerationRequest) => Promise<GenerationResult>;
  compile: (definition: unknown) => CompileResult;
  /** whether the model accepts `responseFormat: json_schema` */
  jsonSchema: boolean;
  /** id for a new definition */
  newId: () => string;
  /** repair rounds after the first attempt (default 3) */
  maxRepairs?: number;
}

export interface GeneratedWorkflow {
  /** null when no attempt produced a definition that parses */
  definition: WorkflowDefinition | null;
  diagnostics: Diagnostic[];
  rationale: string;
  /** generation calls made (1 + repairs) */
  iterations: number;
  usage: { inputTokens: number; outputTokens: number };
  costUsd: number;
}

let schemaCache: JsonSchema | null = null;

/** The definition's JSON Schema without descriptions, defaults or layout (what the model fills in). */
export function compactDefinitionSchema(): JsonSchema {
  if (schemaCache) return schemaCache;
  const full = z.toJSONSchema(WorkflowDefinitionSchema, {
    io: "input",
    unrepresentable: "any",
  }) as Record<string, unknown>;
  // annotations go; keys of `properties` / `$defs` maps are names, not annotations, and stay
  const strip = (v: unknown, names = false): unknown => {
    if (Array.isArray(v)) return v.map((x) => strip(x));
    if (v === null || typeof v !== "object") return v;
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      if (
        !names &&
        (k === "description" || k === "default" || (k === "$schema" && typeof val === "string"))
      )
        continue;
      out[k] = strip(val, !names && (k === "properties" || k === "$defs" || k === "definitions"));
    }
    return out;
  };
  const compact = strip(full) as { properties?: Record<string, unknown> };
  delete compact.properties?.layout;
  schemaCache = compact as JsonSchema;
  return schemaCache;
}

function compactProperties(schema: JsonSchema): Record<string, unknown> {
  const s = schema as {
    properties?: Record<string, { type?: unknown; enum?: unknown }>;
    required?: string[];
  };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s.properties ?? {}))
    out[k] = v.enum ? { enum: v.enum } : (v.type ?? "any");
  return { fields: out, required: s.required ?? [] };
}

/** One line per node type the model may use. */
export function catalogForPrompt(manifests: readonly NodeManifest[]): unknown[] {
  return manifests.map((m) => ({
    type: m.id,
    version: m.version,
    name: m.metadata.name,
    category: m.metadata.category,
    about: m.metadata.description.slice(0, 200),
    config: compactProperties(m.configSchema),
    inputs: m.inputs.map((p) => `${p.name}${p.required ? "" : "?"}`),
    outputs: m.outputs.map((p) => p.name),
    controlPorts: m.controlPorts.length ? m.controlPorts.map((c) => c.name) : ["done"],
    credentials: m.credentials.map((c) => ({ slot: c.name, types: c.types, required: c.required })),
  }));
}

const EXAMPLE = {
  $schema: WORKFLOW_SCHEMA_URI,
  id: "00000000-0000-4000-8000-000000000000",
  name: "Refund triage",
  inputs: { type: "object", required: ["message"], properties: { message: { type: "string" } } },
  outputs: { type: "object", properties: { refund: { type: "boolean" } } },
  secrets: [{ name: "TYPESAFE_API_KEY", credentialType: "typesafe.api_key" }],
  nodes: [
    { id: "ticket", kind: "input", name: "Ticket" },
    {
      id: "is_refund",
      kind: "task",
      name: "Refund request?",
      type: "flowaid.decision.boolean",
      typeVersion: "1.0.0",
      config: { instructions: "Is the customer asking for their money back?" },
      inputs: {
        state: {
          kind: "object",
          fields: {
            message: { kind: "ref", ref: { kind: "port", node: "ticket", port: "message" } },
          },
        },
      },
      credentials: { typesafe: "TYPESAFE_API_KEY" },
    },
    {
      id: "done",
      kind: "output",
      name: "Result",
      value: {
        kind: "object",
        fields: { refund: { kind: "expr", source: "is_refund.decision.value" } },
      },
    },
  ],
  edges: [
    { id: "e1", from: { node: "ticket", port: "done" }, to: { node: "is_refund" } },
    { id: "e2", from: { node: "is_refund", port: "done" }, to: { node: "done" } },
  ],
};

export function systemPrompt(manifests: readonly NodeManifest[]): string {
  return [
    "You design FlowAId workflows. A workflow is a JSON document: typed nodes, data bindings and control edges.",
    "Rules:",
    "- Exactly one node of kind `input`; its output ports are the properties of `inputs` (an object JSON Schema). At least one `output` node whose `value` matches `outputs`.",
    "- Data flows only through bindings: {kind:'ref', ref:{kind:'port', node, port, path?}}, {kind:'template', source:'Hello {{ ticket.message }}'}, {kind:'expr', source:'is_refund.decision.value'}, {kind:'literal', value}, {kind:'object', fields}, {kind:'array', items}.",
    "- Control flows only along `edges` {id, from:{node, port}, to:{node}}. Most nodes fire the control port `done`; `branch` nodes fire their case ports and `defaultPort`; `human` approvals fire `approved` or `rejected`.",
    "- Node ids are snake_case and unique. A `task` node names its `type` and `typeVersion` from the catalog below and fills `config` and `inputs` for that type.",
    "- Decisions (yes/no, one of several options, a score) use the flowaid.decision.* types: TypeSafe answers them with calibrated probabilities. Use generation only to write text.",
    "- Put a `human` approval or a `flowaid.decision.confidence_gate` before any irreversible action taken on a model's answer.",
    "- Every credential slot a task needs maps to a secret name declared in `secrets` with a matching `credentialType`.",
    "- Set `execution.maxCostUsd` to a sensible bound when the workflow calls models.",
    "Node types you may use:",
    JSON.stringify(catalogForPrompt(manifests)),
    "A small valid example:",
    JSON.stringify(EXAMPLE),
    'Answer with one JSON object: {"rationale": "why the workflow is shaped this way, in two or three sentences", "definition": <the workflow>}.',
  ].join("\n");
}

function parseResponse(
  result: GenerationResult,
): { rationale: string; definition: unknown } | null {
  let value: unknown = result.structured;
  if (value === undefined) {
    const text = result.text.replace(/^```(?:json)?\s*/m, "").replace(/```\s*$/m, "");
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      value = JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  if (value === null || typeof value !== "object") return null;
  const v = value as { rationale?: unknown; definition?: unknown };
  if (v.definition === undefined) return { rationale: "", definition: value };
  return {
    rationale: typeof v.rationale === "string" ? v.rationale : "",
    definition: v.definition,
  };
}

function describe(d: Diagnostic): string {
  const where = [
    d.location.nodeId && `node ${d.location.nodeId}`,
    d.location.path && `at ${d.location.path}`,
  ]
    .filter(Boolean)
    .join(" ");
  return `- ${d.code}${where ? ` (${where})` : ""}: ${d.message}`;
}

const errorsOf = (diagnostics: readonly Diagnostic[]) =>
  diagnostics.filter((d) => d.severity === "error");

export async function generateWorkflow(input: GenerateWorkflowInput): Promise<GeneratedWorkflow> {
  const maxRepairs = input.maxRepairs ?? 3;
  const id = input.baseDefinition?.id ?? input.newId();
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(input.manifests) },
    {
      role: "user",
      content: input.baseDefinition
        ? `Change this workflow as follows: ${input.prompt}\n\nThe current workflow:\n${JSON.stringify(input.baseDefinition)}`
        : input.prompt,
    },
  ];
  const responseFormat = input.jsonSchema
    ? ({
        type: "json_schema",
        strict: false,
        schema: {
          type: "object",
          required: ["rationale", "definition"],
          properties: { rationale: { type: "string" }, definition: compactDefinitionSchema() },
        } as unknown as JsonSchema,
      } as const)
    : undefined;
  const usage = { inputTokens: 0, outputTokens: 0 };
  let costUsd = 0;
  let best: GeneratedWorkflow = {
    definition: null,
    diagnostics: [],
    rationale: "",
    iterations: 0,
    usage,
    costUsd: 0,
  };
  for (let attempt = 0; attempt <= maxRepairs; attempt++) {
    const result = await input.generate({
      messages,
      temperature: 0.2,
      maxOutputTokens: 16_000,
      ...(responseFormat ? { responseFormat } : {}),
    });
    usage.inputTokens += result.usage.inputTokens;
    usage.outputTokens += result.usage.outputTokens;
    costUsd += result.costUsd;
    const parsed = parseResponse(result);
    let diagnostics: Diagnostic[];
    let definition: WorkflowDefinition | null = null;
    if (!parsed) {
      diagnostics = [
        {
          code: "E_SCHEMA",
          severity: "error",
          message: "The answer was not a JSON object with `rationale` and `definition`.",
          location: {},
        },
      ];
    } else {
      const doc = {
        ...(parsed.definition as Record<string, unknown>),
        $schema: WORKFLOW_SCHEMA_URI,
        id,
      };
      diagnostics = input.compile(doc).diagnostics;
      const schema = WorkflowDefinitionSchema.safeParse(doc);
      if (schema.success) definition = schema.data;
    }
    const current: GeneratedWorkflow = {
      definition,
      diagnostics,
      rationale: parsed?.rationale ?? best.rationale,
      iterations: attempt + 1,
      usage,
      costUsd,
    };
    if (
      definition &&
      (!best.definition || errorsOf(diagnostics).length <= errorsOf(best.diagnostics).length)
    )
      best = current;
    else best = { ...best, iterations: attempt + 1, costUsd };
    if (definition && errorsOf(diagnostics).length === 0) return current;
    if (attempt === maxRepairs) break;
    messages.push(
      { role: "assistant", content: result.text || JSON.stringify(result.structured ?? {}) },
      {
        role: "user",
        content: `The compiler rejected that workflow:\n${errorsOf(diagnostics).map(describe).join("\n")}\nFix every error and answer with the complete corrected JSON object.`,
      },
    );
  }
  return { ...best, usage, costUsd };
}
