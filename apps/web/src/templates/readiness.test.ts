import { describe, expect, it } from "vitest";
import type { TemplateRow } from "~/admin/types";
import { templateChecks, templateNeeds } from "./readiness";

const row = (over: Partial<TemplateRow>): TemplateRow => ({
  id: "t",
  slug: "t",
  name: "T",
  description: "",
  category: "support",
  builtIn: true,
  requiredResources: null,
  requiredSecrets: null,
  ...over,
});
const have = {
  keys: { server: { typesafe: true }, saved: [] },
  mcpServers: 0,
  knowledgeSources: 0,
};

describe("templateNeeds", () => {
  it("an optional TypeSafe secret runs on the server's key", () => {
    const needs = templateNeeds(
      row({
        requiredSecrets: [
          { name: "TYPESAFE_API_KEY", credentialType: "typesafe.api_key", required: false },
        ],
      }),
      have,
    );
    expect(needs).toEqual([
      { label: "TypeSafe API key", ready: true, detail: "uses the key set on this server" },
    ]);
  });

  it("a required secret runs on the server's key too", () => {
    const needs = templateNeeds(
      row({ requiredSecrets: [{ name: "TYPESAFE_API_KEY", credentialType: "typesafe.api_key" }] }),
      have,
    );
    expect(needs).toEqual([
      { label: "TypeSafe API key", ready: true, detail: "uses the key set on this server" },
    ]);
  });

  it("a required secret the server has no key for needs a credential or a server key", () => {
    const [need] = templateNeeds(
      row({ requiredSecrets: [{ name: "OPENAI_API_KEY", credentialType: "openai.api_key" }] }),
      { ...have, keys: { server: {}, saved: [] } },
    );
    expect(need?.ready).toBe(false);
    expect(need?.detail).toMatch(/or set the key in the server's environment/);
  });

  it("lists MCP servers and documents the workspace does not have yet", () => {
    const needs = templateNeeds(
      row({
        requiredResources: {
          mcpServers: [{ key: "github" }],
          knowledgeSources: [{ key: "documents" }],
        },
      }),
      have,
    );
    expect(needs.map((n) => [n.label, n.ready])).toEqual([
      ["MCP server (github)", false],
      ["Documents", false],
    ]);
  });
});

describe("templateChecks", () => {
  const slots = [
    { key: "github", kind: "mcpServers" as const },
    { key: "documents", kind: "knowledgeSources" as const },
  ];
  const name = (id: string) => (id === "m1" ? "GitHub tools" : undefined);
  const key = { label: "TypeSafe API key", ready: true, detail: "uses the key set on this server" };
  const mcp = (ready: boolean) => ({
    label: "MCP server (github)",
    ready,
    detail: ready ? "choose which one when you create it" : "connect one under Integrations",
    ...(ready ? {} : { where: "integrations" as const }),
  });

  it("warns about what is missing, never blocks, and points at the fix", () => {
    const { checks, ready } = templateChecks([key, mcp(false)], slots, {}, name);
    expect(ready).toBe(false);
    expect(checks.map((c) => [c.id, c.state])).toEqual([
      ["need:TypeSafe API key", "ok"],
      ["need:MCP server (github)", "warning"],
    ]);
    expect(checks[1]?.where).toBe("integrations");
  });

  it("asks which server once servers exist, and is ready when one is chosen", () => {
    expect(templateChecks([key, mcp(true)], slots, {}, name).checks[1]).toMatchObject({
      id: "slot:github",
      state: "warning",
    });
    const { checks, ready } = templateChecks([key, mcp(true)], slots, { github: "m1" }, name);
    expect(ready).toBe(true);
    expect(checks[1]?.label).toBe("MCP server for github: GitHub tools");
  });

  it("points each missing need at the page that sets it up", () => {
    const [secret, mcp, docs] = templateNeeds(
      row({
        requiredSecrets: [{ name: "OPENAI_API_KEY", credentialType: "openai.api_key" }],
        requiredResources: { mcpServers: [{ key: "gh" }], knowledgeSources: [{ key: "docs" }] },
      }),
      have,
    );
    expect([secret?.where, mcp?.where, docs?.where]).toEqual([
      "credentials",
      "integrations",
      "knowledge",
    ]);
  });
});
