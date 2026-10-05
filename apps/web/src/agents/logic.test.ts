import { describe, expect, it } from "vitest";
import {
  advancedLabel,
  changesData,
  checkDraft,
  draftOf,
  emptyDraft,
  hasAdvanced,
  modelLabel,
  modelProviders,
  reviewNotes,
} from "./logic";

const model = { provider: "openai", model: "gpt-test" };

describe("agent preset drafts", () => {
  it("requires a name and a model, and checks the bounds", () => {
    const bad = checkDraft({ ...emptyDraft(), maxSteps: "0", maxCostUsd: "-1" });
    expect(bad.ok).toBe(false);
    expect(Object.keys(bad.errors).sort()).toEqual(["maxCostUsd", "maxSteps", "model", "name"]);
  });

  it("builds a body with only the settings that are set", () => {
    const r = checkDraft({
      ...emptyDraft(),
      name: " Support ",
      model,
      tools: [{ name: "lookup", approval: "never" }],
      maxToolCalls: "",
    });
    expect(r.body).toEqual({
      name: "Support",
      description: "",
      config: { model, tools: [{ name: "lookup", approval: "never" }], maxSteps: 8, maxCostUsd: 1 },
    });
  });

  it("rejects the same tool twice and round-trips a stored preset", () => {
    const d = draftOf({
      id: "a",
      name: "A",
      description: "",
      config: { model, system: "Be kind", tools: [{ name: "x", approval: "bogus" }], maxSteps: 3 },
      createdAt: "",
      updatedAt: "",
    });
    expect(d.tools).toEqual([{ name: "x", approval: "irreversible" }]);
    expect(checkDraft({ ...d, tools: [...d.tools, ...d.tools] }).errors.tools).toBeDefined();
    expect(checkDraft(d).body?.config).toMatchObject({ system: "Be kind", maxSteps: 3 });
  });

  it("keeps every stored setting through an edit of another field", () => {
    const config = {
      model,
      system: "Be kind",
      tools: [{ name: "lookup", approval: "always" }],
      temperature: 0.2,
      maxOutputTokens: 800,
      maxTokens: 20000,
      stream: true,
      maxSteps: 4,
      // a setting a newer server may add: carried through, not dropped
      futureSetting: { on: true },
    };
    const d = draftOf({
      id: "a",
      name: "A",
      description: "",
      config,
      createdAt: "",
      updatedAt: "",
    });
    expect(d).toMatchObject({
      temperature: "0.2",
      maxOutputTokens: "800",
      maxTokens: "20000",
      stream: "on",
    });
    const saved = checkDraft({ ...d, description: "Answers order questions" }).body;
    expect(saved?.description).toBe("Answers order questions");
    expect(saved?.config).toEqual(config);
    expect(advancedLabel(saved?.config ?? {})).toBe(
      "temperature 0.2 · 800 output tokens a turn · 20000 tokens a run · streaming on",
    );
  });

  it("checks the advanced settings and leaves unset ones out", () => {
    const bad = checkDraft({
      ...emptyDraft(),
      name: "A",
      model,
      temperature: "3",
      maxOutputTokens: "0",
      maxTokens: "1.5",
    });
    expect(Object.keys(bad.errors).sort()).toEqual(["maxOutputTokens", "maxTokens", "temperature"]);
    const off = checkDraft({ ...emptyDraft(), name: "A", model, stream: "off" }).body?.config;
    expect(off).toMatchObject({ stream: false });
    expect(off).not.toHaveProperty("temperature");
    expect(hasAdvanced(emptyDraft())).toBe(false);
    expect(hasAdvanced({ ...emptyDraft(), stream: "off" })).toBe(true);
  });

  it("labels single models and failover policies", () => {
    expect(modelLabel(model)).toBe("gpt-test");
    expect(
      modelLabel({ candidates: [model, { provider: "x", model: "y" }], strategy: "cheapest" }),
    ).toBe("cheapest · gpt-test +1");
    expect(modelLabel(undefined)).toBe("No model");
  });
});

describe("agent review notes", () => {
  const ready = (p: string) => p === "openai";
  const base = { ...emptyDraft(), name: "Helper", model, system: "Answer briefly." };

  it("names providers without a key, from a single model or a failover policy", () => {
    expect(modelProviders(model)).toEqual(["openai"]);
    expect(
      modelProviders({ candidates: [{ provider: "anthropic" }, { provider: "openai" }] }),
    ).toEqual(["anthropic", "openai"]);
    const notes = reviewNotes(
      { ...base, model: { candidates: [{ provider: "anthropic", model: "x" }] } },
      { providerReady: ready, changes: new Map() },
    );
    expect(notes.find((n) => n.id === "provider-key")?.message).toContain("anthropic");
  });

  it("warns about tools that change data but never ask, and notes a toolless agent", () => {
    const unguarded = reviewNotes(
      { ...base, tools: [{ name: "refund", approval: "never" }] },
      { providerReady: ready, changes: new Map([["refund", true]]) },
    );
    expect(unguarded.map((n) => n.id)).toEqual(["unguarded"]);
    const bare = reviewNotes({ ...base, system: "" }, { providerReady: ready, changes: new Map() });
    expect(bare.map((n) => n.id)).toEqual(["no-tools", "no-instructions"]);
  });

  it("treats non-idempotent or approval-marked tools as changing data", () => {
    expect(changesData({ approvalRequired: false, idempotency: "none" })).toBe(true);
    expect(changesData({ approvalRequired: true, idempotency: "idempotent" })).toBe(true);
    expect(changesData({ approvalRequired: false, idempotency: "idempotent" })).toBe(false);
  });
});
