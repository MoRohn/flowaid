/**
 * `flowaid import external <file>`: the FlowAId importer from the command line.
 *
 * - default: sends the export to the server (`POST /v1/workflows/import` with `external`), which
 *   translates, compiles and saves it, and prints the migration report;
 * - `--dry-run`: the report and diagnostics without saving (`POST /v1/workflows/import/preview`);
 * - `--local [--out f.json]`: translates on this machine, no server, and writes the definition.
 */
import type { Command } from "commander";
import { importExternalFlow, type ImportReport } from "@flowaid/importer";
import { client, type GlobalOptions } from "../config.js";
import type { CliIO } from "../io.js";
import { outputFormat, render } from "../values.js";

interface Flags {
  name?: string;
  dryRun?: boolean;
  local?: boolean;
  out?: string;
}

/** A readable summary of a migration report. */
export function describeReport(report: ImportReport): string[] {
  const c = report.counts;
  const lines = [
    `${report.workflowName} (${report.format === "agentflow" ? "agent flow" : "LangChain chat flow"}): ${c.imported} imported, ${c.converted} converted, ${c.needsConfig} need configuration, ${c.unsupported} unsupported`,
  ];
  for (const n of report.nodes)
    lines.push(
      `  ${n.status.padEnd(12)} ${n.sourceType} "${n.name}"${n.nodeId ? ` → ${n.nodeId}` : ""}${n.targetType ? ` (${n.targetType})` : ""}${n.message ? ` — ${n.message}` : ""}`,
    );
  for (const i of report.issues) lines.push(`  ${i.severity.padEnd(7)} ${i.code}  ${i.message}`);
  if (report.secrets.length) lines.push(`  secrets to bind: ${report.secrets.join(", ")}`);
  return lines;
}

export function registerImport(program: Command, io: CliIO): void {
  const imp = program.command("import").description("import workflows from other tools");
  imp
    .command("external")
    .description(
      "import an external flow export (agent flow or LangChain chat flow) with the FlowAId importer",
    )
    .argument("<file>", "the exported .json file")
    .option("--name <name>", "the new workflow's name")
    .option("--dry-run", "show the migration report and diagnostics without saving")
    .option("--local", "translate on this machine (no server) and write the definition")
    .option("--out <file>", "with --local: where to write the definition (default: stdout)")
    .action(async (file: string, o: Flags, self: Command) => {
      const g = self.optsWithGlobals<GlobalOptions>();
      const external = JSON.parse(await io.readText(file)) as unknown;
      if (o.local) {
        const { definition, report } = importExternalFlow(external, o.name ? { name: o.name } : {});
        if (o.out) {
          await io.writeFile(o.out, `${JSON.stringify(definition, null, 2)}\n`);
          for (const line of describeReport(report)) io.err(line);
          io.err(`wrote ${o.out}`);
        } else
          io.out(render(g.json || g.output ? { definition, report } : definition, outputFormat(g)));
        if (report.counts.unsupported > 0) process.exitCode = 1;
        return;
      }
      const fa = await client(io, g);
      const body = { external, ...(o.name ? { name: o.name } : {}) };
      const res = await fa.transport.request<{
        report: ImportReport;
        workflow?: { id: string; name: string };
        diagnostics: { severity: string; code: string; message: string }[];
      }>("POST", o.dryRun ? "/v1/workflows/import/preview" : "/v1/workflows/import", { body });
      if (g.json || g.output) {
        io.out(render(res, outputFormat(g)));
        return;
      }
      for (const line of describeReport(res.report)) io.out(line);
      const errors = res.diagnostics.filter((d) => d.severity === "error");
      for (const d of errors) io.out(`  error   ${d.code}  ${d.message}`);
      if (res.workflow) io.out(`created workflow ${res.workflow.id} "${res.workflow.name}"`);
      else io.out("dry run: nothing was saved");
    });
}
