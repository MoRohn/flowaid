/**
 * Contract parity: `docs/design/CONTRACTS.ts` is the frozen source of truth for this
 * package. This suite reads it at test time, extracts every exported identifier and
 * asserts that `@flowaid/workflow-core` exports it under the same name — values at
 * runtime (via `./index.js`), types by scanning the modules that `index.ts` re-exports.
 * It also checks that the closed enums (error codes, diagnostic codes, event types) are
 * transcribed verbatim. Adding, renaming or dropping a contract name without an RFC
 * (IMPLEMENTATION_PLAN.md, Wave 0) fails here.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as core from "./index.js";
import { ErrorCodeSchema } from "./policy.js";
import { DiagnosticCodeSchema } from "./diagnostics.js";
import { RunEventSchema } from "./events.js";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const CONTRACTS_PATH = resolve(SRC_DIR, "..", "..", "..", "docs", "design", "CONTRACTS.ts");

/**
 * Contract identifiers this package deliberately does not export, with the package that
 * owns each one. Everything else in CONTRACTS.ts must be exported from `./index.ts`.
 */
const OWNED_ELSEWHERE: Readonly<Record<string, string>> = {
  compile: "@flowaid/workflow-compiler",
  validate: "@flowaid/workflow-compiler",
};
/** §16 (Node SDK) belongs to `@flowaid/node-sdk`; only these §16 names are exported here. */
const SDK_NAMES_EXPORTED_HERE: ReadonlySet<string> = new Set(["SafeFetch"]);
const SDK_SECTION = 16;

type ExportKind = "value" | "type";
interface ContractExport {
  name: string;
  kind: ExportKind;
  section: number;
  line: number;
}

const EXPORT_RE =
  /^export\s+(?:declare\s+)?(?:abstract\s+)?(const|let|var|function|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/;
const SECTION_RE = /^\s*\*\s+§(\d+)\b/;

/** Parses every top-level `export` of CONTRACTS.ts with the § section it belongs to. */
function readContractExports(source: string): ContractExport[] {
  const out: ContractExport[] = [];
  let section = 0;
  source.split("\n").forEach((text, index) => {
    const sectionMatch = SECTION_RE.exec(text);
    if (sectionMatch?.[1] !== undefined) section = Number(sectionMatch[1]);
    const match = EXPORT_RE.exec(text);
    if (match?.[1] === undefined || match[2] === undefined) return;
    const kind: ExportKind = match[1] === "type" || match[1] === "interface" ? "type" : "value";
    out.push({ name: match[2], kind, section, line: index + 1 });
  });
  return out;
}

/** Follows `export * from './x.js'` / `export { a } from './x.js'` from index.ts and collects every exported name. */
function readPackageExports(): { values: Set<string>; types: Set<string>; modules: string[] } {
  const values = new Set<string>();
  const types = new Set<string>();
  const seen = new Set<string>();
  const queue = [join(SRC_DIR, "index.ts")];
  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/^export\s+(?:\*|\{[^}]*\})\s+from\s+["']([^"']+)["']/gm)) {
      const spec = m[1];
      if (spec === undefined || !spec.startsWith(".")) continue;
      queue.push(resolve(dirname(file), spec.replace(/\.js$/, ".ts")));
    }
    for (const line of text.split("\n")) {
      const match = EXPORT_RE.exec(line);
      if (match?.[1] === undefined || match[2] === undefined) continue;
      (match[1] === "type" || match[1] === "interface" ? types : values).add(match[2]);
    }
  }
  return { values, types, modules: [...seen].map((f) => f.slice(SRC_DIR.length + 1)) };
}

/** Extracts the string literals of a `z.enum([...])` declaration by name. */
function enumLiterals(source: string, constName: string): string[] {
  const start = source.indexOf(`export const ${constName} = z.enum([`);
  expect(start, `${constName} declaration`).toBeGreaterThanOrEqual(0);
  const end = source.indexOf("]);", start);
  return [...source.slice(start, end).matchAll(/'([A-Z][A-Z0-9_]*)'/g)].map((m) => m[1] ?? "");
}

const contractsSource = readFileSync(CONTRACTS_PATH, "utf8");
const contractExports = readContractExports(contractsSource);
const pkg = readPackageExports();
const runtime: Record<string, unknown> = { ...core };

describe("CONTRACTS.ts parity", () => {
  it("parses the contract file into sections and exports", () => {
    expect(contractExports.length).toBeGreaterThan(250);
    expect(new Set(contractExports.map((e) => e.section)).size).toBe(17);
    expect(contractExports.filter((e) => e.section === 0)).toEqual([]);
    expect(pkg.modules).toContain("index.ts");
    expect(pkg.modules.length).toBeGreaterThan(20);
  });

  it("has no duplicate names in CONTRACTS.ts", () => {
    const names = contractExports.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });

  const required = contractExports.filter(
    (e) =>
      !(e.name in OWNED_ELSEWHERE) &&
      (e.section !== SDK_SECTION || SDK_NAMES_EXPORTED_HERE.has(e.name)),
  );

  it("exports every contract value at runtime", () => {
    const missing = required.filter((e) => e.kind === "value" && runtime[e.name] === undefined);
    expect(missing.map((e) => `${e.name} (§${e.section}, line ${e.line})`)).toEqual([]);
  });

  it("exports every contract type from a module re-exported by index.ts", () => {
    const missing = required.filter(
      (e) => e.kind === "type" && !pkg.types.has(e.name) && !pkg.values.has(e.name),
    );
    expect(missing.map((e) => `${e.name} (§${e.section}, line ${e.line})`)).toEqual([]);
  });

  it("exports every value it declares under the contract name (no renames)", () => {
    // A value that index.ts re-exports must be reachable at runtime under exactly that name.
    const notAtRuntime = [...pkg.values].filter((name) => runtime[name] === undefined);
    expect(notAtRuntime).toEqual([]);
  });

  it("keeps the excluded names excluded", () => {
    for (const name of Object.keys(OWNED_ELSEWHERE)) {
      expect(
        contractExports.some((e) => e.name === name),
        `${name} is still a contract`,
      ).toBe(true);
      expect(runtime[name], `${name} belongs to ${OWNED_ELSEWHERE[name]}`).toBeUndefined();
    }
    for (const e of contractExports.filter((x) => x.section === SDK_SECTION)) {
      if (SDK_NAMES_EXPORTED_HERE.has(e.name)) continue;
      expect(runtime[e.name], `§16 ${e.name} belongs to @flowaid/node-sdk`).toBeUndefined();
      expect(pkg.types.has(e.name), `§16 ${e.name} belongs to @flowaid/node-sdk`).toBe(false);
    }
  });

  it("transcribes ErrorCodeSchema verbatim (order included)", () => {
    expect([...ErrorCodeSchema.options]).toEqual(enumLiterals(contractsSource, "ErrorCodeSchema"));
  });

  it("transcribes DiagnosticCodeSchema verbatim (order included)", () => {
    expect([...DiagnosticCodeSchema.options]).toEqual(
      enumLiterals(contractsSource, "DiagnosticCodeSchema"),
    );
  });

  it("transcribes every RunEvent type verbatim (order included)", () => {
    const start = contractsSource.indexOf("export const RunEventSchema = z.discriminatedUnion");
    const end = contractsSource.indexOf("export type RunEvent =", start);
    expect(start).toBeGreaterThanOrEqual(0);
    const documented = [
      ...contractsSource.slice(start, end).matchAll(/type: z\.literal\('([A-Z_]+)'\)/g),
    ].map((m) => m[1]);
    const actual = RunEventSchema.options.map((o) => o.shape.type.value);
    expect(actual).toEqual(documented);
  });

  it("has one FlowaidError subclass per ErrorCode, all exported", () => {
    const classNames = contractExports.filter(
      (e) =>
        e.section === 8 &&
        e.kind === "value" &&
        /Error$|Required$/.test(e.name) &&
        !e.name.endsWith("Schema") &&
        e.name !== "FlowaidError" &&
        e.name !== "toFlowaidError",
    );
    for (const { name } of classNames) {
      const ctor = runtime[name];
      expect(typeof ctor, name).toBe("function");
      const parent: unknown = Object.getPrototypeOf(ctor);
      expect(parent, `${name} extends FlowaidError`).toBe(core.FlowaidError);
    }
    expect(classNames.length).toBe(ErrorCodeSchema.options.length);
  });
});
