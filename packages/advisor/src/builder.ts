/**
 * The AI workflow builder (UPGRADE_PLAN P6-02): a prompt becomes a `WorkflowDefinition` by
 * structured generation against a compact JSON Schema of the definition, with the allowed node
 * manifests in the system prompt. The compiler checks every attempt, and so does the critic's
 * deterministic rubric: compiler errors and error-severity safety findings go back to the model,
 * at most `maxRepairs` times, until there are none. Nothing is saved here: the caller shows the
 * result and stores it only when a person accepts it.
 *
 * `promptHash` identifies the prompt template and definition schema an answer was produced
 * under (not the workspace's catalog), so audits can tell which builder produced a draft.
 */
import { z } from "zod";
import { sha256Hex, stableStringify } from "@flowaid/shared";
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
import { RUBRIC } from "./rubric.js";
import type { Advice } from "./types.js";

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
  /** error-severity safety findings of the rubric the returned definition still has */
  safety: Advice[];
  /** generation calls made (1 + repairs) */
  iterations: number;
  usage: { inputTokens: number; outputTokens: number };
  costUsd: number;
  /** {@link builderPromptHash} */
  promptHash: string;
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

const RULES = [
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
];
const ANSWER =
  'Answer with one JSON object: {"rationale": "why the workflow is shaped this way, in two or three sentences", "definition": <the workflow>}.';

export function systemPrompt(manifests: readonly NodeManifest[]): string {
  return [
    ...RULES,
    JSON.stringify(catalogForPrompt(manifests)),
    "A small valid example:",
    JSON.stringify(EXAMPLE),
    ANSWER,
  ].join("\n");
}

let promptHashCache: string | null = null;

/**
 * sha256 of the system prompt template (rules, example, answer format; the catalog is a
 * placeholder) and the definition schema version the model fills in. Stable across workspaces.
 */
export function builderPromptHash(): string {
  promptHashCache ??= sha256Hex(
    [
      ...RULES,
      "<catalog>",
      "A small valid example:",
      JSON.stringify(EXAMPLE),
      ANSWER,
      WORKFLOW_SCHEMA_URI,
      stableStringify(compactDefinitionSchema()),
    ].join("\n"),
  );
  return promptHashCache;
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
  // an answer without `definition` is not the definition itself: it goes back for repair
  if (v.definition === null || typeof v.definition !== "object" || Array.isArray(v.definition))
    return null;
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

function describeAdvice(a: Advice): string {
  const where = a.nodeIds.length ? ` (nodes ${a.nodeIds.join(", ")})` : "";
  return `- ${a.rule}${where}: ${a.title}. ${a.detail}`;
}

/** The rubric's error-severity safety findings on a compiled attempt. */
function safetyFindings(
  definition: WorkflowDefinition,
  compiled: CompileResult,
  manifests: readonly NodeManifest[],
): Advice[] {
  if (!compiled.ok) return [];
  const lookup = (type: string, version?: string) =>
    manifests.find((m) => m.id === type && (!version || m.version === version)) ??
    manifests.find((m) => m.id === type);
  const input = {
    definition,
    plan: compiled.plan,
    diagnostics: compiled.diagnostics,
    manifests: lookup,
    workflow: { evaluationSetId: null },
  };
  return RUBRIC.flatMap((rule) => rule.run(input)).filter(
    (a) => a.severity === "error" && a.category === "safety",
  );
}

/** Problems a repair round must fix: compiler errors count first, safety findings second. */
const problems = (w: Pick<GeneratedWorkflow, "diagnostics" | "safety">) =>
  errorsOf(w.diagnostics).length * 1000 + w.safety.length;

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
  const promptHash = builderPromptHash();
  let best: GeneratedWorkflow = {
    definition: null,
    diagnostics: [],
    safety: [],
    rationale: "",
    iterations: 0,
    usage,
    costUsd: 0,
    promptHash,
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
    let safety: Advice[] = [];
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
      const compiled = input.compile(doc);
      diagnostics = compiled.diagnostics;
      const schema = WorkflowDefinitionSchema.safeParse(doc);
      if (schema.success) {
        definition = schema.data;
        safety = safetyFindings(definition, compiled, input.manifests);
      }
    }
    const current: GeneratedWorkflow = {
      definition,
      diagnostics,
      safety,
      rationale: parsed?.rationale ?? best.rationale,
      iterations: attempt + 1,
      usage,
      costUsd,
      promptHash,
    };
    if (definition && (!best.definition || problems(current) <= problems(best))) best = current;
    else best = { ...best, iterations: attempt + 1, costUsd };
    if (definition && problems(current) === 0) return current;
    if (attempt === maxRepairs) break;
    const errors = errorsOf(diagnostics);
    const feedback = [
      ...(errors.length
        ? [`The compiler rejected that workflow:\n${errors.map(describe).join("\n")}`]
        : []),
      ...(safety.length
        ? [`The safety review found problems:\n${safety.map(describeAdvice).join("\n")}`]
        : []),
    ];
    messages.push(
      { role: "assistant", content: result.text || JSON.stringify(result.structured ?? {}) },
      {
        role: "user",
        content: `${feedback.join("\n")}\nFix every problem and answer with the complete corrected JSON object.`,
      },
    );
  }
  return { ...best, usage, costUsd };
}
