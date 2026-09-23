import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ToolDefinitionSchema } from "@flowaid/workflow-core";
import { buildManifest } from "./manifest.js";
import { coreManifests } from "./manifestFile.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATES = join(ROOT, "templates");
const FIXTURES = join(ROOT, "../workflow-core/fixtures");
const names = readdirSync(TEMPLATES)
  .filter((f) => f.endsWith(".json") && !f.endsWith(".resources.json"))
  .map((f) => f.slice(0, -5));

describe("templates", () => {
  it("ships the three demos", () => {
    expect(names.sort()).toEqual(["github-issue-triage", "research-agent", "support-triage"]);
  });

  it.each(names)("%s stays in sync with the workflow-core fixture", (name) => {
    expect(readFileSync(join(TEMPLATES, `${name}.json`), "utf8")).toBe(
      readFileSync(join(FIXTURES, `${name}.json`), "utf8"),
    );
  });

  it.each(names)(
    "%s lists exactly the resources its sentinels need, with valid tool signatures",
    (name) => {
      const source = readFileSync(join(TEMPLATES, `${name}.json`), "utf8");
      const sentinels = [
        ...new Set([...source.matchAll(/\$template\.mcp\.([a-z0-9_]+)/g)].map((m) => m[1])),
      ].sort();
      const resources = JSON.parse(
        readFileSync(join(TEMPLATES, `${name}.resources.json`), "utf8"),
      ) as {
        id: string;
        requiredResources: { kind: string; key: string; tools: unknown[] }[];
      };
      expect(resources.id).toBe(name);
      expect(resources.requiredResources.map((r) => r.key).sort()).toEqual(sentinels);
      for (const r of resources.requiredResources)
        for (const tool of r.tools)
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
