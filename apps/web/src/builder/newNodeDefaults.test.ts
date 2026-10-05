/**
 * New steps start valid (roadmap B-02): every node in the catalog the API serves (core and
 * LangChain manifests), added with its defaults, compiles without a config error except for a
 * required setting the person has yet to fill in; and the config form's round trip (it gives every
 * optional setting a slot) adds nothing to what is saved.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { NodeManifest } from "@flowaid/workflow-core";
import { withDefaults } from "@flowaid/ui/forms";
import { Catalog, blankDefinition, newNode } from "./model";
import { compileLocal } from "./compileLocal";
import { newStepConfig, savedStepConfig } from "./stepConfig";

const root = join(import.meta.dirname, "../../../..");
const load = (pkg: string) =>
  (
    JSON.parse(readFileSync(join(root, "packages", pkg, "manifest.json"), "utf8")) as {
      nodes: NodeManifest[];
    }
  ).nodes;
const MANIFESTS = [...load("nodes-core"), ...load("nodes-langchain")].filter(
  (m) => !m.metadata.deprecated,
);
const catalog = new Catalog(MANIFESTS);
const ID = "3e7a1c9b-8d2f-4b6e-9a0c-5f4d3e2b1a09";

function configProblems(m: NodeManifest) {
  const d = blankDefinition(ID, "New steps");
  const node = newNode(d, m.id, catalog, newStepConfig);
  if (!node || node.kind !== "task") throw new Error(`${m.id} made no task node`);
  d.nodes.push(node);
  const r = compileLocal({
    definition: d,
    manifests: MANIFESTS,
    tools: [],
    subflows: {},
    level: "draft",
  });
  return {
    node,
    diagnostics: r.diagnostics.filter(
      (x) => x.code === "E_CONFIG_INVALID" || x.code === "E_SCHEMA",
    ),
  };
}

describe("a step added from the palette", () => {
  it.each(MANIFESTS.map((m) => [m.id, m] as const))(
    "%s has no config error beyond a required setting not filled in yet",
    (_id, m) => {
      const required = new Set((m.configSchema as { required?: string[] }).required ?? []);
      const { diagnostics } = configProblems(m);
      for (const d of diagnostics) {
        expect(d.code).toBe("E_CONFIG_INVALID");
        // `/nodes/2/config` is "X is required"; deeper paths must sit under a required setting
        const key = d.location?.path?.split("/")[4];
        if (key !== undefined) expect([...required], d.message).toContain(key);
        else expect(d.message).toMatch(/is required$/);
      }
    },
  );

  it("starts a Boolean, Mock, Knowledge base, Policy check and Validator without stubs", () => {
    const configOf = (id: string) => {
      const m = MANIFESTS.find((x) => x.id === id);
      if (!m) throw new Error(`${id} is not in the catalog`);
      return configProblems(m);
    };
    expect(configOf("flowaid.decision.boolean").node.config).not.toHaveProperty("criteria");
    expect(configOf("flowaid.decision.boolean").diagnostics.map((d) => d.message)).toEqual([
      "Instructions is required",
    ]);
    expect(configOf("flowaid.dev.mock").node.config).not.toHaveProperty("fail");
    expect(configOf("flowaid.dev.mock").diagnostics).toEqual([]);
    expect(configOf("flowaid.retrieval.knowledge_base").node.config).not.toHaveProperty("rerank");
    expect(configOf("flowaid.retrieval.knowledge_base").diagnostics).toEqual([]);
    expect(configOf("flowaid.safety.policy_check").node.config).not.toHaveProperty("question");
    expect(configOf("flowaid.safety.policy_check").diagnostics).toEqual([]);
    expect(configOf("flowaid.decision.validator").diagnostics.map((d) => d.message)).toEqual([
      "Rubric is required",
    ]);
  });

  it.each(MANIFESTS.map((m) => [m.id, m] as const))(
    "%s: an edit through the config form adds nothing else",
    (_id, m) => {
      const config = newStepConfig(m.configSchema);
      // the form seeds itself with every default, then reports all of its values on an edit
      const form = withDefaults(m.configSchema as never, config);
      expect(savedStepConfig(m.configSchema, form)).toEqual(config);
    },
  );
});

describe("the local compile", () => {
  it("sees a cleared optional setting as the server does (absent, not undefined)", () => {
    const m = MANIFESTS.find((x) => x.id === "flowaid.decision.boolean");
    if (!m) throw new Error("no boolean");
    const d = blankDefinition(ID, "Cleared");
    const node = newNode(d, m.id, catalog, () => ({
      instructions: "Urgent?",
      criteria: undefined,
    }));
    if (!node) throw new Error("no node");
    d.nodes.push(node);
    const r = compileLocal({
      definition: d,
      manifests: MANIFESTS,
      tools: [],
      subflows: {},
      level: "draft",
    });
    expect(r.diagnostics.filter((x) => x.code === "E_SCHEMA")).toEqual([]);
  });
});
