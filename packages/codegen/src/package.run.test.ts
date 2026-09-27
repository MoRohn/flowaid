/**
 * An exported package actually runs (CODE_EXPORT.md §5): the support-reply fixture is exported,
 * written to disk with its `@flowaid/*` dependencies linked to this repository's packages (what
 * `pnpm install` would provide), then
 *   1. its runner (`src/flow.ts`) executes the workflow on the package's own fake providers,
 *   2. `pnpm validate` (`tsx src/validate.ts`) compiles `src/workflow.ts` with zero errors,
 *   3. the generated sources typecheck with `tsc` (strict),
 *   4. `pnpm test` (Vitest over `tests/`) passes, including the replay of a recorded run.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { JsonValue, NodeRun, RunStatus } from "@flowaid/workflow-core";
import { buildExportBundle, type ExportBundle } from "./bundle.js";
import { packageClosure } from "./packageClosure.js";
import { REPO, fixture, planOf } from "./test/support.js";

interface LocalResult {
  status: RunStatus;
  outcome: string | null;
  output: JsonValue;
  nodeRuns: NodeRun[];
  events: { type: string }[];
}
interface FlowModule {
  runWorkflow(input: JsonValue, opts?: Record<string, unknown>): Promise<LocalResult>;
  isUnchanged(): boolean;
}
interface FakesModule {
  fakeProviders(): unknown;
  fakeSecrets(names: string[]): Record<string, string>;
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const plan = planOf("example-support-reply");
const definition = fixture("example-support-reply") as { id: string };
const INPUT = { message: "I was charged twice this month", customer_id: "c_42", tier: "gold" };
const CRM = () =>
  Promise.resolve(
    new Response(JSON.stringify({ id: "c_42", name: "Ada", plan: "gold" }), {
      headers: { "content-type": "application/json" },
    }),
  );

function writePackage(bundle: ExportBundle, dir: string): void {
  for (const [path, content] of bundle.files) {
    const file = join(dir, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  // What `pnpm install` provides: the runtime packages (here: this repository's) and the tooling.
  mkdirSync(join(dir, "node_modules/@flowaid"), { recursive: true });
  for (const short of packageClosure(plan))
    symlinkSync(join(REPO, "packages", short), join(dir, "node_modules/@flowaid", short), "dir");
  for (const tool of ["vitest", "tsx", "typescript"])
    symlinkSync(join(REPO, "node_modules", tool), join(dir, "node_modules", tool), "dir");
  mkdirSync(join(dir, "node_modules/@types"), { recursive: true });
  symlinkSync(
    join(REPO, "packages/codegen/node_modules/@types/node"),
    join(dir, "node_modules/@types/node"),
    "dir",
  );
}

describe("an exported package", () => {
  let dir: string;
  let flow: FlowModule;
  let fakes: FakesModule;
  const base = {
    definition,
    plan,
    workflow: { id: definition.id, slug: "support-reply", name: "Support reply" },
    version: 1,
    mode: "npm" as const,
    versions: Object.fromEntries(packageClosure(plan).map((s) => [s, "0.1.0"])),
  };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "flowaid-export-"));
    writePackage(await buildExportBundle(base), dir);
    flow = (await import(pathToFileURL(join(dir, "src/flow.ts")).href)) as FlowModule;
    fakes = (await import(pathToFileURL(join(dir, "tests/fakes.ts")).href)) as FakesModule;
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("runs the workflow end to end on fake providers", async () => {
    expect(flow.isUnchanged()).toBe(true);
    const result = await flow.runWorkflow(INPUT, {
      providers: fakes.fakeProviders(),
      secrets: fakes.fakeSecrets(["TYPESAFE_API_KEY", "OPENAI_API_KEY", "CRM_TOKEN"]),
      http: CRM,
    });
    expect(result.status).toBe("completed");
    expect(result.outcome).toBe("auto");
    expect(result.output).toEqual({
      reply: "A fake answer.",
      team: "billing",
      auto_sent: true,
      approved_by: null,
    });
    expect(result.events.map((e) => e.type)).toContain("DECISION_COMPLETED");

    // Export again with that run recorded: the package's own tests replay it.
    const recorded = await buildExportBundle({
      ...base,
      sampleInput: INPUT,
      recordedRun: {
        input: INPUT,
        status: result.status,
        outcome: result.outcome,
        output: result.output,
        nodeRuns: result.nodeRuns,
      },
    });
    rmSync(dir, { recursive: true, force: true });
    writePackage(recorded, dir);
  });

  it("pnpm validate: src/workflow.ts compiles with zero errors", () => {
    // the linked workspace packages resolve to their sources (dist may not be built)
    const run = spawnSync(
      join(REPO, "node_modules/.bin/tsx"),
      ["--conditions=development", "src/validate.ts"],
      {
        cwd: dir,
        encoding: "utf8",
      },
    );
    expect(run.stderr).toMatch(/^ok · unchanged since export/m);
    expect(run.stderr).not.toMatch(/^error/m);
    expect(run.status).toBe(0);
  });

  it("tsc: the generated sources typecheck (strict)", () => {
    const run = spawnSync(join(REPO, "node_modules/typescript/bin/tsc"), ["-p", "tsconfig.json"], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(run.stdout).toBe("");
    expect(run.status).toBe(0);
  });

  it("pnpm test: the generated suite passes (compile, round trip, fake run, replay)", () => {
    const out = execFileSync(
      process.execPath,
      [join(REPO, "node_modules/vitest/vitest.mjs"), "run", "--reporter=verbose"],
      { cwd: dir, encoding: "utf8" },
    ).replace(ANSI, ""); // turbo forces colour
    expect(out).toMatch(/src\/workflow\.ts is the exported definition/);
    expect(out).toMatch(/replays the recorded run/);
    expect(out).toMatch(/Tests\s+4 passed \(4\)/);
  });
});

describe("a vendored export", () => {
  it("tests/vendor-integrity.test.ts passes on the shipped tarballs and fails on a tampered one", async () => {
    const vendor = packageClosure(plan).map((short) => ({
      name: `flowaid-${short}-0.1.0.tgz`,
      data: new TextEncoder().encode(`tarball of ${short}`),
    }));
    const bundle = await buildExportBundle({
      definition,
      plan,
      workflow: { id: definition.id, slug: "support-reply", name: "Support reply" },
      version: 1,
      mode: "vendored",
      vendor,
    });
    const dir = mkdtempSync(join(tmpdir(), "flowaid-vendored-"));
    try {
      for (const [path, content] of bundle.files) {
        mkdirSync(dirname(join(dir, path)), { recursive: true });
        writeFileSync(join(dir, path), content);
      }
      mkdirSync(join(dir, "node_modules"), { recursive: true });
      symlinkSync(join(REPO, "node_modules/vitest"), join(dir, "node_modules/vitest"), "dir");
      const integrity = () =>
        spawnSync(
          process.execPath,
          [join(REPO, "node_modules/vitest/vitest.mjs"), "run", "tests/vendor-integrity.test.ts"],
          { cwd: dir, encoding: "utf8" },
        );
      expect(integrity().status).toBe(0);
      writeFileSync(join(dir, "vendor/flowaid-shared-0.1.0.tgz"), "tampered");
      const tampered = integrity();
      expect(tampered.status).not.toBe(0);
      expect(`${tampered.stdout}${tampered.stderr}`.replace(ANSI, "")).toMatch(
        /flowaid-shared-0\.1\.0\.tgz/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
