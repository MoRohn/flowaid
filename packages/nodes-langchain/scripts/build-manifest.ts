/**
 * Regenerates `manifest.json` (every node manifest sorted by id plus the provider descriptors,
 * keys sorted) so the file is byte-for-byte reproducible. `--check` fails when the committed file
 * is stale.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildManifest } from "../src/manifest.js";

const out = join(dirname(fileURLToPath(import.meta.url)), "../manifest.json");
const next = buildManifest();
if (process.argv.includes("--check")) {
  if (readFileSync(out, "utf8") !== next) {
    console.error("manifest.json is stale; run pnpm --filter @flowaid/nodes-langchain manifest");
    process.exit(1);
  }
} else {
  writeFileSync(out, next);
  console.log(`wrote ${out}`);
}
