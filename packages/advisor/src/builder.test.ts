import { describe, expect, it } from "vitest";
import type { GenerationRequest, GenerationResult } from "@flowaid/workflow-core";
import {
  builderPromptHash,
  compactDefinitionSchema,
  generateWorkflow,
  systemPrompt,
} from "./builder.js";
import { allManifests, compileDef, refundPayout, triage } from "./test/fixtures.js";

const NEW_ID = "01a0e3aa-0000-7000-8000-000000000001";

function result(value: unknown, text = ""): GenerationResult {
  return {
    text,
    toolCalls: [],
    ...(value === undefined ? {} : { structured: value as never }),
    finishReason: "stop",
    usage: { inputTokens: 1000, outputTokens: 200 },
    costUsd: 0.002,
    priceSnapshot: null,
    latencyMs: 5,
    provider: "fake",
    model: "fake-1",
  };
}

/** A fake generation provider: answers in order, recording each request. */
function fake(answers: GenerationResult[]) {
  const requests: GenerationRequest[] = [];
  return {
    requests,
    generate: (req: GenerationRequest) => {
      requests.push(structuredClone(req));
      const next = answers.shift();
      if (!next) throw new Error("no more answers");
      return Promise.resolve(next);
    },
  };
}

const valid = (() => {
  const { id: _id, $schema: _s, ...rest } = triage() as unknown as Record<string, unknown>;
  return rest;
})();
/** A definition without the id and $schema the builder sets itself. */
const bodyOf = (def: unknown) => {
  const { id: _id, $schema: _s, ...rest } = def as Record<string, unknown>;
  return rest;
};
const invalid = {
  ...valid,
  nodes: (valid.nodes as { kind: string }[]).filter((n) => n.kind !== "output"),
};

describe("generateWorkflow", () => {
  it("feeds compiler errors back until the definition compiles with zero errors", async () => {
    const model = fake([
      result({ rationale: "first try", definition: invalid }),
      result({ rationale: "Two decisions, then a reply.", definition: valid }),
    ]);
    const out = await generateWorkflow({
      prompt: "Triage support tickets: refund? urgent? then draft a reply.",
      manifests: allManifests,
      generate: model.generate,
      compile: compileDef,
      jsonSchema: true,
      newId: () => NEW_ID,
    });
    expect(out.iterations).toBe(2);
    expect(out.definition?.id).toBe(NEW_ID);
    expect(out.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(out.rationale).toBe("Two decisions, then a reply.");
    expect(out.usage).toEqual({ inputTokens: 2000, outputTokens: 400 });
    expect(out.costUsd).toBeCloseTo(0.004, 9);
    // the repair round carried the compiler's error
    const repair = model.requests[1]?.messages.at(-1)?.content as string;
    expect(repair).toMatch(/E_NO_OUTPUT_NODE/);
    expect(model.requests[0]?.responseFormat).toMatchObject({ type: "json_schema" });
  });

  it("parses a fenced JSON answer from models without structured output", async () => {
    const model = fake([
      result(
        undefined,
        "```json\n" + JSON.stringify({ rationale: "ok", definition: valid }) + "\n```",
      ),
    ]);
    const out = await generateWorkflow({
      prompt: "x",
      manifests: allManifests,
      generate: model.generate,
      compile: compileDef,
      jsonSchema: false,
      newId: () => NEW_ID,
    });
    expect(out.iterations).toBe(1);
    expect(out.definition).not.toBeNull();
    expect(model.requests[0]?.responseFormat).toBeUndefined();
  });

  it("stops after the repair budget and returns the best attempt with its errors", async () => {
    const model = fake([
      result({ definition: invalid }),
      result("not a workflow"),
      result({ definition: invalid }),
    ]);
    const out = await generateWorkflow({
      prompt: "x",
      manifests: allManifests,
      generate: model.generate,
      compile: compileDef,
      jsonSchema: true,
      newId: () => NEW_ID,
      maxRepairs: 2,
    });
    expect(out.iterations).toBe(3);
    expect(out.definition).not.toBeNull();
    expect(out.diagnostics.some((d) => d.code === "E_NO_OUTPUT_NODE")).toBe(true);
  });

  it("feeds error-severity safety findings of the rubric back as repair input", async () => {
    const model = fake([
      result({ rationale: "pays out", definition: bodyOf(refundPayout(false)) }),
      result({ rationale: "approval first", definition: bodyOf(refundPayout(true)) }),
    ]);
    const out = await generateWorkflow({
      prompt: "Refund customers who ask for it",
      manifests: allManifests,
      generate: model.generate,
      compile: compileDef,
      jsonSchema: true,
      newId: () => NEW_ID,
    });
    // the first attempt compiled cleanly but acted on a decision with no check
    expect(
      compileDef(refundPayout(false)).diagnostics.filter((d) => d.severity === "error"),
    ).toEqual([]);
    expect(out.iterations).toBe(2);
    expect(out.rationale).toBe("approval first");
    expect(out.safety).toEqual([]);
    const repair = model.requests[1]?.messages.at(-1)?.content as string;
    expect(repair).toMatch(/irreversible_after_decision/);
  });

  it("returns the remaining safety findings when the repair budget runs out", async () => {
    const unsafe = bodyOf(refundPayout(false));
    const model = fake([result({ definition: unsafe }), result({ definition: unsafe })]);
    const out = await generateWorkflow({
      prompt: "x",
      manifests: allManifests,
      generate: model.generate,
      compile: compileDef,
      jsonSchema: true,
      newId: () => NEW_ID,
      maxRepairs: 1,
    });
    expect(out.iterations).toBe(2);
    expect(out.definition).not.toBeNull();
    expect(out.safety.map((a) => a.rule)).toEqual(["irreversible_after_decision"]);
  });

  it("does not take an answer without `definition` as the definition", async () => {
    const model = fake([result(valid), result({ rationale: "ok", definition: valid })]);
    const out = await generateWorkflow({
      prompt: "x",
      manifests: allManifests,
      generate: model.generate,
      compile: compileDef,
      jsonSchema: true,
      newId: () => NEW_ID,
    });
    expect(out.iterations).toBe(2);
    const repair = model.requests[1]?.messages.at(-1)?.content as string;
    expect(repair).toMatch(/E_SCHEMA/);
  });

  it("stamps a stable hash of the prompt template and schema version", async () => {
    const hash = builderPromptHash();
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(builderPromptHash()).toBe(hash);
    const model = fake([result({ rationale: "r", definition: valid })]);
    const out = await generateWorkflow({
      prompt: "x",
      manifests: allManifests.slice(0, 5),
      generate: model.generate,
      compile: compileDef,
      jsonSchema: true,
      newId: () => NEW_ID,
    });
    // the workspace's catalog is not part of the template: the hash does not move with it
    expect(out.promptHash).toBe(hash);
  });

  it("keeps the base definition's id when refining", async () => {
    const base = triage();
    const model = fake([result({ rationale: "r", definition: valid })]);
    const out = await generateWorkflow({
      prompt: "make it faster",
      baseDefinition: base,
      manifests: allManifests,
      generate: model.generate,
      compile: compileDef,
      jsonSchema: true,
      newId: () => NEW_ID,
    });
    expect(out.definition?.id).toBe(base.id);
    expect(model.requests[0]?.messages[1]?.content).toMatch(/The current workflow/);
  });

  it("describes the catalog and a compact schema in the system prompt", () => {
    const prompt = systemPrompt(allManifests);
    expect(prompt).toContain("flowaid.decision.boolean");
    expect(prompt.length).toBeLessThan(60_000);
    const schema = JSON.stringify(compactDefinitionSchema());
    expect(schema).not.toMatch(/"description":"/);
    expect(schema).toContain('"description":{');
    expect(schema).not.toContain('"layout"');
  });
});
