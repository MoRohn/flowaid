/**
 * RFC-0005: a generation node's `config.model` may be a GenerationPolicy. The schema pass
 * accepts it, and the environment pass checks every candidate: unconfigured ones are skipped
 * with W_FAILOVER_UNCONFIGURED; with none configured the node is unavailable.
 */
import { describe, expect, it } from "vitest";
import type { Diagnostic } from "@flowaid/workflow-core";
import { compile } from "./index.js";
import { FIXTURE_MANIFESTS, catalogOf, readJson } from "./test/support.js";

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function withModel(model: unknown): Doc {
  const doc = JSON.parse(JSON.stringify(readJson("example-support-reply.json"))) as Doc;
  const draft = (doc.nodes as Doc[]).find((n) => n.id === "draft") as Doc;
  draft.config.model = model;
  return doc;
}

const POLICY = {
  candidates: [
    { provider: "openai", model: "gpt-4.1-mini" },
    { provider: "anthropic", model: "claude-sonnet-5" },
  ],
  strategy: "cheapest",
};

function diagnostics(doc: Doc, providers: string[], level: "draft" | "publish" = "draft") {
  const result = compile(doc, {
    catalog: catalogOf(FIXTURE_MANIFESTS),
    level,
    providers: {
      providers: new Set(providers),
      models: [
        { provider: "anthropic", model: "claude-sonnet-5", deprecated: "retired on 2027-06-01" },
      ],
    },
  });
  return result.diagnostics;
}
const codes = (list: Diagnostic[]) =>
  list.map((d) => d.code).filter((c) => c !== "W_COST_ESTIMATE");

describe("generation policies in the compiler (RFC-0005)", () => {
  it("accepts a policy where a model ref was expected", () => {
    const list = diagnostics(withModel(POLICY), ["openai", "anthropic", "typesafe"]);
    expect(list.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("rejects a policy with no candidates or too many", () => {
    for (const candidates of [[], Array.from({ length: 6 }, () => POLICY.candidates[0])]) {
      const list = diagnostics(withModel({ candidates }), ["openai", "typesafe"]);
      expect(codes(list)).toContain("E_CONFIG_INVALID");
    }
  });

  it("warns about each unconfigured candidate and keeps compiling", () => {
    const list = diagnostics(withModel(POLICY), ["openai", "typesafe"], "publish");
    const failover = list.filter((d) => d.code === "W_FAILOVER_UNCONFIGURED");
    expect(failover).toHaveLength(1);
    expect(failover[0]).toMatchObject({
      severity: "warning",
      location: { nodeId: "draft", path: expect.stringMatching(/\/config\/model\/candidates\/1$/) },
    });
    expect(failover[0]?.message).toContain("anthropic/claude-sonnet-5");
    expect(list.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("reports the node unavailable when no candidate is configured", () => {
    expect(codes(diagnostics(withModel(POLICY), ["typesafe"], "publish"))).toContain(
      "E_PROVIDER_UNAVAILABLE",
    );
    expect(codes(diagnostics(withModel(POLICY), ["typesafe"]))).toContain("W_PROVIDER_UNAVAILABLE");
  });

  it("flags a deprecated candidate at its own path", () => {
    const list = diagnostics(withModel(POLICY), ["openai", "anthropic", "typesafe"]);
    const deprecated = list.find((d) => d.code === "W_MODEL_DEPRECATED");
    expect(deprecated?.location.path).toMatch(/\/config\/model\/candidates\/1$/);
  });
});
