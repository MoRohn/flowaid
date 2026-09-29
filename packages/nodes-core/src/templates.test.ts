import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ToolDefinitionSchema } from "@flowaid/workflow-core";
import { ANSWER_INSTRUCTIONS } from "@flowaid/pageindex";
import { buildManifest } from "./manifest.js";
import { coreManifests } from "./manifestFile.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATES = join(ROOT, "templates");
const FIXTURES = join(ROOT, "../workflow-core/fixtures");
/** the §11 demos live in fixtures/, variants and the retrieval templates under fixtures/variants */
const fixtureOf = (name: string) =>
  existsSync(join(FIXTURES, `${name}.json`))
    ? join(FIXTURES, `${name}.json`)
    : join(FIXTURES, "variants", `${name}.json`);
const names = readdirSync(TEMPLATES)
  .filter((f) => f.endsWith(".json") && !f.endsWith(".resources.json"))
  .map((f) => f.slice(0, -5));

describe("templates", () => {
  it("ships the starter, the four business flows, the three demos, the retrieval variant of the GitHub triage and the PageIndex templates", () => {
    expect(names.sort()).toEqual([
      "expense-approval",
      "github-issue-triage",
      "github-issue-triage.retrieval",
      "it-helpdesk-routing",
      "lead-qualification",
      "message-triage",
      "pageindex-agent",
      "pageindex-compare",
      "pageindex-document-qa",
      "refund-requests",
      "research-agent",
      "support-triage",
    ]);
  });

  it("the PageIndex answer templates carry the answer instructions checkCitations reads", () => {
    for (const name of ["pageindex-document-qa", "pageindex-compare"]) {
      const def = JSON.parse(readFileSync(join(TEMPLATES, `${name}.json`), "utf8")) as {
        nodes: { id: string; config?: { system?: string } }[];
      };
      const system = def.nodes.find((n) => n.id === "answer")?.config?.system ?? "";
      expect(system, name).toContain(ANSWER_INSTRUCTIONS);
    }
  });

  it.each(names)("%s stays in sync with the workflow-core fixture", (name) => {
    expect(readFileSync(join(TEMPLATES, `${name}.json`), "utf8")).toBe(
      readFileSync(fixtureOf(name), "utf8"),
    );
  });

  it.each(names)(
    "%s lists exactly the resources its sentinels need, with valid tool signatures",
    (name) => {
      const source = readFileSync(join(TEMPLATES, `${name}.json`), "utf8");
      const sentinels = [
        ...new Set(
          [...source.matchAll(/\$template\.(?:mcp|knowledge)\.([a-z0-9_]+)/g)].map((m) => m[1]),
        ),
      ].sort();
      const resources = JSON.parse(
        readFileSync(join(TEMPLATES, `${name}.resources.json`), "utf8"),
      ) as {
        id: string;
        requiredResources: { kind: string; key: string; tools?: unknown[] }[];
      };
      expect(resources.id).toBe(name);
      expect(resources.requiredResources.map((r) => r.key).sort()).toEqual(sentinels);
      for (const r of resources.requiredResources)
        for (const tool of r.tools ?? [])
          expect(() =>
            ToolDefinitionSchema.parse({
              ...(tool as object),
              source: { kind: "mcp", serverId: "00000000-0000-4000-8000-000000000000", tool: "x" },
            }),
          ).not.toThrow();
    },
  );
});

describe("manifest.json", () => {
  it("is up to date (pnpm --filter @flowaid/nodes-core manifest)", () => {
    expect(readFileSync(join(ROOT, "manifest.json"), "utf8")).toBe(buildManifest());
  });

  it("is what @flowaid/nodes-core/manifest exports", () => {
    expect(coreManifests.map((m) => m.id)).toContain("flowaid.decision.consensus");
  });
});
