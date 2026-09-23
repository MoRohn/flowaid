/**
 * `pnpm preflight`: checks the local toolchain and prints what to fix. Exits 1 when a required
 * check fails. Runs on plain Node before `pnpm install`, like `pnpm start`.
 *
 *   pnpm preflight [--port <n>] [--host <address>]
 */
import { parseArgs } from "node:util";

import {
  DEFAULT_HOST,
  DEFAULT_PORT,
  formatReport,
  hasFailures,
  runPreflight,
  useColor,
} from "./preflight.ts";

const argv = process.argv.slice(2);
const { values } = parseArgs({
  args: argv[0] === "--" ? argv.slice(1) : argv,
  options: {
    port: { type: "string", default: String(DEFAULT_PORT) },
    host: { type: "string", default: DEFAULT_HOST },
  },
});

const results = await runPreflight({ host: values.host, port: Number(values.port) });
console.log(`\nFlowAId preflight\n\n${formatReport(results, useColor())}\n`);

if (hasFailures(results)) {
  console.error("Fix the items marked ✗, then run pnpm preflight again.\n");
  process.exitCode = 1;
} else {
  console.log("Ready. Run pnpm start to launch the UI playground.\n");
}
