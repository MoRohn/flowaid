/**
 * Browser bundle smoke test for the browser-safe packages (ARCHITECTURE.md §1.1).
 *
 * The per-package ESLint ban on Node built-ins is only skin deep: it cannot see what a
 * dependency (first- or third-party) pulls in. This test enforces the rule transitively by
 * bundling each browser-safe entry point with esbuild for `--platform=browser` and failing on
 * any Node built-in specifier anywhere in the graph, then proving the bundle actually runs:
 *
 * 1. under happy-dom, `fixtures/example-support-reply.json` is hashed through the bundled
 *    `definitionHash` and must equal an independent `node:crypto` digest of the same
 *    canonical JSON;
 * 2. in a `node:vm` context that exposes only Web platform globals (no `Buffer`, no
 *    `process`), the bundled hash and definition helpers must still work.
 *
 * Runs in the root Vitest project (`pnpm boundaries`).
 *
 * @vitest-environment happy-dom
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, runInContext, runInThisContext } from "node:vm";

import { build } from "esbuild";
import type { BuildOptions, BuildResult, Metafile, Plugin } from "esbuild";
import { beforeAll, describe, expect, it } from "vitest";

import { NODE_BUILTIN_REGEX, boundaries } from "../eslint.boundaries.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FIXTURE = join(ROOT, "packages/workflow-core/fixtures/example-support-reply.json");

/**
 * Entry points that must bundle for the browser. Every entry must be marked `browserSafe`
 * in boundaries.json (asserted below); later items extend the list (workflow-compiler).
 */
const BUNDLE_ENTRIES: ReadonlyArray<{ name: string; entry: string }> = [
  { name: "shared", entry: "packages/shared/src/index.ts" },
  { name: "workflow-core", entry: "packages/workflow-core/src/index.ts" },
];

const NODE_BUILTIN = new RegExp(NODE_BUILTIN_REGEX);

/** Specifier → set of importers (repo-relative) for every Node built-in esbuild was asked to resolve. */
type BuiltinImports = Map<string, Set<string>>;

/**
 * Records every Node built-in specifier reached while bundling and marks it external so the
 * build completes and the assertion can list all offenders at once.
 */
function collectNodeBuiltins(found: BuiltinImports): Plugin {
  return {
    name: "flowaid-collect-node-builtins",
    setup(api) {
      api.onResolve({ filter: NODE_BUILTIN }, (args) => {
        const importers = found.get(args.path) ?? new Set<string>();
        importers.add(relative(ROOT, args.importer));
        found.set(args.path, importers);
        return { path: args.path, external: true };
      });
    },
  };
}

interface Bundle {
  name: string;
  entry: string;
  esm: string;
  iife: string;
  builtins: BuiltinImports;
  metafile: Metafile;
  result: BuildResult;
}

function outputText(result: BuildResult): string {
  const [file] = result.outputFiles ?? [];
  if (file === undefined) {
    throw new Error("esbuild produced no output file");
  }
  return file.text;
}

async function bundle(name: string, entry: string): Promise<Bundle> {
  const builtins: BuiltinImports = new Map();
  const common: BuildOptions = {
    entryPoints: [join(ROOT, entry)],
    absWorkingDir: ROOT,
    bundle: true,
    platform: "browser",
    target: "es2023",
    write: false,
    logLevel: "silent",
    plugins: [collectNodeBuiltins(builtins)],
  };
  const esm = await build({ ...common, format: "esm", metafile: true });
  const iife = await build({ ...common, format: "iife", globalName: "flowaidBundle" });
  const { metafile } = esm;
  if (metafile === undefined) {
    throw new Error("esbuild produced no metafile");
  }
  return {
    name,
    entry,
    esm: outputText(esm),
    iife: outputText(iife),
    builtins,
    metafile,
    result: esm,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function exportedFunction(mod: unknown, name: string): (...args: unknown[]) => unknown {
  if (!isRecord(mod)) {
    throw new TypeError(`bundle namespace is not an object`);
  }
  const candidate = mod[name];
  if (typeof candidate !== "function") {
    throw new TypeError(`bundle does not export a function named ${name}`);
  }
  return (...args: unknown[]): unknown => Reflect.apply(candidate, mod, args);
}

/** `WorkflowDefinitionSchema.parse(raw)` through the bundle's own zod. */
function parseWith(mod: unknown, schemaName: string, raw: unknown): unknown {
  if (!isRecord(mod)) {
    throw new TypeError(`bundle namespace is not an object`);
  }
  const schema = mod[schemaName];
  if (!isRecord(schema) || typeof schema.parse !== "function") {
    throw new TypeError(`bundle does not export a zod schema named ${schemaName}`);
  }
  return Reflect.apply(schema.parse, schema, [raw]);
}

function asString(value: unknown, what: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${what} did not return a string`);
  }
  return value;
}

function nodeSha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** A realm with only the Web platform globals a Worker would have: no Buffer, no process. */
function webOnlyContext(): object {
  return createContext({
    TextEncoder,
    TextDecoder,
    crypto: globalThis.crypto,
    console,
    URL,
    structuredClone,
  });
}

/** Evaluates an IIFE bundle in `context` and returns its namespace object. */
function evaluateIife(code: string, context: object): unknown {
  return runInContext(`${code}\n;flowaidBundle`, context, { filename: "bundle.iife.js" });
}

/**
 * Evaluates an IIFE bundle in this test's own realm, i.e. the happy-dom `window` globals
 * Vitest installed for this file, bypassing the module runner (which cannot load a bundle
 * that is not part of the project graph).
 */
function evaluateIifeHere(code: string): unknown {
  return runInThisContext(`${code}\n;flowaidBundle`, { filename: "bundle.iife.js" });
}

const bundles = new Map<string, Bundle>();
let fixtureRaw: unknown;

beforeAll(async () => {
  fixtureRaw = JSON.parse(await readFile(FIXTURE, "utf8"));
  for (const { name, entry } of BUNDLE_ENTRIES) {
    bundles.set(name, await bundle(name, entry));
  }
}, 60_000);

function getBundle(name: string): Bundle {
  const found = bundles.get(name);
  if (found === undefined) {
    throw new Error(`no bundle named ${name}`);
  }
  return found;
}

describe("browser bundle entries", () => {
  it("are all marked browserSafe in boundaries.json", () => {
    for (const { name, entry } of BUNDLE_ENTRIES) {
      const pkg = boundaries.packages[name];
      expect(pkg, `${name} is missing from boundaries.json`).toBeDefined();
      expect(pkg?.browserSafe, `${name} must be browserSafe`).toBe(true);
      expect(entry.startsWith(`${pkg?.dir ?? ""}/`)).toBe(true);
    }
  });

  it("cover shared and workflow-core", () => {
    expect(BUNDLE_ENTRIES.map((e) => e.name)).toEqual(
      expect.arrayContaining(["shared", "workflow-core"]),
    );
  });
});

describe.each(BUNDLE_ENTRIES)("esbuild --platform=browser bundle of $name", ({ name }) => {
  it("builds without errors or warnings", () => {
    const { result } = getBundle(name);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("reaches no Node built-in specifier anywhere in the import graph", () => {
    const { builtins, metafile } = getBundle(name);
    const offenders = [...builtins.entries()].map(
      ([specifier, importers]) => `${specifier} ← ${[...importers].sort().join(", ")}`,
    );
    expect(offenders, `Node built-ins reached from ${name}:\n${offenders.join("\n")}`).toEqual([]);
    // Belt and braces: nothing the metafile recorded (bundled or external) is a built-in.
    const recorded = Object.values(metafile.inputs)
      .flatMap((input) => input.imports)
      .map((imp) => imp.path)
      .filter((path) => NODE_BUILTIN.test(path));
    expect(recorded).toEqual([]);
    const externals = Object.values(metafile.outputs).flatMap((output) =>
      output.imports.filter((imp) => imp.external).map((imp) => imp.path),
    );
    expect(externals).toEqual([]);
  });

  it("emits no require() of a Node built-in in the output", () => {
    const { esm } = getBundle(name);
    expect(esm).not.toMatch(/\brequire\(["'](node:)?(crypto|fs|path|os|util|buffer)["']\)/);
    expect(esm).not.toMatch(/\bfrom\s*["']node:/);
  });
});

describe("shared bundle runs in the browser", () => {
  it("hashes the NIST vectors identically to node:crypto under happy-dom", () => {
    // The @vitest-environment docblock installed happy-dom's window on this realm.
    expect("document" in globalThis).toBe(true);
    const mod = evaluateIifeHere(getBundle("shared").iife);
    const sha256Hex = exportedFunction(mod, "sha256Hex");
    const sha256Json = exportedFunction(mod, "sha256Json");
    const stableStringify = exportedFunction(mod, "stableStringify");
    for (const input of ["", "abc", "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"]) {
      expect(sha256Hex(input)).toBe(nodeSha256Hex(input));
    }
    const canonical = asString(stableStringify(fixtureRaw), "stableStringify");
    expect(sha256Json(fixtureRaw)).toBe(nodeSha256Hex(canonical));
  });

  it("works with only Web platform globals (no Buffer, no process)", () => {
    const { iife } = getBundle("shared");
    const mod = evaluateIife(iife, webOnlyContext());
    const sha256Hex = exportedFunction(mod, "sha256Hex");
    const uuidv7 = exportedFunction(mod, "uuidv7");
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(sha256Hex("")).toBe(nodeSha256Hex(""));
    expect(asString(uuidv7(), "uuidv7")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe("workflow-core bundle runs in the browser", () => {
  it("hashes fixtures/example-support-reply.json through definitionHash under happy-dom", () => {
    // The @vitest-environment docblock installed happy-dom's window on this realm.
    expect("document" in globalThis).toBe(true);
    const mod = evaluateIifeHere(getBundle("workflow-core").iife);
    const definitionHash = exportedFunction(mod, "definitionHash");
    const canonicalDefinition = exportedFunction(mod, "canonicalDefinition");
    // workflow-core does not re-export stableStringify; take it from the shared bundle.
    const stableStringify = exportedFunction(
      evaluateIifeHere(getBundle("shared").iife),
      "stableStringify",
    );
    const definition = parseWith(mod, "WorkflowDefinitionSchema", fixtureRaw);

    const hash = asString(definitionHash(definition), "definitionHash");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    const canonical = asString(stableStringify(canonicalDefinition(definition)), "stableStringify");
    expect(hash).toBe(nodeSha256Hex(canonical));
    // Hashing is a pure function of the canonical form: raw key order must not matter.
    expect(definitionHash(parseWith(mod, "WorkflowDefinitionSchema", JSON.parse(canonical)))).toBe(
      hash,
    );
  });

  it("hashes the fixture with only Web platform globals (no Buffer, no process)", () => {
    const { iife } = getBundle("workflow-core");
    const context = webOnlyContext();
    const mod = evaluateIife(iife, context);
    const definitionHash = exportedFunction(mod, "definitionHash");
    // Hand the realm its own copy of the fixture so zod sees same-realm objects.
    const raw: unknown = runInContext(
      `JSON.parse(${JSON.stringify(JSON.stringify(fixtureRaw))})`,
      context,
    );
    const definition = parseWith(mod, "WorkflowDefinitionSchema", raw);
    const hash = asString(definitionHash(definition), "definitionHash");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(runInContext("typeof Buffer", context)).toBe("undefined");
    expect(runInContext("typeof process", context)).toBe("undefined");
  });
});
