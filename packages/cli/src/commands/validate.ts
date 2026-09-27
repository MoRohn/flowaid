/**
 * `flowaid validate <file|dir>`: compiles a definition locally against the bundled core nodes —
 * no server — and prints its diagnostics. Exit code 1 when there are errors.
 */
import type { Command } from "commander";
import type { GlobalOptions } from "../config.js";
import type { CliIO } from "../io.js";
import { compileLocally, loadDefinition } from "../local.js";
import { outputFormat, render } from "../values.js";

export function registerValidate(program: Command, io: CliIO): void {
  program
    .command("validate")
    .description("compile a workflow definition locally (bundled core nodes) and list diagnostics")
    .argument("<path>", ".json/.yaml file, or a package directory holding workflow.json")
    .option("--level <level>", "draft | publish", "publish")
    .action(async (path: string, o: { level: string }, self: Command) => {
      const g = self.optsWithGlobals<GlobalOptions>();
      if (o.level !== "draft" && o.level !== "publish")
        throw new Error("--level must be draft or publish");
      const result = compileLocally(await loadDefinition(io, path), o.level);
      if (g.json || g.output) io.out(render(result, outputFormat(g)));
      else {
        for (const d of result.diagnostics)
          io.out(
            `${d.severity.padEnd(7)} ${d.code}  ${d.message}${d.location.nodeId ? `  (node ${d.location.nodeId})` : ""}`,
          );
        io.out(result.ok ? `ok  planHash ${result.planHash ?? ""}` : "failed");
      }
      if (!result.ok) process.exitCode = 1;
    });
}
