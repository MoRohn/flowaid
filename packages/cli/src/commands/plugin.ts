/**
 * `flowaid plugin search|add|enable|disable` (ARCHITECTURE.md §3.5). `search` queries the npm
 * registry directly (`--registry`, `FLOWAID_PLUGIN_REGISTRY`, default npmjs) for packages with the
 * `flowaid-node` keyword; `add` asks the server to install (the server checks the allow-list, the
 * SDK range and the tarball integrity; `--frozen <sri>` pins it); `enable`/`disable` take a package
 * name or plugin id. `plugin list`, `install`, `update`, `remove` and `discover` are the generated
 * API commands.
 */
import type { Command } from "commander";
import { RegistryClient, parsePluginSpec, type SearchResult } from "@flowaid/plugins";
import { client, type GlobalOptions } from "../config.js";
import type { CliIO } from "../io.js";
import { outputFormat, render } from "../values.js";

export const DEFAULT_REGISTRY = "https://registry.npmjs.org";

interface PluginView {
  id: string;
  packageName: string;
  version: string;
  status: string;
  scope: string;
  integrity: string | null;
  nodes: { id: string }[];
}

function table(rows: SearchResult[]): string[] {
  if (rows.length === 0) return ["no packages found (keyword flowaid-node)"];
  const w = Math.max(4, ...rows.map((r) => r.name.length));
  return [
    `${"NAME".padEnd(w)}  ${"VERSION".padEnd(9)}  DESCRIPTION`,
    ...rows.map(
      (r) => `${r.name.padEnd(w)}  ${r.version.padEnd(9)}  ${r.description.slice(0, 80)}`,
    ),
  ];
}

export function registerPluginCommands(plugin: Command, io: CliIO): void {
  plugin
    .command("search")
    .description("search the npm registry for FlowAId node packages (keyword flowaid-node)")
    .argument("[query...]", "words to match")
    .option("--registry <url>", "npm registry (env FLOWAID_PLUGIN_REGISTRY)")
    .option("--size <n>", "maximum results", "20")
    .action(async (query: string[], o: { registry?: string; size: string }, self: Command) => {
      const g = self.optsWithGlobals<GlobalOptions>();
      const registry = new RegistryClient({
        registry: o.registry ?? io.env.FLOWAID_PLUGIN_REGISTRY ?? DEFAULT_REGISTRY,
        ...(io.fetch ? { fetch: io.fetch } : {}),
      });
      const results = await registry.search(query.join(" "), Number(o.size) || 20);
      if (g.json || g.output) io.out(render(results, outputFormat(g)));
      else for (const line of table(results)) io.out(line);
    });

  plugin
    .command("add")
    .description("install a node package on the server: <name>[@version|range]")
    .argument("<spec>", "e.g. @acme/nodes-crm@^1.2.0")
    .option(
      "--frozen <integrity>",
      "refuse unless the tarball's integrity is exactly this (sha512-…)",
    )
    .option(
      "--local <dir>",
      "install from a directory on the server host (FLOWAID_PLUGIN_ALLOW_LOCAL)",
    )
    .action(async (spec: string, o: { frozen?: string; local?: string }, self: Command) => {
      const g = self.optsWithGlobals<GlobalOptions>();
      const { name, range } = parsePluginSpec(spec);
      const fa = await client(io, g);
      const res = await fa.transport.request<{
        plugin: PluginView;
        workerRestartRequired: boolean;
      }>("POST", "/v1/plugins", {
        body: {
          packageName: name,
          version: range,
          ...(o.local ? { source: "local", path: o.local } : {}),
          ...(o.frozen ? { integrity: o.frozen } : {}),
        },
      });
      if (g.json || g.output) io.out(render(res, outputFormat(g)));
      else {
        io.out(
          `installed ${res.plugin.packageName}@${res.plugin.version} (${res.plugin.nodes.length} node${res.plugin.nodes.length === 1 ? "" : "s"}) ${res.plugin.integrity ?? ""}`.trim(),
        );
        if (res.workerRestartRequired) io.out("restart the workers to load it");
      }
    });

  for (const status of ["enable", "disable"] as const) {
    plugin
      .command(status)
      .description(`${status} a plugin by package name or id`)
      .argument("<plugin>", "package name or plugin id")
      .action(async (ref: string, _o: unknown, self: Command) => {
        const g = self.optsWithGlobals<GlobalOptions>();
        const fa = await client(io, g);
        const list = await fa.transport.request<PluginView[]>("GET", "/v1/plugins");
        const found = list.find((p) => p.id === ref || p.packageName === ref);
        if (!found) throw new Error(`no plugin ${ref} is installed`);
        const res = await fa.transport.request<{ plugin: PluginView }>(
          "PATCH",
          `/v1/plugins/${found.id}`,
          {
            body: { status: status === "enable" ? "enabled" : "disabled" },
          },
        );
        if (g.json || g.output) io.out(render(res, outputFormat(g)));
        else
          io.out(
            `${res.plugin.packageName} is ${res.plugin.status}; restart the workers to apply it`,
          );
      });
  }
}
