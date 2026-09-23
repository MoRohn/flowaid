/** Demo template instantiation for tests: sentinels become fixed server ids, tools come from fixtures/mcp-tools.json. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ToolDefinitionSchema, type ToolDefinition, type ToolSource } from "@flowaid/workflow-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOLS: Record<string, unknown> = JSON.parse(
  readFileSync(join(HERE, "../../fixtures/mcp-tools.json"), "utf8"),
) as Record<string, unknown>;

/** A fixed, readable uuid per resource key (so plans are stable). */
export function serverIdFor(key: string): string {
  const hex = [...key]
    .map((c) => c.charCodeAt(0).toString(16))
    .join("")
    .padEnd(12, "0")
    .slice(0, 12);
  return `00000000-0000-4000-8000-${hex}`;
}

export const DEMOS = ["support-triage", "github-issue-triage", "research-agent"] as const;

/** Rewrites `$template.mcp.<key>` sentinels the way template instantiation does. */
export function instantiate(definition: unknown): unknown {
  return JSON.parse(
    JSON.stringify(definition).replace(
      /"\$template\.mcp\.([a-z0-9_]+)"/g,
      (_m, key: string) => `"${serverIdFor(key)}"`,
    ),
  );
}

export function resolveTool(source: ToolSource): ToolDefinition | undefined {
  if (source.kind !== "mcp") return undefined;
  for (const [key, tools] of Object.entries(TOOLS)) {
    if (key.startsWith("$") || serverIdFor(key) !== source.serverId || !Array.isArray(tools))
      continue;
    const tool = (tools as { name?: string }[]).find((t) => t.name === source.tool);
    if (tool) return ToolDefinitionSchema.parse({ ...tool, source });
  }
  return undefined;
}
