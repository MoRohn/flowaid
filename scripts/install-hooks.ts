/**
 * `pnpm install` → `prepare`: installs the lefthook hooks (lefthook.yml) for contributors.
 * A no-op in CI and Docker builds (`CI` is set), outside a checkout, when lefthook is not
 * installed, or with `FLOWAID_SKIP_HOOKS=1`; a failure only warns, so it never breaks an install.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const bin = join(
  "node_modules",
  ".bin",
  process.platform === "win32" ? "lefthook.cmd" : "lefthook",
);
const skip = process.env["CI"] || process.env["FLOWAID_SKIP_HOOKS"] || !existsSync(".git");

if (!skip && existsSync(bin)) {
  const result = spawnSync(bin, ["install"], { stdio: "inherit" });
  if (result.status !== 0) console.warn("lefthook install failed; hooks are not installed");
}
