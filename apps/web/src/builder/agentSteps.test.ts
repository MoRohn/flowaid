import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { NodeManifest } from "@flowaid/workflow-core";
import type { AgentPreset } from "~/agents/logic";
import { agentPaletteDescription, agentPresetKind, agentStepFor, presetIdOf } from "./agentSteps";
import { Catalog, blankDefinition } from "./model";

// the real Agent node manifest, as the builder receives it from /v1/nodes
const manifests = (
  JSON.parse(
    readFileSync(resolve(process.cwd(), "../../packages/nodes-core/manifest.json"), "utf8"),
  ) as { nodes: NodeManifest[] }
).nodes;
const catalog = new Catalog(manifests.filter((m) => m.id === "flowaid.ai.agent"));

const preset: AgentPreset = {
  id: "0199a000-0000-7000-8000-0000000000a1",
  name: "Order helper",
  description: "Answers order questions",
  config: {
    model: { provider: "anthropic", model: "claude-sonnet-5" },
    tools: [
      { name: "calculator", approval: "never" },
      { name: "web_fetch", approval: "always" },
    ],
    maxSteps: 5,
  },
  active: true,
  createdAt: "",
  updatedAt: "",
};

describe("agents in Add node", () => {
  it("round-trips the palette id and describes the agent in one line", () => {
    expect(presetIdOf(agentPresetKind(preset.id))).toBe(preset.id);
    expect(presetIdOf("flowaid.ai.agent")).toBeUndefined();
    expect(agentPaletteDescription(preset)).toBe(
      "Answers order questions · claude-sonnet-5 · 2 tools",
    );
    expect(
      agentPaletteDescription({
        ...preset,
        description: "",
        config: { model: preset.config.model },
      }),
    ).toBe("Your agent · claude-sonnet-5 · no tools");
  });

  it("adds an Agent step that uses the agent and overrides none of its settings", () => {
    const node = agentStepFor(blankDefinition(preset.id, "W"), preset, catalog);
    expect(node).toMatchObject({
      kind: "task",
      type: "flowaid.ai.agent",
      name: "Order helper",
      config: { agentId: preset.id },
    });
    // model, tools and limits, Max steps included, come from the agent: a later change to the
    // agent's Max steps reaches the step (it used to be copied onto it once)
    expect(Object.keys((node as { config: object }).config)).toEqual(["agentId"]);
  });
});
