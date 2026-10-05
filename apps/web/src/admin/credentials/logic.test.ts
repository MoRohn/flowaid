import { describe, expect, it } from "vitest";
import type { CredentialType } from "../types";
import {
  ALL_ENVIRONMENTS,
  credentialBody,
  credentialChecks,
  emptyCredentialDraft,
  externalRefProblem,
  keptDraft,
  providerCredentialType,
  serverKeyProvider,
  serviceGroup,
  type CredentialContext,
  type CredentialDraft,
} from "./logic";

const openai: CredentialType = {
  id: "openai.api_key",
  name: "OpenAI API key",
  description: "",
  fields: [
    { name: "apiKey", secret: true, required: true, schema: { type: "string" } },
    { name: "baseUrl", secret: false, required: false, schema: { type: "string", format: "uri" } },
  ],
  scopes: [],
  testSupported: true,
};
const bearer: CredentialType = {
  id: "http.bearer",
  name: "Bearer token",
  description: "",
  fields: [{ name: "token", secret: true, required: true, schema: { type: "string" } }],
  scopes: [],
  testSupported: false,
};

const ctx = (over: Partial<CredentialContext> = {}): CredentialContext => ({
  type: openai,
  serverHasKey: () => false,
  existingNames: [],
  envName: (id) => (id === "env-prod" ? "prod" : id),
  canUseExternal: true,
  ...over,
});

const filled = (over: Partial<CredentialDraft> = {}): CredentialDraft => ({
  ...emptyCredentialDraft("openai.api_key"),
  name: "OpenAI (prod)",
  values: { apiKey: "sk-live-123456789", baseUrl: "https://llm.example.com/v1" },
  ...over,
});

const ids = (d: CredentialDraft, c = ctx()) =>
  credentialChecks(d, c).map((x) => `${x.state}:${x.id}`);

describe("keptDraft", () => {
  it("strips secret values but keeps the rest", () => {
    const kept = keptDraft(filled(), [openai]);
    expect(kept.values).toEqual({ baseUrl: "https://llm.example.com/v1" });
    expect(JSON.stringify(kept)).not.toContain("sk-live");
    expect(kept.name).toBe("OpenAI (prod)");
  });

  it("keeps no values at all for an unknown type", () => {
    expect(keptDraft(filled({ typeId: "gone.type" }), [openai]).values).toEqual({});
  });
});

describe("credentialChecks", () => {
  it("asks for the service first", () => {
    expect(ids(emptyCredentialDraft(), ctx({ type: undefined }))).toEqual(["blocker:type"]);
  });

  it("blocks on a missing name, missing required fields and a taken name", () => {
    expect(ids(filled({ name: "", values: {} }))).toEqual(
      expect.arrayContaining(["blocker:name", "blocker:fields"]),
    );
    expect(ids(filled(), ctx({ existingNames: ["OpenAI (prod)"] }))).toContain("blocker:name");
  });

  it("passes a complete draft and says it will be tested", () => {
    expect(ids(filled())).toEqual(["ok:valid", "info:test"]);
  });

  it("notes the server's own key and an environment limit", () => {
    const out = ids(filled({ env: "env-prod" }), ctx({ serverHasKey: (p) => p === "openai" }));
    expect(out).toEqual(expect.arrayContaining(["info:server-key", "info:env"]));
    expect(
      credentialChecks(filled({ env: "env-prod" }), ctx()).find((c) => c.id === "env")?.message,
    ).toContain("Only prod");
  });

  it("says a type without a test is only proven by its first run", () => {
    const d = { ...filled(), typeId: "http.bearer", values: { token: "t" } };
    expect(ids(d, ctx({ type: bearer }))).toContain("info:no-test");
  });

  it("checks external references and who may use them", () => {
    const ext = filled({ storage: "external", values: {}, externalRef: "vault://x#y" });
    expect(ids(ext)).toContain("blocker:ref");
    expect(ids({ ...ext, externalRef: "vault:secret/data/openai#apiKey" })).toEqual(
      expect.arrayContaining(["ok:valid", "info:ref-read", "info:no-test"]),
    );
    expect(
      ids({ ...ext, externalRef: "env:FLOWAID_SECRET_X" }, ctx({ canUseExternal: false })),
    ).toContain("blocker:external");
  });

  it("requires a workflow once the list is limited", () => {
    expect(ids(filled({ allowedWorkflowIds: [] }))).toContain("blocker:workflows");
    expect(ids(filled({ allowedWorkflowIds: ["wf-1"] }))).not.toContain("blocker:workflows");
  });
});

describe("externalRefProblem", () => {
  it("accepts the server's schemes and explains the rest", () => {
    expect(externalRefProblem("env:FLOWAID_SECRET_OPENAI")).toBeUndefined();
    expect(externalRefProblem("vault:secret/data/openai#apiKey")).toBeUndefined();
    expect(externalRefProblem("gcp-sm:projects/p/secrets/s/versions/latest")).toBeUndefined();
    expect(externalRefProblem("")).toBe("Enter the reference");
    expect(externalRefProblem("s3://bucket/key")).toMatch(/Start with env:/);
    expect(externalRefProblem("env:OPENAI_API_KEY")).toMatch(/FLOWAID_SECRET_/);
    expect(externalRefProblem("vault:secret/data/openai")).toMatch(/after #/);
  });
});

describe("credentialBody", () => {
  it("sends only filled values, the environment and the workflow limit", () => {
    expect(
      credentialBody(
        filled({
          values: { apiKey: "sk", baseUrl: " " },
          env: "env-prod",
          allowedWorkflowIds: ["wf-1"],
        }),
      ),
    ).toEqual({
      name: "OpenAI (prod)",
      type: "openai.api_key",
      storage: "db",
      values: { apiKey: "sk" },
      environmentId: "env-prod",
      allowedWorkflowIds: ["wf-1"],
    });
    const ext = credentialBody(
      filled({ storage: "external", externalRef: " env:FLOWAID_SECRET_A ", env: ALL_ENVIRONMENTS }),
    );
    expect(ext).toEqual({
      name: "OpenAI (prod)",
      type: "openai.api_key",
      storage: "external",
      externalRef: "env:FLOWAID_SECRET_A",
      environmentId: null,
    });
  });
});

describe("service grouping", () => {
  it("groups types by what they are for, and knows which have a server key", () => {
    expect(serviceGroup("typesafe.api_key")).toBe("models");
    expect(serviceGroup("oauth2.client_credentials")).toBe("http");
    expect(serviceGroup("github.token")).toBe("tools");
    expect(serverKeyProvider("anthropic.api_key")).toBe("anthropic");
    expect(serverKeyProvider("ollama.none")).toBe("ollama");
    expect(serverKeyProvider("google.api_key")).toBeUndefined();
  });

  it("opens New credential on a provider's key type from Providers", () => {
    expect(providerCredentialType("openai")).toBe("openai.api_key");
    expect(providerCredentialType("anthropic")).toBe("anthropic.api_key");
    expect(providerCredentialType("ollama")).toBe("ollama.host");
  });
});
