import { describe, expect, it } from "vitest";
import type { ModelInfo, NodeManifest, WorkflowNode } from "@flowaid/workflow-core";
import { Catalog, blankDefinition, project } from "./model";
import { toModelViews } from "./models";

describe("toModelViews", () => {
  it("maps the catalog to picker rows: chat → generation, prices, local, no rerankers", () => {
    const models: ModelInfo[] = [
      {
        provider: "openai",
        model: "gpt-6-sol",
        kind: "chat",
        contextTokens: 1_050_000,
        pricing: { inputPerMTok: 2, outputPerMTok: 10 },
        capabilities: { tools: true },
      },
      { provider: "ollama", model: "llama3.1:8b", kind: "chat", capabilities: {} },
      { provider: "cohere", model: "rerank-4", kind: "rerank", capabilities: {} },
      { provider: "typesafe", model: "jev-latest", kind: "decision", capabilities: {} },
    ];
    expect(toModelViews(models)).toEqual([
      {
        id: "gpt-6-sol",
        provider: "openai",
        name: "gpt-6-sol",
        kind: "generation",
        contextTokens: 1_050_000,
        inputCostPerMTok: 2,
        outputCostPerMTok: 10,
      },
      {
        id: "llama3.1:8b",
        provider: "ollama",
        name: "llama3.1:8b",
        kind: "generation",
        local: true,
      },
      { id: "jev-latest", provider: "typesafe", name: "jev-latest", kind: "decision" },
    ]);
  });
});

describe("node cards for generation policies (RFC-0005)", () => {
  const manifest = {
    id: "flowaid.ai.generate",
    version: "1.0.0",
    metadata: { name: "Generate", description: "", category: "generation", icon: "", tags: [] },
    configSchema: { type: "object" },
    inputs: [],
    outputs: [],
    controlPorts: [],
    portRules: [],
    credentials: [],
    capabilities: [],
    idempotency: "safe",
    pool: "general",
    generation: true,
    streams: true,
    optionProviders: [],
    migrations: [],
    defaultPolicy: {},
  } as unknown as NodeManifest;
  const node = (model: unknown): WorkflowNode =>
    ({
      id: "draft",
      kind: "task",
      name: "Draft",
      type: manifest.id,
      typeVersion: "1.0.0",
      config: { model },
      inputs: {},
      credentials: {},
      disabled: false,
    }) as WorkflowNode;
  const metaOf = (model: unknown) => {
    const def = blankDefinition("3e7a1c9b-8d2f-4b6e-9a0c-5f4d3e2b1a09", "t");
    def.nodes.push(node(model));
    return project(def, null, [], new Catalog([manifest])).nodes.find((n) => n.id === "draft")
      ?.meta;
  };

  it("shows the first candidate, the fallback count and the routing", () => {
    expect(
      metaOf({
        candidates: [
          { provider: "openai", model: "gpt-6-luna" },
          { provider: "anthropic", model: "claude-sonnet-5" },
        ],
        strategy: "cheapest",
      }),
    ).toEqual([{ label: "cheapest", value: "gpt-6-luna +1" }]);
    expect(metaOf({ provider: "openai", model: "gpt-6-sol" })).toEqual([
      { label: "model", value: "gpt-6-sol" },
    ]);
  });
});
