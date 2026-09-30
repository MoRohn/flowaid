import { describe, expect, it } from "vitest";
import { autoBindSlots, credentialTypeLabel, keySource, suggestSecretName } from "./keySources";

const sources = { server: { typesafe: true, openai: false }, saved: ["anthropic.api_key"] };

describe("keySource", () => {
  it("counts the server's key and 'no key' only for an optional secret", () => {
    expect(keySource("typesafe.api_key", sources)).toEqual({
      kind: "server",
      provider: "typesafe",
    });
    expect(keySource("ollama.none", sources)).toEqual({ kind: "none" });
    // a run refuses to start while a required secret is unbound, whatever the server has
    expect(keySource("typesafe.api_key", sources, true)).toEqual({ kind: "missing" });
    expect(keySource("anthropic.api_key", sources, true)).toEqual({ kind: "saved" });
    expect(keySource("openai.api_key", sources)).toEqual({ kind: "missing" });
  });
});

describe("secret names and labels", () => {
  it("suggests a conventional, unique secret name", () => {
    expect(suggestSecretName("openai.api_key", [])).toBe("OPENAI_API_KEY");
    expect(suggestSecretName("openai.api_key", ["OPENAI_API_KEY"])).toBe("OPENAI_API_KEY_2");
    expect(suggestSecretName("ollama.none", [])).toBe("OLLAMA");
  });

  it("names known credential types in words", () => {
    expect(credentialTypeLabel("anthropic.api_key")).toBe("Anthropic API key");
    expect(credentialTypeLabel("custom.thing")).toBe("custom.thing");
  });
});

describe("autoBindSlots", () => {
  const slot = { name: "typesafe", types: ["typesafe.api_key"], required: true };
  it("reuses a secret the workflow already declares for the slot's type", () => {
    const r = autoBindSlots(
      [slot],
      [{ name: "TS", credentialType: "typesafe.api_key", required: true }],
      sources,
    );
    expect(r).toEqual({ credentials: { typesafe: "TS" }, declare: [] });
  });
  it("declares an optional secret when the server has the key", () => {
    expect(autoBindSlots([slot], [], sources)).toEqual({
      credentials: { typesafe: "TYPESAFE_API_KEY" },
      declare: [{ name: "TYPESAFE_API_KEY", credentialType: "typesafe.api_key", required: false }],
    });
  });
  it("leaves a slot unbound when nothing answers it, and skips optional slots", () => {
    const none = { server: {}, saved: [] };
    expect(autoBindSlots([slot, { ...slot, name: "x", required: false }], [], none)).toEqual({
      credentials: {},
      declare: [],
    });
  });
});
