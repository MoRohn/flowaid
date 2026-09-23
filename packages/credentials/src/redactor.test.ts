import { loadEnv, secretEnvValues } from "@flowaid/env";
import type { JsonValue } from "@flowaid/workflow-core";
import { describe, expect, it } from "vitest";
import { DROPPED, REDACTED, Redactor, applyRule, hashValue, secretVariants } from "./redactor.js";
import { CREDENTIAL_TYPES, CredentialTypeCatalog, secretFields } from "./types/catalog.js";

describe("Redactor: learned secrets", () => {
  const redactor = new Redactor().learn(["sk-live-4f9a", "ab", "p@ss word/1"]);

  it("scrubs raw, base64, base64url and URL-encoded forms anywhere in nested JSON", () => {
    const b64 = Buffer.from("sk-live-4f9a").toString("base64");
    const input: JsonValue = {
      header: "Bearer sk-live-4f9a",
      nested: [
        { auth: `Basic ${b64}` },
        { url: `https://x/?pw=${encodeURIComponent("p@ss word/1")}` },
      ],
      "sk-live-4f9a": 1,
      n: 5,
    };
    expect(redactor.redactJson(input)).toEqual({
      header: `Bearer ${REDACTED}`,
      nested: [{ auth: `Basic ${REDACTED}` }, { url: `https://x/?pw=${REDACTED}` }],
      [REDACTED]: 1,
      n: 5,
    });
  });

  it("ignores values shorter than 4 characters and learns variants once", () => {
    expect(redactor.redactText("ab cd")).toBe("ab cd");
    expect(secretVariants("hello")).toContain(Buffer.from("hello").toString("base64url"));
    const size = redactor.size;
    redactor.learn(["sk-live-4f9a"]);
    expect(redactor.size).toBe(size);
    expect(new Redactor().redactJson({ a: "x" })).toEqual({ a: "x" });
  });

  it("learns the secret values of a loaded environment", () => {
    const env = loadEnv({
      NODE_ENV: "development",
      DATABASE_URL: "postgres://flowaid:db-password-42@localhost:5432/flowaid",
      TYPESAFE_API_KEY: "ts-key-0123456789",
      FLOWAID_SECRET_CRM: "crm-secret-value",
    });
    const r = new Redactor().learn(secretEnvValues(env));
    expect(r.redactText("key ts-key-0123456789 pw db-password-42 crm crm-secret-value")).toBe(
      `key ${REDACTED} pw ${REDACTED} crm ${REDACTED}`,
    );
  });
});

describe("Redactor: pointer rules", () => {
  const record = {
    in: {
      state: { message: "My card is 4242", tier: "gold" },
      items: [{ email: "a@x.io" }, { email: "b@x.io" }],
    },
    out: { text: "reply", usage: { inputTokens: 3 } },
  };

  it("masks pii, hashes sensitive values and drops doNotPersist outputs", () => {
    const out = new Redactor().apply(record, [
      { pointer: "/in/state/message", dataClass: "pii", mode: "mask" },
      { pointer: "/in/items/*/email", dataClass: "pii", mode: "mask" },
      { pointer: "/in/state/tier", dataClass: "sensitive", mode: "hash" },
      { pointer: "/out", dataClass: "sensitive", mode: "drop" },
    ]);
    expect(out).toEqual({
      in: {
        state: { message: REDACTED, tier: hashValue("gold") },
        items: [{ email: REDACTED }, { email: REDACTED }],
      },
      out: DROPPED,
    });
    expect(hashValue({ a: 1 })).toMatch(/^sha256:[0-9a-f]{16}$/);
  });

  it("leaves missing paths alone and supports escaped tokens and indexes", () => {
    expect(applyRule({ a: 1 }, { pointer: "/in/nothing", dataClass: "pii", mode: "mask" })).toEqual(
      { a: 1 },
    );
    expect(
      applyRule({ in: { "a/b": "x" } }, { pointer: "/in/a~1b", dataClass: "pii", mode: "mask" }),
    ).toEqual({ in: { "a/b": REDACTED } });
    expect(applyRule({ in: [1, 2] }, { pointer: "/in/1", dataClass: "pii", mode: "mask" })).toEqual(
      { in: [1, REDACTED] },
    );
    expect(applyRule({ in: [1, 2] }, { pointer: "/in/7", dataClass: "pii", mode: "mask" })).toEqual(
      { in: [1, 2] },
    );
    expect(
      applyRule({ in: { k: { a: 1 } } }, { pointer: "/in/*/a", dataClass: "pii", mode: "mask" }),
    ).toEqual({ in: { k: { a: REDACTED } } });
    expect(applyRule({ in: "text" }, { pointer: "/in/x", dataClass: "pii", mode: "mask" })).toEqual(
      { in: "text" },
    );
  });
});

describe("credential type catalog", () => {
  it("covers the WP-06 types plus google.api_key, and marks secret fields", () => {
    const ids = CREDENTIAL_TYPES.map((t) => t.id);
    for (const id of [
      "typesafe.api_key",
      "openai.api_key",
      "anthropic.api_key",
      "google.api_key",
      "ollama.host",
      "http.bearer",
      "http.basic",
      "http.api_key",
      "http.header",
      "oauth2.client_credentials",
      "mcp.headers",
      "github.token",
      "aws.iam",
      "postgres.dsn",
    ]) {
      expect(ids).toContain(id);
    }
    const catalog = new CredentialTypeCatalog();
    const byId = (id: string) => {
      const type = catalog.get(id);
      if (!type) throw new Error(`missing ${id}`);
      return type;
    };
    expect(secretFields(byId("http.basic"))).toEqual(["password"]);
    expect(secretFields(byId("aws.iam"))).toEqual(["secretAccessKey", "sessionToken"]);
    expect(() => catalog.register(byId("http.basic"))).toThrow(/already registered/);
    catalog.register({ ...byId("http.basic"), id: "acme.key" });
    expect(catalog.list().map((t) => t.id)).toContain("acme.key");
  });

  it("probes a credential and reports ok, rejection and unreachable without throwing", async () => {
    const signal = new AbortController().signal;
    const typesafe = CREDENTIAL_TYPES.find((t) => t.id === "typesafe.api_key");
    const seen: string[] = [];
    const ok = await typesafe?.test?.(
      { apiKey: "k" },
      (url, init) => (
        seen.push(`${url} ${(init?.headers as Record<string, string>).authorization}`),
        Promise.resolve(new Response("{}"))
      ),
      signal,
    );
    expect(ok).toEqual({ ok: true });
    expect(seen).toEqual(["https://api.typesafe.ai/v1/models Bearer k"]);
    expect(
      await typesafe?.test?.(
        { apiKey: "k" },
        () => Promise.resolve(new Response("", { status: 401 })),
        signal,
      ),
    ).toMatchObject({ ok: false, message: expect.stringContaining("rejected") as unknown });
    expect(
      await typesafe?.test?.(
        { apiKey: "k" },
        () => Promise.resolve(new Response("", { status: 500 })),
        signal,
      ),
    ).toMatchObject({ ok: false });
    expect(
      await typesafe?.test?.(
        { apiKey: "k" },
        () => Promise.reject(new Error("ECONNREFUSED")),
        signal,
      ),
    ).toMatchObject({ ok: false, message: expect.stringContaining("ECONNREFUSED") as unknown });
    for (const id of [
      "openai.api_key",
      "anthropic.api_key",
      "google.api_key",
      "ollama.host",
      "github.token",
    ]) {
      const type = CREDENTIAL_TYPES.find((t) => t.id === id);
      expect(
        await type?.test?.(
          { apiKey: "k", host: "http://ollama:11434", token: "t" },
          () => Promise.resolve(new Response("{}")),
          signal,
        ),
        id,
      ).toEqual({ ok: true });
    }
  });

  it("exchanges client credentials to test OAuth 2.0", async () => {
    const oauth = CREDENTIAL_TYPES.find((t) => t.id === "oauth2.client_credentials");
    const value = { tokenUrl: "https://id/token", clientId: "c", clientSecret: "s", scope: "read" };
    const signal = new AbortController().signal;
    expect(
      await oauth?.test?.(
        value,
        () => Promise.resolve(Response.json({ access_token: "a" })),
        signal,
      ),
    ).toEqual({ ok: true });
    expect(
      await oauth?.test?.(value, () => Promise.resolve(Response.json({})), signal),
    ).toMatchObject({ ok: false });
    expect(
      await oauth?.test?.(value, () => Promise.resolve(new Response("", { status: 400 })), signal),
    ).toMatchObject({ ok: false });
    expect(
      await oauth?.test?.(value, () => Promise.reject(new Error("down")), signal),
    ).toMatchObject({ ok: false });
  });
});
