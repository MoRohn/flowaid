/**
 * Options for config fields with `x-ui.optionsProvider` (an agent preset, an MCP server and its
 * tools or prompts, an OpenAPI toolset and its operations), resolved in the browser from the
 * workspace's own lists: `/v1/agents`, `/v1/mcp/servers` (+ `/:id/tools`, `/:id/prompts`) and
 * `/v1/tools`. A field that depends on another (a server's tools) asks for that one first.
 */
import type { LoadOptions, OptionItem } from "@flowaid/ui/forms";
import { get, getAll } from "~/api/client";
import type { McpServer, Tool } from "~/admin/types";
import type { AgentPreset } from "~/agents/logic";

interface Named {
  name: string;
  title?: string;
  description?: string;
  source?: { kind: string; operationId?: string };
}

/** Where the options come from; the API by default, fakes in tests. */
export interface OptionSources {
  agents: () => Promise<Pick<AgentPreset, "id" | "name" | "description">[]>;
  mcpServers: () => Promise<Pick<McpServer, "id" | "name" | "status" | "toolCount">[]>;
  mcpTools: (serverId: string) => Promise<Named[]>;
  mcpPrompts: (serverId: string) => Promise<Named[]>;
  toolsets: () => Promise<Pick<Tool, "id" | "name" | "kind" | "definitions">[]>;
}

export const apiOptionSources: OptionSources = {
  agents: () => getAll<AgentPreset>("/v1/agents"),
  mcpServers: () => getAll<McpServer>("/v1/mcp/servers"),
  mcpTools: (id) => get<Named[]>(`/v1/mcp/servers/${encodeURIComponent(id)}/tools`),
  mcpPrompts: (id) => get<Named[]>(`/v1/mcp/servers/${encodeURIComponent(id)}/prompts`),
  toolsets: () => getAll<Tool>("/v1/tools"),
};

/** Keeps the options whose label, value or description contains the search, ignoring case. */
export function matchOptions(options: readonly OptionItem[], search: string): OptionItem[] {
  const q = search.trim().toLowerCase();
  if (!q) return [...options];
  return options.filter((o) =>
    [o.label, o.value, o.description ?? ""].some((t) => t.toLowerCase().includes(q)),
  );
}

/** A literal id another field of the config holds, or an error saying to choose it first. */
function chosen(config: Record<string, unknown>, key: string, what: string): string {
  const v = config[key];
  if (typeof v === "string" && v) return v;
  throw new Error(`Choose ${what} first.`);
}

const describe = (d: string | undefined) => (d ? { description: d } : {});

export function createLoadOptions(src: OptionSources = apiOptionSources): LoadOptions {
  const providers: Record<string, (config: Record<string, unknown>) => Promise<OptionItem[]>> = {
    agentPresets: async () =>
      (await src.agents()).map((a) => ({ value: a.id, label: a.name, ...describe(a.description) })),
    mcpServers: async () =>
      (await src.mcpServers()).map((s) => ({
        value: s.id,
        label: s.name,
        description:
          s.status === "connected"
            ? `${s.toolCount} ${s.toolCount === 1 ? "tool" : "tools"}`
            : `${s.status}: test it under Integrations`,
      })),
    mcpTools: async (config) =>
      (await src.mcpTools(chosen(config, "serverId", "a server"))).map((t) => ({
        value: t.name,
        label: t.name,
        ...describe(t.description),
      })),
    mcpPrompts: async (config) =>
      (await src.mcpPrompts(chosen(config, "serverId", "a server"))).map((p) => ({
        value: p.name,
        label: p.title ?? p.name,
        ...describe(p.description),
      })),
    openapiToolsets: async () =>
      (await src.toolsets())
        .filter((t) => t.kind === "openapi")
        .map((t) => ({
          value: t.id,
          label: t.name,
          description: `${t.definitions.length} ${t.definitions.length === 1 ? "operation" : "operations"}`,
        })),
    openapiOperations: async (config) => {
      const id = chosen(config, "toolsetId", "a toolset");
      const set = (await src.toolsets()).find((t) => t.id === id);
      if (!set) throw new Error("That toolset no longer exists. Choose another one.");
      return (set.definitions as Named[]).map((d) => {
        const op =
          d.source?.kind === "openapi" && d.source.operationId ? d.source.operationId : d.name;
        return { value: op, label: op, ...describe(d.description) };
      });
    },
  };
  return async (_nodeType, name, config, search) => {
    const provider = providers[name];
    if (!provider)
      throw new Error(
        `The builder cannot list “${name}” options. Enter the value under “Edit as JSON”.`,
      );
    return matchOptions(await provider(config), search);
  };
}
