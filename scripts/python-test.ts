/**
 * Runs a Python service's unittest suite with an interpreter new enough for it (3.10+):
 * `FLOWAID_PYTHON` when set, else the first of python3.13 … python3.10, python3 that qualifies.
 * The suites under `tests/` need only the standard library (live tests skip themselves).
 * Without a suitable interpreter it fails in CI and warns and skips elsewhere.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const dir = resolve(import.meta.dirname, "..", process.argv[2] ?? ".");
const candidates = [
  process.env.FLOWAID_PYTHON,
  "python3.13",
  "python3.12",
  "python3.11",
  "python3.10",
  "python3",
].filter((c): c is string => Boolean(c));

const python = candidates.find((cmd) => {
  const r = spawnSync(cmd, ["-c", "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)"]);
  return r.status === 0;
});

if (!python) {
  const message =
    "no Python 3.10+ found (set FLOWAID_PYTHON); the PageIndex service tests did not run";
  if (process.env.CI) {
    console.error(message);
    process.exit(1);
  }
  console.warn(`warning: ${message}`);
  process.exit(0);
}

const run = spawnSync(python, ["-m", "unittest", "discover", "-s", "tests", "-t", "."], {
  cwd: dir,
  stdio: "inherit",
});
process.exit(run.status ?? 1);
