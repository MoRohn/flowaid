/**
 * AI-filled run input: a few realistic inputs for a workflow, each saying what it exercises. The
 * model sees the input schema, the steps, branch conditions and the workflow's settings (never
 * secrets, credentials or past runs). Every sample is checked by the caller's validator (the one
 * runs use), with one repair round for the ones that fail; the rest are dropped, never returned.
 * Pure: generation and validation are passed in.
 */
import { sha256Hex, stableStringify } from "@flowaid/shared";
import type {
  ChatMessage,
  GenerationRequest,
  GenerationResult,
  JsonSchema,
  WorkflowDefinition,
} from "@flowaid/workflow-core";

export type SampleScenario = "typical" | "edge" | "unusual";

export interface SampleInputsRequest {
  definition: WorkflowDefinition;
  scenario: SampleScenario;
  /** what the person wants, in their words ("a damaged mug delivered 40 days ago") */
  instructions?: string;
  /** values already entered; `keep` names the ones every sample must repeat unchanged */
  current?: Record<string, unknown>;
  keep?: readonly string[];
  /** how many variations (1–3) */
  count: number;
  generate: (req: GenerationRequest) => Promise<GenerationResult>;
  /** whether the model accepts `responseFormat: json_schema` */
  jsonSchema: boolean;
  /** problems with a candidate input, in words; empty when the workflow would accept it */
  validate: (input: Record<string, unknown>) => string[];
}

export interface SampleInput {
  /** a short name for the case ("Late return, damaged item") */
  title: string;
  /** one sentence: what this input exercises in the workflow */
  why: string;
  input: Record<string, unknown>;
}

export interface SampleInputsResult {
  samples: SampleInput[];
  /** candidates dropped because they still failed validation after the repair round */
  rejected: number;
  /** generation calls made (1, or 2 with a repair round) */
  iterations: number;
  usage: { inputTokens: number; outputTokens: number };
  costUsd: number;
  promptHash: string;
}

const SCENARIO: Record<SampleScenario, string> = {
  typical:
    "Typical: the ordinary requests this workflow handles most days. Vary them so each takes a common path.",
  edge: "Edge cases: values at or just past the limits the workflow checks (the thresholds in its branch conditions and settings), so each lands on a different side of a rule.",
  unusual:
    "Unusual but valid: requests a person would not think of first, such as vague or mixed wording, missing optional details, or a request that should go to a person. Still valid for the schema.",
};

export const SAMPLE_INPUTS_SYSTEM_PROMPT = [
  "You write test inputs for an automated workflow so a person can try it.",
  'Answer with one JSON object: {"samples": [{"title", "why", "input"}]}.',
  "- `input` must match the input JSON schema exactly: every required property, the right types, enum values as written, and any minimum, maximum, pattern or length limits. No extra properties unless the schema allows them.",
  "- Make values realistic and consistent with each other and with the field descriptions (an order total that fits the item, a date that fits the delay).",
  "- Never use real people or real contact details: fictional names, emails at example.com, phone numbers from 555-0100 to 555-0199, and made-up order or account numbers.",
  '- Never put secrets, API keys, passwords or tokens in an input, even if a field asks for one; use an obvious placeholder such as "test-token".',
  '- `title` is at most 6 words. `why` is one sentence saying which step, rule or branch the input exercises and what outcome it should lead to. Write it for a person who is not technical: name settings and steps the way a person would ("the refund limit of $50", "the Agent review step"), never internal ids or expressions (not "autoRefundLimit" or "limits.result.refund").',
  "- Each sample must differ in a way that matters to the workflow, not only in wording.",
].join("\n");

export function sampleInputsPromptHash(): string {
  return sha256Hex(stableStringify({ system: SAMPLE_INPUTS_SYSTEM_PROMPT, scenarios: SCENARIO }));
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The config fields that state a step's rule or question (expressions, instructions). */
const RULE_KEYS = ["expr", "expression", "condition", "instructions", "question", "questions"];

function rulesOf(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of RULE_KEYS) {
    const v = config[k];
    if (typeof v === "string") out[k] = clip(v, 400);
    else if (Array.isArray(v)) out[k] = clip(JSON.stringify(v), 800);
  }
  return out;
}

/** What the model is told about the workflow: its inputs, steps, rules and settings. */
export function sampleInputsContext(def: WorkflowDefinition): Record<string, unknown> {
  const steps = def.nodes
    .filter((n) => n.kind !== "note")
    .slice(0, 60)
    .map((n) => ({
      name: n.name,
      kind: n.kind === "task" ? n.type : n.kind,
      ...(n.description ? { description: clip(n.description, 300) } : {}),
      ...(n.kind === "branch"
        ? {
            cases: n.cases.map((c) => ({
              ...(c.label ? { label: c.label } : {}),
              when: clip(String(c.when), 300),
            })),
          }
        : {}),
      ...(n.kind === "task" ? rulesOf(n.config) : {}),
    }));
  // the settings the rules compare against (limits, windows); environment values are not known here
  const variables = Object.fromEntries(
    def.variables
      .filter((v) => v.source === "definition" && v.default !== undefined)
      .map((v) => [
        v.name,
        v.description ? { value: v.default, about: clip(v.description, 200) } : v.default,
      ]),
  );
  return {
    name: def.name,
    ...(def.description ? { description: clip(def.description, 1000) } : {}),
    inputSchema: def.inputs,
    steps,
    ...(Object.keys(variables).length ? { settings: variables } : {}),
  };
}

function answerSchema(inputs: JsonSchema, count: number): JsonSchema {
  return {
    type: "object",
    required: ["samples"],
    properties: {
      samples: {
        type: "array",
        minItems: 1,
        maxItems: count,
        items: {
          type: "object",
          required: ["title", "why", "input"],
          properties: {
            title: { type: "string" },
            why: { type: "string" },
            input: inputs,
          },
        },
      },
    },
  } as unknown as JsonSchema;
}

function parseSamples(result: GenerationResult): unknown[] | null {
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
  const samples = (value as { samples?: unknown } | null)?.samples;
  return Array.isArray(samples) ? samples : null;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

interface Candidate {
  sample: SampleInput;
  issues: string[];
}

export async function sampleInputs(req: SampleInputsRequest): Promise<SampleInputsResult> {
  const count = Math.min(3, Math.max(1, Math.round(req.count)));
  const keep = (req.keep ?? []).filter((k) => req.current && k in req.current);
  const kept = Object.fromEntries(keep.map((k) => [k, req.current?.[k]]));
  const ask = [
    `The workflow:\n${JSON.stringify(sampleInputsContext(req.definition))}`,
    `Write ${count} ${count === 1 ? "input" : "different inputs"}. ${SCENARIO[req.scenario]}`,
    ...(req.instructions?.trim()
      ? [
          `What the person asked for (follow it where the schema allows): ${clip(req.instructions.trim(), 2000)}`,
        ]
      : []),
    ...(keep.length
      ? [
          `Keep these values exactly as they are in every input, and write the other fields to fit them: ${JSON.stringify(kept)}`,
        ]
      : []),
  ].join("\n\n");
  const messages: ChatMessage[] = [
    { role: "system", content: SAMPLE_INPUTS_SYSTEM_PROMPT },
    { role: "user", content: ask },
  ];
  const responseFormat = req.jsonSchema
    ? ({
        type: "json_schema",
        strict: false,
        schema: answerSchema(req.definition.inputs, count),
      } as const)
    : undefined;
  const usage = { inputTokens: 0, outputTokens: 0 };
  let costUsd = 0;
  let iterations = 0;

  const call = async (): Promise<Candidate[]> => {
    iterations++;
    const result = await req.generate({
      messages,
      // some spread between the variations, still close to the schema
      temperature: req.scenario === "typical" ? 0.5 : 0.8,
      maxOutputTokens: 4_000,
      ...(responseFormat ? { responseFormat } : {}),
    });
    usage.inputTokens += result.usage.inputTokens;
    usage.outputTokens += result.usage.outputTokens;
    costUsd += result.costUsd;
    messages.push({
      role: "assistant",
      content: result.text || JSON.stringify(result.structured ?? {}),
    });
    return (parseSamples(result) ?? []).slice(0, count).map((raw): Candidate => {
      const r = isObject(raw) ? raw : {};
      // the kept values win whatever the model wrote
      const input = { ...(isObject(r.input) ? r.input : {}), ...kept };
      const sample: SampleInput = {
        title: clip(typeof r.title === "string" && r.title.trim() ? r.title.trim() : "Sample", 80),
        why: clip(typeof r.why === "string" ? r.why.trim() : "", 400),
        input,
      };
      return { sample, issues: isObject(r.input) ? req.validate(input) : ["no input object"] };
    });
  };

  let candidates = await call();
  const failing = candidates.filter((c) => c.issues.length > 0);
  if (failing.length > 0 || candidates.length === 0) {
    const feedback =
      candidates.length === 0
        ? "That was not a JSON object with a `samples` array."
        : failing
            .map(
              (c) =>
                `"${c.sample.title}" does not match the input schema: ${c.issues.slice(0, 8).join("; ")}`,
            )
            .join("\n");
    messages.push({
      role: "user",
      content: `${feedback}\nAnswer again with the complete JSON object: keep the inputs that were valid and fix the others.`,
    });
    const repaired = await call();
    // the repaired answer replaces the first when it is at least as good
    const valid = (cs: Candidate[]) => cs.filter((c) => c.issues.length === 0).length;
    if (valid(repaired) >= valid(candidates)) candidates = repaired;
  }
  const samples = candidates.filter((c) => c.issues.length === 0).map((c) => c.sample);
  return {
    samples,
    rejected: candidates.length - samples.length,
    iterations,
    usage,
    costUsd,
    promptHash: sampleInputsPromptHash(),
  };
}
