/**
 * Test helpers: the workflow-core fixtures (MCP sentinels resolved to stable ids), a catalog over
 * the real core node manifests (read as data), and compiled plans.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { COMPILER_VERSION, compile } from "@flowaid/workflow-compiler";
import {
  NodeManifestSchema,
  ToolDefinitionSchema,
  type ExecutionPlan,
  type NodeCatalog,
  type NodeManifest,
  type ToolDefinition,
  type ToolSource,
} from "@flowaid/workflow-core";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, "../../../..");
export const FIXTURES = join(REPO, "packages/workflow-core/fixtures");

export const FIXTURE_NAMES = [
  "example-support-reply",
  "support-triage",
  "github-issue-triage",
  "research-agent",
  "variants/github-issue-triage.retrieval",
] as const;

const read = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

const idFor = (key: string) =>
  `00000000-0000-4000-8000-${Buffer.from(key).toString("hex").padEnd(12, "0").slice(0, 12)}`;

interface Resources {
  requiredResources: { kind: string; key: string; tools: { name: string }[] }[];
}

/** The template's resources (with tool signatures) from nodes-core; none for other fixtures. */
function resourcesOf(name: string): Resources {
  try {
    return read(join(REPO, "packages/nodes-core/templates", `${name}.resources.json`)) as Resources;
  } catch {
    return { requiredResources: [] };
  }
}

/** A fixture definition with `$template.mcp.<key>` sentinels replaced by stable server ids. */
export function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(join(FIXTURES, `${name}.json`), "utf8").replace(
      /"\$template\.mcp\.([a-z0-9_]+)"/g,
      (_m, key: string) => `"${idFor(key)}"`,
    ),
  );
}

export const coreManifests: NodeManifest[] = (
  read(join(REPO, "packages/nodes-core/manifest.json")) as { nodes: unknown[] }
).nodes.map((m) => NodeManifestSchema.parse(m));

export const catalog: NodeCatalog = {
  get: (id, version) =>
    version
      ? coreManifests.find((m) => m.id === id && m.version === version)
      : coreManifests.find((m) => m.id === id),
  list: () => [...coreManifests],
};

/** The fixture compiled against the core manifests (tools from its resources). */
export function planOf(name: string): ExecutionPlan {
  const resources = resourcesOf(name);
  const resolveTool = (source: ToolSource): ToolDefinition | undefined => {
    if (source.kind !== "mcp") return undefined;
    const r = resources.requiredResources.find((x) => idFor(x.key) === source.serverId);
    const tool = r?.tools.find((t) => t.name === source.tool);
    return tool ? ToolDefinitionSchema.parse({ ...tool, source }) : undefined;
  };
  const result = compile(fixture(name), {
    catalog,
    resolveTool,
    level: "publish",
    compilerVersion: COMPILER_VERSION,
  });
  if (!result.ok)
    throw new Error(
      `${name} does not compile: ${JSON.stringify(result.diagnostics.filter((d) => d.severity === "error"))}`,
    );
  return result.plan;
}
