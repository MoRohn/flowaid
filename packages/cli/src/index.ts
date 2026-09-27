/** @flowaid/cli — the `flowaid` command line as a library (the executable is `main.ts`). */
export { CLI_VERSION, HAND_WRITTEN, createProgram, formatError, runCli } from "./program.js";
export { OPERATIONS } from "./generated/operations.js";
export { commandKey, registerOperations, runOperation } from "./generatedCommands.js";
export { nodeIO, type CliIO } from "./io.js";
export {
  DEFAULT_API_URL,
  configPath,
  resolveConnection,
  type GlobalOptions,
  type Profile,
} from "./config.js";
export { compileLocally, localProviders, localSandbox, loadDefinition } from "./local.js";
export type { CliOperation, CliParam } from "./operation.js";
