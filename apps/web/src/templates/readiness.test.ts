import { describe, expect, it } from "vitest";
import type { TemplateRow } from "~/admin/types";
import { templateNeeds } from "./readiness";

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

  it("a required secret needs a bound credential even when the server has the key", () => {
    const [need] = templateNeeds(
      row({ requiredSecrets: [{ name: "TYPESAFE_API_KEY", credentialType: "typesafe.api_key" }] }),
      have,
    );
    expect(need?.ready).toBe(false);
    expect(need?.detail).toMatch(/not used for a required secret/);
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
