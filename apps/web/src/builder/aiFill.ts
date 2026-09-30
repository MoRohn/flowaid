/**
 * Fill with AI, in words and data (pure, so it is unit tested): the scenarios offered, which of
 * the entered values a request keeps, how a sample compares with what is in the form, and what a
 * failure means for the person.
 */
import type { JsonSchema } from "@flowaid/workflow-core";
import { ApiError } from "~/api/client";

export type Scenario = "typical" | "edge" | "unusual";

export interface ScenarioInfo {
  id: Scenario;
  label: string;
  about: string;
  placeholder: string;
}

export const SCENARIOS = [
  {
    id: "typical",
    label: "Typical",
    about: "Everyday requests that take the common paths.",
    placeholder: "e.g. a customer asking about a recent order",
  },
  {
    id: "edge",
    label: "Edge cases",
    about: "Values at and just past the limits the workflow checks.",
    placeholder: "e.g. an order total right at the refund limit",
  },
  {
    id: "unusual",
    label: "Unusual",
    about: "Valid but unexpected: vague wording, missing details, a case for a person.",
    placeholder: "e.g. an angry message that mixes two problems",
  },
] as const satisfies readonly ScenarioInfo[];

export interface Sample {
  title: string;
  why: string;
  input: Record<string, unknown>;
}

export interface SampleResponse {
  samples: Sample[];
  rejected: number;
  model: { provider: string; model: string };
  usage: { inputTokens: number; outputTokens: number };
  costUsd: number;
}

const propertiesOf = (schema: JsonSchema) =>
  (schema as { properties?: Record<string, { title?: string }> }).properties ?? {};

const isEmpty = (v: unknown) =>
  v === undefined ||
  v === null ||
  (typeof v === "string" && v.trim() === "") ||
  (Array.isArray(v) && v.length === 0);

/** The input fields that already hold something, in the schema's order. */
export function enteredFields(schema: JsonSchema, value: Record<string, unknown>): string[] {
  return Object.keys(propertiesOf(schema)).filter((k) => !isEmpty(value[k]));
}

export function fieldLabel(schema: JsonSchema, key: string): string {
  const title = propertiesOf(schema)[key]?.title;
  if (title) return title;
  const spaced = key.replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** A value as one line of text for the preview. */
export function showValue(v: unknown): string {
  if (v === undefined || v === null) return "—";
  if (typeof v === "string") return v === "" ? "(empty)" : v;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return String(v);
  return JSON.stringify(v);
}

export type FieldChange = "new" | "changed" | "same";

export interface PreviewRow {
  key: string;
  label: string;
  value: string;
  change: FieldChange;
}

/** Each field of a sample in the schema's order, and how it differs from the form. */
export function previewRows(
  schema: JsonSchema,
  sample: Record<string, unknown>,
  current: Record<string, unknown>,
): PreviewRow[] {
  const keys = [
    ...Object.keys(propertiesOf(schema)),
    ...Object.keys(sample).filter((k) => !(k in propertiesOf(schema))),
  ].filter((k) => k in sample);
  return keys.map((key) => ({
    key,
    label: fieldLabel(schema, key),
    value: showValue(sample[key]),
    change: isEmpty(current[key])
      ? "new"
      : JSON.stringify(current[key]) === JSON.stringify(sample[key])
        ? "same"
        : "changed",
  }));
}

/** What a failed request means, and what to do about it. */
export type FillProblem =
  | { kind: "no-model"; message: string }
  | { kind: "rate-limited"; message: string }
  | { kind: "forbidden"; message: string }
  | { kind: "failed"; message: string; detail?: string };

export function fillProblem(error: unknown): FillProblem {
  if (error instanceof ApiError) {
    if (error.status === 409)
      return {
        kind: "no-model",
        message:
          "No text model is set up to write inputs. Add an OpenAI, Anthropic or Ollama key under Credentials, then try again.",
      };
    if (error.status === 429)
      return {
        kind: "rate-limited",
        message: "That is a lot of requests in a minute. Wait a moment, then try again.",
      };
    if (error.status === 403)
      return {
        kind: "forbidden",
        message: "Your role cannot start runs, so it cannot fill inputs.",
      };
    return {
      kind: "failed",
      message: "The model could not write inputs this time. Try again, or describe the case.",
      detail: [error.message, error.code, error.requestId && `request ${error.requestId}`]
        .filter(Boolean)
        .join(" · "),
    };
  }
  if (error instanceof TypeError)
    return {
      kind: "failed",
      message: "Could not reach FlowAId's API. Check that FlowAId is still running.",
    };
  return {
    kind: "failed",
    message: "The model could not write inputs this time. Try again.",
    ...(error instanceof Error ? { detail: error.message } : {}),
  };
}

/** The body of a request: the unsaved draft, the scenario, and the values to keep. */
export function sampleRequest(o: {
  definition: unknown;
  scenario: Scenario;
  instructions: string;
  current: Record<string, unknown>;
  keepEntered: boolean;
  schema: JsonSchema;
  count: number;
}) {
  const keep = o.keepEntered ? enteredFields(o.schema, o.current) : [];
  return {
    definition: o.definition,
    scenario: o.scenario,
    count: o.count,
    ...(o.instructions.trim() ? { instructions: o.instructions.trim() } : {}),
    ...(keep.length ? { current: o.current, keep } : {}),
  };
}
