/**
 * The shipped templates (`packages/nodes-core/templates`) compile with zero errors against the real
 * core node manifests (`packages/nodes-core/manifest.json`, read as data — the compiler never imports
 * nodes-core), with tools resolved from each template's `requiredResources`.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  NodeManifestSchema,
  ToolDefinitionSchema,
  type ToolDefinition,
  type ToolSource,
} from "@flowaid/workflow-core";
import { describe, expect, it } from "vitest";
import { compile } from "./index.js";
import { catalogOf, readJson } from "./test/support.js";

const NODES_CORE = join(dirname(fileURLToPath(import.meta.url)), "../../nodes-core");
const read = (...p: string[]): unknown => JSON.parse(readFileSync(join(NODES_CORE, ...p), "utf8"));

// flowaid.tools.mcp ships with @flowaid/mcp (P2-05); until then its fixture manifest stands in.
const manifests = [
  ...(read("manifest.json") as { nodes: unknown[] }).nodes,
  readJson("manifests", "flowaid.tools.mcp.json"),
].map((m) => NodeManifestSchema.parse(m));
const catalog = catalogOf(manifests);

const templates = readdirSync(join(NODES_CORE, "templates"))
  .filter((f) => f.endsWith(".json") && !f.endsWith(".resources.json"))
  .map((f) => f.slice(0, -5));

interface Resources {
  requiredResources: { kind: string; key: string; tools: { name: string }[] }[];
}

describe.each(templates)("template %s", (name) => {
  const resources = read("templates", `${name}.resources.json`) as Resources;
  const idFor = (key: string) =>
    `00000000-0000-4000-8000-${Buffer.from(key).toString("hex").padEnd(12, "0").slice(0, 12)}`;
  const definition = JSON.parse(
    readFileSync(join(NODES_CORE, "templates", `${name}.json`), "utf8").replace(
      /"\$template\.mcp\.([a-z0-9_]+)"/g,
      (_m, key: string) => `"${idFor(key)}"`,
    ),
  ) as unknown;
  const resolveTool = (source: ToolSource): ToolDefinition | undefined => {
    if (source.kind !== "mcp") return undefined;
    const resource = resources.requiredResources.find((r) => idFor(r.key) === source.serverId);
    const tool = resource?.tools.find((t) => t.name === source.tool);
    return tool ? ToolDefinitionSchema.parse({ ...tool, source }) : undefined;
  };

  it("compiles with zero errors against the core manifests", () => {
    const result = compile(definition, { catalog, resolveTool });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.ok).toBe(true);
  });
});
