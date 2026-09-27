import { describe, expect, it } from "vitest";
import { checkDraft, draftOf, emptyDraft, modelLabel } from "./logic";

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

  it("labels single models and failover policies", () => {
    expect(modelLabel(model)).toBe("gpt-test");
    expect(
      modelLabel({ candidates: [model, { provider: "x", model: "y" }], strategy: "cheapest" }),
    ).toBe("cheapest · gpt-test +1");
    expect(modelLabel(undefined)).toBe("No model");
  });
});
