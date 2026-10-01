import { describe, expect, it } from "vitest";
import { selectGenerationModel } from "./defaultModel.js";

const all = ["anthropic", "openai", "ollama"];

describe("selectGenerationModel", () => {
  it("uses the configured model when its provider is registered", async () => {
    const pick = (configured: unknown, registered = all) =>
      selectGenerationModel({ configured, registered, hasKey: () => false });
    expect(await pick({ provider: "openai", model: "gpt-x" })).toEqual({
      provider: "openai",
      model: "gpt-x",
    });
    expect(await pick({ provider: "nope", model: "m" })).toBeNull();
  });

  it("falls back to the first default with a key", async () => {
    const keys = new Set(["openai.api_key", "ollama.host"]);
    expect(
      await selectGenerationModel({
        configured: undefined,
        registered: all,
        hasKey: (t) => Promise.resolve(keys.has(t)),
      }),
    ).toEqual({ provider: "openai", model: "gpt-5.5" });
    expect(
      await selectGenerationModel({ configured: {}, registered: all, hasKey: () => false }),
    ).toBeNull();
    // an unregistered provider is skipped even with a key
    expect(
      await selectGenerationModel({
        configured: null,
        registered: ["ollama"],
        hasKey: () => true,
      }),
    ).toEqual({ provider: "ollama", model: "qwen3:8b" });
  });
});
