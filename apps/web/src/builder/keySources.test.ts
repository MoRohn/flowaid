import { describe, expect, it } from "vitest";
import { credentialTypeLabel, keySource, suggestSecretName } from "./keySources";

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
