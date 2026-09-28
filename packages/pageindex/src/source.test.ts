import { describe, expect, it } from "vitest";
import { configHash } from "./capabilities.js";
import { StoredIndexSettingsSchema, indexRequestFromSource } from "./source.js";

const OLLAMA_CONFIG = { indexModel: { provider: "ollama", model: "qwen2.5:3b" } };

describe("indexRequestFromSource", () => {
  it("fills the defaults and hashes the settings the index records", () => {
    const r = indexRequestFromSource({ indexModel: { provider: "ollama", model: "qwen2.5:3b" } });
    expect(r.settings).toEqual({
      model: { provider: "ollama", model: "qwen2.5:3b" },
      mode: "flash",
      optimize: "off",
      credentialId: null,
    });
    expect(r.indexModel).toBe("ollama/qwen2.5:3b");
    expect(r.configHash).toBe(configHash(r.settings));
    // the stored form reads back
    expect(StoredIndexSettingsSchema.parse(r.settings)).toEqual(r.settings);
  });

  it("keeps an explicit optimize setting", () => {
    const r = indexRequestFromSource({ ...OLLAMA_CONFIG, optimize: "merge" });
    expect(r.settings.optimize).toBe("merge");
    expect(r.configHash).not.toBe(indexRequestFromSource(OLLAMA_CONFIG).configHash);
  });

  it("changes the hash with the mode, and not with the credential", () => {
    const base = { indexModel: { provider: "openai", model: "gpt-5.5-mini" } };
    const flash = indexRequestFromSource(base);
    expect(indexRequestFromSource({ ...base, mode: "standard" }).configHash).not.toBe(
      flash.configHash,
    );
    expect(
      indexRequestFromSource({ ...base, credentialId: "0199a000-0000-7000-8000-00000000aaaa" })
        .configHash,
    ).toBe(flash.configHash);
  });

  it("refuses providers PageIndex cannot use, naming the field", () => {
    expect(() =>
      indexRequestFromSource({ indexModel: { provider: "typesafe", model: "x" } }),
    ).toThrow(/indexModel.provider/);
    expect(() => indexRequestFromSource({})).toThrow(/invalid/);
  });
});
