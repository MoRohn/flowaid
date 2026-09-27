import { describe, expect, it } from "vitest";
import { crc32, generateApiKey, looksLikeApiKey, parseApiKey } from "./apiKey.js";
import { ROLE_SCOPES, roleAtLeast } from "./scopes.js";
import { passwordProblem } from "./passwords.js";

describe("API key format", () => {
  it("generates fa_<mode>_<32>_<6> keys with a verifiable checksum", () => {
    const { key, prefix, hash } = generateApiKey("live");
    expect(key).toMatch(/^fa_live_[0-9A-Za-z]{32}_[0-9A-Za-z]{6}$/);
    expect(prefix).toBe(key.slice(0, 16));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(parseApiKey(key)).toEqual({ mode: "live" });
    expect(parseApiKey(generateApiKey("test").key)).toEqual({ mode: "test" });
  });

  it("rejects corrupted keys offline", () => {
    const { key } = generateApiKey("live");
    const flipped = key.slice(0, 20) + (key[20] === "a" ? "b" : "a") + key.slice(21);
    expect(parseApiKey(flipped)).toBeNull();
    expect(parseApiKey("fa_live_short_abcdef")).toBeNull();
    expect(looksLikeApiKey("fa_test_x")).toBe(true);
    expect(looksLikeApiKey("eyJ...")).toBe(false);
  });

  it("crc32 matches the standard check value", () => {
    expect(crc32("123456789")).toBe(0xcbf43926);
  });
});

describe("roles and passwords", () => {
  it("maps roles to nested scope sets", () => {
    expect(ROLE_SCOPES.viewer.has("runs:read")).toBe(true);
    expect(ROLE_SCOPES.viewer.has("runs:create")).toBe(false);
    expect(ROLE_SCOPES.operator.has("runs:approve")).toBe(true);
    expect(ROLE_SCOPES.editor.has("workflows:publish")).toBe(true);
    expect(ROLE_SCOPES.editor.has("credentials:write")).toBe(false);
    expect(ROLE_SCOPES.admin.has("members:manage")).toBe(true);
    for (const s of ROLE_SCOPES.viewer) expect(ROLE_SCOPES.owner.has(s)).toBe(true);
    expect(roleAtLeast("editor", "operator")).toBe(true);
    expect(roleAtLeast("viewer", "admin")).toBe(false);
  });

  it("enforces a minimum password policy", () => {
    expect(passwordProblem("short")).toMatch(/12/);
    expect(passwordProblem("alllowercaseletters")).toMatch(/mix/);
    expect(passwordProblem("Correct-Horse-9")).toBeNull();
  });
});
