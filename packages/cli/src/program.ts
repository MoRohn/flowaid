/**
 * The `flowaid` command tree: global connection and output options, the generated noun/verb
 * commands for every API operation, and the hand-written commands (API.md §8.3). Hand-written
 * commands replace the generated verb of the same name (`HAND_WRITTEN`).
 */
import { Command } from "commander";
import { FlowaidApiError } from "@flowaid/workflow-sdk";
import { registerDev } from "./commands/dev.js";
import { registerImport } from "./commands/import.js";
import { registerLogin } from "./commands/login.js";
import { registerPluginCommands } from "./commands/plugin.js";
import { registerRunCommands } from "./commands/runs.js";
import { registerValidate } from "./commands/validate.js";
import { registerWorkflowCommands } from "./commands/workflow.js";
import { registerOperations } from "./generatedCommands.js";
import type { CliIO } from "./io.js";

export const CLI_VERSION = "0.7.0";

/**
 * Generated verbs a hand-written command takes over: the export/stream operations need the
 * version mapping and the resumable SSE transport the generic runner lacks.
 */
export const HAND_WRITTEN: ReadonlySet<string> = new Set([
  "workflow export",
  "workflow package",
  "run events",
  "run stream",
]);

export function createProgram(io: CliIO): Command {
  const program = new Command("flowaid")
    .description("FlowAId command line: every API operation, plus local runs and the dev stack")
    // `--version` belongs to subcommands (`workflow export --version 3`); the CLI's own is -V.
    .version(CLI_VERSION, "-V, --cli-version", "print the CLI version")
    .option("--api-url <url>", "API origin (env FLOWAID_API_URL; default http://localhost:3001)")
    .option("--api-key <key>", "API key (env FLOWAID_API_KEY, or the key saved by login)")
    .option("--workspace <slug>", "workspace slug or id (env FLOWAID_WORKSPACE)")
    .option("-o, --output <format>", "json | yaml")
    .option("--json", "print JSON")
    .exitOverride()
    .showHelpAfterError()
    .configureOutput({
      writeOut: (s) => io.out(s.trimEnd()),
      writeErr: (s) => io.err(s.trimEnd()),
    });

  registerLogin(program, io);
  registerDev(program, io);
  registerValidate(program, io);
  registerImport(program, io);
  registerOperations(program, io, HAND_WRITTEN);
  const noun = (name: string) => program.commands.find((c) => c.name() === name) as Command;
  registerWorkflowCommands(noun("workflow"), io);
  registerRunCommands(noun("run"), io);
  registerPluginCommands(noun("plugin"), io);
  return program;
}

/** One line for an error the user can act on; the stack only for unexpected failures. */
export function formatError(error: unknown): string {
  if (error instanceof FlowaidApiError) {
    const details =
      error.details === undefined ? "" : `\n${JSON.stringify(error.details, null, 2)}`;
    return `error: ${error.code} (${error.status}) ${error.message}${error.requestId ? ` [request ${error.requestId}]` : ""}${details}`;
  }
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause;
    return `error: ${error.message}${cause instanceof Error ? ` (${cause.message})` : ""}`;
  }
  return `error: ${String(error)}`;
}

/** Runs the CLI; resolves with the exit code. */
export async function runCli(argv: readonly string[], io: CliIO): Promise<number> {
  const program = createProgram(io);
  try {
    await program.parseAsync([...argv], { from: "user" });
    return typeof process.exitCode === "number" ? process.exitCode : 0;
  } catch (error) {
    const code = (error as { code?: string; exitCode?: number }).code;
    if (typeof code === "string" && code.startsWith("commander.")) {
      return code === "commander.helpDisplayed" || code === "commander.version"
        ? 0
        : ((error as { exitCode?: number }).exitCode ?? 1);
    }
    io.err(formatError(error));
    return 1;
  }
}
