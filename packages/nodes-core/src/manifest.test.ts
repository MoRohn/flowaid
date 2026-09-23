import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { toManifest } from "@flowaid/node-sdk";
import { NodeManifestSchema } from "@flowaid/workflow-core";
import { CORE_NODES } from "./index.js";
import { buildManifest, coreManifests } from "./manifest.js";

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../workflow-core/fixtures/manifests",
);
// flowaid.tools.mcp ships with @flowaid/mcp (P2-05).
const fixtureIds = readdirSync(FIXTURES)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.slice(0, -5))
  .filter((id) => id !== "flowaid.tools.mcp");

describe("core node manifests", () => {
  it.each(fixtureIds)("%s deep-equals the workflow-core fixture manifest", (id) => {
    const def = CORE_NODES.find((d) => d.id === id);
    if (!def) throw new Error(`${id} is not a core node`);
    const expected: unknown = JSON.parse(readFileSync(join(FIXTURES, `${id}.json`), "utf8"));
    expect(toManifest(def)).toEqual(expected);
  });

  it("every manifest parses against NodeManifestSchema", () => {
    for (const m of coreManifests())
      expect(NodeManifestSchema.safeParse(m).success, m.id).toBe(true);
  });

  it("ids are unique and flowaid-scoped", () => {
    const ids = CORE_NODES.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^flowaid\.[a-z_]+\.[a-z_]+$/);
  });

  it("decision nodes declare the typesafe and llm credential slots", () => {
    for (const def of CORE_NODES.filter((d) => d.decision && d.decision.kind !== "gate")) {
      const slots = (def.credentials ?? []).map((c) => c.name);
      expect(slots, def.id).toContain("typesafe");
      if (!["flowaid.decision.boolean", "flowaid.decision.choice"].includes(def.id))
        expect(slots, def.id).toContain("llm");
    }
  });

  it("the manifest build is reproducible with sorted keys", () => {
    const a = buildManifest();
    expect(buildManifest()).toBe(a);
    const parsed = JSON.parse(a) as { nodes: { id: string }[] };
    expect(Object.keys(parsed)).toEqual(["nodes", "package", "version"]);
    expect(parsed.nodes.map((n) => n.id)).toEqual([...parsed.nodes.map((n) => n.id)].sort());
    expect(parsed.nodes).toHaveLength(CORE_NODES.length);
  });
});
