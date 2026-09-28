/**
 * `pnpm preflight`: checks the local toolchain and the ports `pnpm start` uses, and prints what
 * to fix. Exits 1 when a required check fails. Runs on plain Node before `pnpm install`, like
 * `pnpm start`. A busy default port is not a failure (`pnpm start` moves to the next free one);
 * a busy port passed with --port or --api-port is.
 *
 *   pnpm preflight [--port <n>] [--api-port <n>] [--host <address>]
 */
import { parseArgs } from "node:util";

import { DEFAULT_API_PORT, DEFAULT_WEB_PORT } from "./ports.ts";
import {
  DEFAULT_HOST,
  checkPort,
  formatReport,
  hasFailures,
  runPreflight,
  useColor,
} from "./preflight.ts";

const argv = process.argv.slice(2);
const { values } = parseArgs({
  args: argv[0] === "--" ? argv.slice(1) : argv,
  options: {
    port: { type: "string" },
    "api-port": { type: "string" },
    host: { type: "string", default: DEFAULT_HOST },
  },
});

const host = values.host;
const apiRequested = Number(values["api-port"] ?? DEFAULT_API_PORT);
const web = await checkPort(host, Number(values.port ?? DEFAULT_WEB_PORT), {
  explicit: values.port !== undefined,
  avoid: values.port === undefined ? [apiRequested] : [],
});
const api = await checkPort(host, apiRequested, {
  name: "API port",
  flag: "--api-port",
  explicit: values["api-port"] !== undefined,
  avoid: [web.port],
});
const results = runPreflight({ ports: [web, api] });
console.log(`\nFlowAId preflight\n\n${formatReport(results, useColor())}\n`);

if (hasFailures(results)) {
  console.error("Fix the items marked ✗, then run pnpm preflight again.\n");
  process.exitCode = 1;
} else {
  console.log("Ready. Run pnpm start to launch FlowAId.\n");
}
