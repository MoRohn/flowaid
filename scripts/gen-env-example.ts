/**
 * Generates `.env.example` and the variable table in `packages/env/README.md` from
 * `packages/env/src/docs.ts`. Run with `pnpm env:example` (tsx). Pass `--check` to exit
 * non-zero when the checked-in files are stale instead of rewriting them.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { injectReadmeTable, renderEnvExample } from "../packages/env/src/render.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ENV_EXAMPLE = join(ROOT, ".env.example");
const README = join(ROOT, "packages/env/README.md");

function readOrEmpty(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

const check = process.argv.includes("--check");
const targets: { path: string; next: string }[] = [
  { path: ENV_EXAMPLE, next: renderEnvExample() },
  { path: README, next: injectReadmeTable(readFileSync(README, "utf8")) },
];

let stale = 0;
for (const { path, next } of targets) {
  const current = readOrEmpty(path);
  if (current === next) {
    console.log(`up to date  ${path}`);
    continue;
  }
  stale += 1;
  if (check) {
    console.error(`stale       ${path} (run pnpm env:example)`);
  } else {
    writeFileSync(path, next);
    console.log(`written     ${path}`);
  }
}

if (check && stale > 0) {
  process.exit(1);
}
