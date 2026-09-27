/** Test fixtures: the core catalog, the model catalog and small workflows. Not built or exported. */
import { readFileSync } from "node:fs";
import { DefaultModelCatalog } from "@flowaid/providers";
import { compile } from "@flowaid/workflow-compiler";
import {
  WorkflowDefinitionSchema,
  type Binding,
  type CompileResult,
  type ExecutionPlan,
  type NodeManifest,
  type WorkflowDefinition,
} from "@flowaid/workflow-core";
import type { ManifestLookup } from "../types.js";

/** The core catalog, read from the committed manifest (the advisor may not import nodes-core). */
const coreManifests = (
  JSON.parse(
    readFileSync(new URL("../../../nodes-core/manifest.json", import.meta.url), "utf8"),
  ) as { nodes: NodeManifest[] }
).nodes;

export const manifests: ManifestLookup = (type, version) =>
  coreManifests.find((m) => m.id === type && (!version || m.version === version)) ??
  coreManifests.find((m) => m.id === type);

export const allManifests: readonly NodeManifest[] = coreManifests;

export const modelCatalog = new DefaultModelCatalog();

export function compileDef(definition: unknown): CompileResult {
  return compile(definition, {
    catalog: {
      get: (id, version) => manifests(id, version),
      list: () => [...coreManifests],
    },
    level: "draft",
  });
}

export function planOf(def: WorkflowDefinition): ExecutionPlan {
  const r = compileDef(def);
  if (!r.ok) throw new Error(`does not compile: ${JSON.stringify(r.diagnostics)}`);
  return r.plan;
}

export const ref = (node: string, port: string, path?: string): Binding => ({
  kind: "ref",
  ref: { kind: "port", node, port, ...(path ? { path } : {}) },
});

const version = (type: string) => (manifests(type) as NodeManifest).version;

export function task(
  id: string,
  type: string,
  config: Record<string, unknown>,
  inputs: Record<string, Binding>,
  credentials: Record<string, string>,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    kind: "task",
    name: id.replace(/_/g, " "),
    type,
    typeVersion: version(type),
    config,
    inputs,
    credentials,
    ...extra,
  };
}

export function define(doc: Record<string, unknown>): WorkflowDefinition {
  return WorkflowDefinitionSchema.parse({
    $schema: "https://flowaid.dev/schemas/workflow/v1",
    id: "3e7a1c9b-8d2f-4b6e-9a0c-5f4d3e2b1a09",
    name: "Fixture",
    inputs: { type: "object", required: ["message"], properties: { message: { type: "string" } } },
    outputs: { type: "object" },
    ...doc,
  });
}

const state = { kind: "object", fields: { message: ref("ticket", "message") } } as Binding;

/** Two sequential TypeSafe decisions over the same state, and a generation node. */
export function triage(
  model = { provider: "anthropic", model: "claude-opus-5-5" },
): WorkflowDefinition {
  return define({
    outputs: {
      type: "object",
      properties: {
        refund: { type: "boolean" },
        urgent: { type: "boolean" },
        reply: { type: "string" },
      },
    },
    secrets: [
      { name: "TYPESAFE_API_KEY", credentialType: "typesafe.api_key" },
      { name: "ANTHROPIC_API_KEY", credentialType: "anthropic.api_key" },
    ],
    execution: { maxCostUsd: 0.5 },
    nodes: [
      { id: "ticket", kind: "input", name: "Ticket" },
      task(
        "is_refund",
        "flowaid.decision.boolean",
        { instructions: "Is this a refund request?" },
        { state },
        { typesafe: "TYPESAFE_API_KEY" },
      ),
      task(
        "is_urgent",
        "flowaid.decision.boolean",
        { instructions: "Is this urgent?" },
        { state },
        { typesafe: "TYPESAFE_API_KEY" },
      ),
      task(
        "reply",
        "flowaid.ai.generate",
        { model, temperature: 0 },
        { prompt: { kind: "template", source: "Reply to: {{ ticket.message }}" } },
        { llm: "ANTHROPIC_API_KEY" },
      ),
      {
        id: "done",
        kind: "output",
        name: "Done",
        value: {
          kind: "object",
          fields: {
            refund: ref("is_refund", "decision", "/value"),
            urgent: ref("is_urgent", "decision", "/value"),
            reply: ref("reply", "text"),
          },
        },
      },
    ],
    edges: [
      { id: "e1", from: { node: "ticket", port: "done" }, to: { node: "is_refund" } },
      { id: "e2", from: { node: "is_refund", port: "done" }, to: { node: "is_urgent" } },
      { id: "e3", from: { node: "is_urgent", port: "done" }, to: { node: "reply" } },
      { id: "e4", from: { node: "reply", port: "done" }, to: { node: "done" } },
    ],
  });
}
