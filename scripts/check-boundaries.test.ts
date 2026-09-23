/**
 * Repository-level guard for the dependency DAG (ARCHITECTURE.md §1.1).
 *
 * 1. boundaries.json is well-formed, references only known packages and is acyclic.
 * 2. boundaries.json agrees with the DAG block in docs/design/ARCHITECTURE.md.
 * 3. Every workspace package's package.json only depends on @flowaid packages it may import
 *    and never on a third-party module reserved for other packages (`thirdParty`).
 * 4. The generated ESLint rules reject a forbidden import and accept an allowed one, including
 *    the third-party boundary and its file-level exceptions.
 * 5. Every package/app eslint.config.js applies its own boundaries, and only packages/env
 *    (and packages/cli) lift the `process.env` ban of the base config.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint, Linter } from "eslint";
import { describe, expect, it } from "vitest";

import {
  SCOPE,
  TOOLING_PACKAGES,
  boundaries,
  boundaryConfig,
  boundaryConfigs,
  mayDependOnThirdParty,
  restrictedThirdParty,
  testBoundaryConfig,
  testBoundaryConfigs,
  thirdPartyExceptionConfigs,
} from "../eslint.boundaries.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PACKAGE_NAMES = new Set(Object.keys(boundaries.packages));

function basePackage(allowEntry: string): string {
  const slash = allowEntry.indexOf("/");
  return slash === -1 ? allowEntry : allowEntry.slice(0, slash);
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

interface PackageJsonDeps {
  name: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
  optionalDependencies: Record<string, string>;
}

function readPackageJson(path: string): PackageJsonDeps {
  const raw = readJson(path);
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`${path} is not an object`);
  }
  const record: Record<string, unknown> = { ...raw };
  const deps = (key: string): Record<string, string> => {
    const value = record[key];
    if (value === undefined) {
      return {};
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`${path}: ${key} must be an object`);
    }
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(value)) {
      if (typeof v !== "string") {
        throw new Error(`${path}: ${key}.${k} must be a string`);
      }
      out[k] = v;
    }
    return out;
  };
  const name = record.name;
  if (typeof name !== "string") {
    throw new Error(`${path}: missing name`);
  }
  return {
    name,
    dependencies: deps("dependencies"),
    devDependencies: deps("devDependencies"),
    peerDependencies: deps("peerDependencies"),
    optionalDependencies: deps("optionalDependencies"),
  };
}

/** Every `<group>/<dir>` under packages/ and apps/ that has a package.json. */
function workspaceDirs(): string[] {
  const dirs: string[] = [];
  for (const group of ["packages", "apps"]) {
    const groupPath = join(ROOT, group);
    if (!existsSync(groupPath)) {
      continue;
    }
    for (const entry of readdirSync(groupPath)) {
      const dir = join(groupPath, entry);
      if (statSync(dir).isDirectory() && existsSync(join(dir, "package.json"))) {
        dirs.push(`${group}/${entry}`);
      }
    }
  }
  return dirs.sort();
}

/**
 * Parses the DAG code block of ARCHITECTURE.md §1.1 into `name → deps` for every line that
 * lists its dependencies explicitly (lines described in prose, such as "everything
 * server-side …", are skipped). `provider-*` is expanded to every provider-* package.
 */
function architectureDag(): Map<string, Set<string>> {
  const text = readFileSync(join(ROOT, "docs/design/ARCHITECTURE.md"), "utf8");
  const headingIndex = text.indexOf("### 1.1 Dependency DAG");
  expect(headingIndex).toBeGreaterThan(-1);
  const blockStart = text.indexOf("```", headingIndex);
  const blockEnd = text.indexOf("```", blockStart + 3);
  const block = text.slice(blockStart + 3, blockEnd);
  const dag = new Map<string, Set<string>>();
  for (const line of block.split("\n")) {
    const arrow = line.indexOf("→");
    if (arrow === -1) {
      continue;
    }
    const lhs = line
      .slice(0, arrow)
      .trim()
      .replace(/^apps\//, "");
    let rhs = line.slice(arrow + 1);
    if (rhs.includes("everything")) {
      continue;
    }
    rhs = rhs.replace(/\([^)]*\)/g, "");
    const deps = new Set<string>();
    for (const part of rhs.split(",")) {
      const dep = part.trim();
      if (dep === "" || dep === "none") {
        continue;
      }
      if (PACKAGE_NAMES.has(dep)) {
        deps.add(dep);
      }
    }
    const names = lhs.endsWith("*")
      ? [...PACKAGE_NAMES].filter((n) => n.startsWith(lhs.slice(0, -1)))
      : [lhs];
    for (const name of names) {
      dag.set(name, deps);
    }
  }
  return dag;
}

/** Every package name on the left-hand side of the ARCHITECTURE.md §1.1 DAG block. */
function architectureNames(): string[] {
  return [...architectureDag().keys()];
}

describe("boundaries.json", () => {
  it("names only known packages with unique, non-self allow entries", () => {
    for (const [name, pkg] of Object.entries(boundaries.packages)) {
      expect(pkg.dir, `${name}.dir`).toMatch(/^(packages|apps)\/[a-z0-9-]+$/);
      const seen = new Set<string>();
      for (const entry of pkg.allow) {
        const target = basePackage(entry);
        expect(PACKAGE_NAMES.has(target), `${name} allows unknown package "${entry}"`).toBe(true);
        expect(target, `${name} must not allow itself`).not.toBe(name);
        expect(seen.has(entry), `${name} lists "${entry}" twice`).toBe(false);
        seen.add(entry);
      }
    }
  });

  it("is acyclic", () => {
    const visiting = new Set<string>();
    const done = new Set<string>();
    const visit = (name: string, trail: string[]): void => {
      if (done.has(name)) {
        return;
      }
      expect(visiting.has(name), `cycle: ${[...trail, name].join(" → ")}`).toBe(false);
      visiting.add(name);
      const pkg = boundaries.packages[name];
      for (const entry of pkg?.allow ?? []) {
        visit(basePackage(entry), [...trail, name]);
      }
      visiting.delete(name);
      done.add(name);
    };
    for (const name of PACKAGE_NAMES) {
      visit(name, []);
    }
  });

  it("shared depends on nothing and every other package may reach shared", () => {
    expect(boundaries.packages.shared?.allow).toEqual([]);
    for (const [name, pkg] of Object.entries(boundaries.packages)) {
      if (name === "shared" || name === "ui") {
        continue;
      }
      const reachable = new Set<string>();
      const stack = pkg.allow.map(basePackage);
      while (stack.length > 0) {
        const next = stack.pop();
        if (next === undefined || reachable.has(next)) {
          continue;
        }
        reachable.add(next);
        stack.push(...(boundaries.packages[next]?.allow.map(basePackage) ?? []));
      }
      expect(reachable.has("shared"), `${name} cannot reach shared`).toBe(true);
    }
  });

  it("registers every package named in ARCHITECTURE.md §1.1", () => {
    const names = architectureNames();
    expect(names.length).toBeGreaterThan(15);
    expect(names).toContain("cli");
    expect(names).toContain("importer");
    expect(names).toContain("langchain");
    const missing = names.filter((name) => !PACKAGE_NAMES.has(name));
    expect(missing, "ARCHITECTURE.md §1.1 packages missing from boundaries.json").toEqual([]);
  });

  it("marks the browser packages of ARCHITECTURE.md §1.1 as browserSafe", () => {
    for (const name of ["shared", "workflow-core", "workflow-compiler", "ui"]) {
      expect(boundaries.packages[name]?.browserSafe, `${name}.browserSafe`).toBe(true);
    }
  });

  it("declares the LangChain third-party boundary of ARCHITECTURE.md §1.1", () => {
    const [langchain] = boundaries.thirdParty;
    expect(boundaries.thirdParty).toHaveLength(1);
    expect(langchain?.specifiers).toEqual(["langchain", "langchain/*", "@langchain/*"]);
    expect(langchain?.packages).toEqual(["langchain", "nodes-langchain"]);
    expect(langchain?.files).toEqual([
      "packages/importer/src/langchain-map.ts",
      "packages/codegen/src/templates/**",
      "apps/worker/src/plugins/**",
    ]);
    for (const name of langchain?.packages ?? []) {
      expect(PACKAGE_NAMES.has(name), `thirdParty names unknown package ${name}`).toBe(true);
    }
    const dirs = Object.values(boundaries.packages).map((p) => p.dir);
    for (const file of langchain?.files ?? []) {
      expect(
        dirs.some((dir) => file.startsWith(`${dir}/`)),
        `thirdParty file ${file} is outside every package`,
      ).toBe(true);
    }
    const regex = new RegExp(langchain?.regex ?? "$^");
    for (const hit of [
      "langchain",
      "langchain/agents",
      "@langchain/core",
      "@langchain/core/messages",
    ]) {
      expect(regex.test(hit), hit).toBe(true);
    }
    for (const miss of ["langchainx", "@langchainx/core", "zod", "@flowaid/langchain"]) {
      expect(regex.test(miss), miss).toBe(false);
    }
  });

  it("matches the DAG in ARCHITECTURE.md §1.1", () => {
    const dag = architectureDag();
    expect(dag.size).toBeGreaterThan(15);
    for (const [name, documented] of dag) {
      const pkg = boundaries.packages[name];
      expect(pkg, `ARCHITECTURE.md lists "${name}" but boundaries.json does not`).toBeDefined();
      if (pkg === undefined) {
        continue;
      }
      const configured = new Set(pkg.allow.map(basePackage));
      if (pkg.dir.startsWith("apps/")) {
        // App lines in the doc are the headline dependencies; apps may also use what those
        // packages export types from, so the doc's list must be a subset.
        for (const dep of documented) {
          expect(configured.has(dep), `${name} must allow ${dep} (ARCHITECTURE.md)`).toBe(true);
        }
      } else {
        expect([...configured].sort(), `allow list of ${name}`).toEqual([...documented].sort());
      }
    }
  });
});

describe("workspace package.json dependencies", () => {
  it("every workspace package is registered in boundaries.json", () => {
    const registered = new Set(Object.values(boundaries.packages).map((p) => p.dir));
    for (const dir of workspaceDirs()) {
      if (dir === "packages/config") {
        continue;
      }
      expect(registered.has(dir), `${dir} is missing from boundaries.json`).toBe(true);
    }
  });

  it("only declare @flowaid dependencies the DAG allows", () => {
    for (const [name, pkg] of Object.entries(boundaries.packages)) {
      const manifestPath = join(ROOT, pkg.dir, "package.json");
      if (!existsSync(manifestPath)) {
        continue;
      }
      const manifest = readPackageJson(manifestPath);
      expect(manifest.name).toBe(`${SCOPE}/${name}`);
      const allowed = new Set([...TOOLING_PACKAGES, ...pkg.allow.map(basePackage)]);
      const declared = {
        ...manifest.dependencies,
        ...manifest.devDependencies,
        ...manifest.peerDependencies,
        ...manifest.optionalDependencies,
      };
      for (const dep of Object.keys(declared)) {
        if (!dep.startsWith(`${SCOPE}/`)) {
          continue;
        }
        const short = dep.slice(SCOPE.length + 1);
        expect(
          allowed.has(short),
          `${manifest.name} depends on ${dep}, which ARCHITECTURE.md §1.1 forbids`,
        ).toBe(true);
        expect(declared[dep], `${manifest.name}: ${dep} must be a workspace dependency`).toBe(
          "workspace:*",
        );
      }
    }
  });

  it("never declare a third-party module reserved for other packages", () => {
    for (const [name, pkg] of Object.entries(boundaries.packages)) {
      const manifestPath = join(ROOT, pkg.dir, "package.json");
      if (!existsSync(manifestPath)) {
        continue;
      }
      const manifest = readPackageJson(manifestPath);
      const declared = {
        ...manifest.dependencies,
        ...manifest.devDependencies,
        ...manifest.peerDependencies,
        ...manifest.optionalDependencies,
      };
      for (const dep of Object.keys(declared)) {
        expect(
          mayDependOnThirdParty(name, dep),
          `${manifest.name} depends on ${dep}, which boundaries.json thirdParty reserves for other packages`,
        ).toBe(true);
      }
    }
  });

  it("reject a @langchain/* dependency in any unflagged package.json", () => {
    // The same predicate the manifest test above applies, against fixture manifests.
    const fixtures: Record<string, Record<string, string>> = {
      shared: { "@noble/hashes": "2.4.0" },
      "workflow-runtime": { "@langchain/core": "1.2.12" },
      providers: { langchain: "1.5.12" },
      api: { "@langchain/openai": "1.5.13" },
      langchain: { "@langchain/core": "1.2.12", "@langchain/openai": "1.5.13" },
      "nodes-langchain": { "@langchain/langgraph": "1.4.17", langchain: "1.5.12" },
      importer: { "@langchain/core": "1.2.12" },
      worker: { "@langchain/core": "1.2.12" },
    };
    const verdict = (name: string): boolean =>
      Object.keys(fixtures[name] ?? {}).every((dep) => mayDependOnThirdParty(name, dep));
    expect(verdict("shared")).toBe(true);
    expect(verdict("workflow-runtime")).toBe(false);
    expect(verdict("providers")).toBe(false);
    expect(verdict("api")).toBe(false);
    expect(verdict("langchain")).toBe(true);
    expect(verdict("nodes-langchain")).toBe(true);
    // Packages that own a file-level exception may install the module for that file.
    expect(verdict("importer")).toBe(true);
    expect(verdict("worker")).toBe(true);
    expect(restrictedThirdParty("shared")).toHaveLength(1);
    expect(restrictedThirdParty("langchain")).toHaveLength(0);
    expect(restrictedThirdParty("importer")).toHaveLength(1);
  });
});

describe("generated ESLint boundary rules", () => {
  const linter = new Linter({ configType: "flat" });
  const languageOptions = { ecmaVersion: 2024 as const, sourceType: "module" as const };

  function lint(pkg: string, code: string): string[] {
    const config = { ...boundaryConfig(pkg), files: ["**/*.ts"], languageOptions };
    return linter.verify(code, [config], { filename: `${pkg}.ts` }).map((m) => m.message);
  }

  it("reject imports outside the allow list and accept those inside it", () => {
    expect(lint("shared", 'import { x } from "@flowaid/env";')).toHaveLength(1);
    expect(lint("shared", 'import { x } from "@flowaid/database";')).toHaveLength(1);
    expect(lint("env", 'import { ok } from "@flowaid/shared";')).toHaveLength(0);
    expect(lint("env", 'import { ok } from "@flowaid/shared/src/index.js";')).toHaveLength(0);
    expect(lint("env", 'import { db } from "@flowaid/database";')).toHaveLength(1);
    expect(
      lint("workflow-compiler", 'import { corePackage } from "@flowaid/nodes-core";'),
    ).toHaveLength(1);
    expect(lint("nodes-core", 'import { PgRunStore } from "@flowaid/database";')).toHaveLength(1);
    expect(lint("credentials", 'import { createDb } from "@flowaid/database";')).toHaveLength(1);
    expect(
      lint("workflow-runtime", 'import { compile } from "@flowaid/workflow-compiler";'),
    ).toHaveLength(0);
    expect(lint("env", 'import { z } from "zod"; import fs from "node:fs";')).toHaveLength(0);
  });

  it("allow subpath-only permissions such as nodes-core/manifest for the api", () => {
    expect(
      lint("api", 'import { coreManifests } from "@flowaid/nodes-core/manifest";'),
    ).toHaveLength(0);
    expect(lint("api", 'import { corePackage } from "@flowaid/nodes-core";')).toHaveLength(1);
    expect(lint("api", 'import { x } from "@flowaid/nodes-core/executors";')).toHaveLength(1);
    expect(lint("api", 'import { x } from "@flowaid/sandbox";')).toHaveLength(1);
  });

  it("forbid Node built-ins in browser-safe packages only", () => {
    expect(lint("workflow-core", 'import { createHash } from "node:crypto";')).toHaveLength(1);
    expect(lint("workflow-core", 'import { readFile } from "fs/promises";')).toHaveLength(1);
    expect(lint("workflow-compiler", 'import path from "path";')).toHaveLength(1);
    expect(lint("ui", 'import { useState } from "react";')).toHaveLength(0);
    // shared is browser-safe since P0-02 (SHA-256 via @noble/hashes): node:crypto is banned there.
    expect(lint("shared", 'import { createHash } from "node:crypto";')).toHaveLength(1);
    expect(lint("shared", 'import { sha256 } from "@noble/hashes/sha2.js";')).toHaveLength(0);
    expect(lint("env", 'import { createHash } from "node:crypto";')).toHaveLength(0);
  });

  it("forbid relative imports that cross package directories", () => {
    expect(lint("env", 'import { x } from "../../packages/shared/src/index.js";')).toHaveLength(1);
    expect(lint("env", 'import { x } from "./schema.js";')).toHaveLength(0);
  });

  it("always allow the tooling package and report a helpful message", () => {
    expect(lint("shared", 'import base from "@flowaid/config/eslint";')).toHaveLength(0);
    const [message] = lint("shared", 'import { x } from "@flowaid/env";');
    expect(message).toContain("@flowaid/shared may only import nothing");
    expect(message).toContain("ARCHITECTURE.md §1.1");
  });

  it("lift only the Node built-in ban for test files of browser-safe packages", () => {
    const lintTest = (pkg: string, code: string): string[] => {
      const config = { ...testBoundaryConfig(pkg), files: ["**/*.test.ts"], languageOptions };
      return linter.verify(code, [config], { filename: `${pkg}.test.ts` }).map((m) => m.message);
    };
    expect(lintTest("workflow-core", 'import { readFileSync } from "node:fs";')).toHaveLength(0);
    expect(lintTest("workflow-core", 'import { db } from "@flowaid/database";')).toHaveLength(1);
    expect(
      lintTest("workflow-core", 'import { x } from "../../packages/shared/src/index.js";'),
    ).toHaveLength(1);
    const configs = testBoundaryConfigs();
    expect(configs).toHaveLength(PACKAGE_NAMES.size);
    for (const config of configs) {
      expect(config.files?.[0]).toMatch(/^(packages|apps)\/[a-z0-9-]+\/\*\*\/\*\.test\./);
    }
  });

  it("produce a directory-scoped config per package for the root", () => {
    const configs = boundaryConfigs();
    const perPackage = configs.slice(0, PACKAGE_NAMES.size);
    for (const config of perPackage) {
      const files = config.files ?? [];
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^(packages|apps)\/[a-z0-9-]+\/\*\*\//);
    }
    const tests = configs.slice(PACKAGE_NAMES.size, PACKAGE_NAMES.size * 2);
    expect(tests.map((c) => c.name)).toEqual(testBoundaryConfigs().map((c) => c.name));
    const exceptions = configs.slice(PACKAGE_NAMES.size * 2);
    expect(exceptions.length).toBeGreaterThan(0);
    for (const config of exceptions) {
      expect(config.name).toMatch(/:third-party-exceptions/);
      for (const glob of config.files ?? []) {
        expect(typeof glob === "string" ? glob : glob[0]).toMatch(/^(packages|apps)\//);
      }
    }
  });

  it("forbid langchain and @langchain/* outside the flagged packages", () => {
    expect(lint("shared", 'import { z } from "@langchain/core";')).toHaveLength(1);
    expect(lint("providers", 'import { ChatOpenAI } from "@langchain/openai";')).toHaveLength(1);
    expect(lint("workflow-runtime", 'import "langchain";')).toHaveLength(1);
    expect(lint("api", 'import { x } from "langchain/agents";')).toHaveLength(1);
    expect(
      lint(
        "langchain",
        'import { BaseChatModel } from "@langchain/core/language_models/chat_models";',
      ),
    ).toHaveLength(0);
    expect(
      lint("nodes-langchain", 'import { createReactAgent } from "@langchain/langgraph/prebuilt";'),
    ).toHaveLength(0);
    expect(lint("nodes-langchain", 'import { x } from "langchain";')).toHaveLength(0);
    // Look-alikes are not caught by the boundary.
    expect(lint("shared", 'import { x } from "langchainx";')).toHaveLength(0);
    const [message] = lint("shared", 'import { x } from "@langchain/core";');
    expect(message).toContain("@flowaid/langchain");
    expect(message).toContain("packages/importer/src/langchain-map.ts");
    expect(message).toContain("LANGCHAIN.md");
  });

  it("scope the third-party exceptions to the listed files only", () => {
    const rootLinter = new Linter({ configType: "flat", cwd: ROOT });
    const rootConfigs = [
      { files: ["**/*.ts"], languageOptions },
      ...boundaryConfigs(),
    ] as Linter.Config[];
    const lintAt = (file: string, code: string): string[] =>
      rootLinter.verify(code, rootConfigs, { filename: join(ROOT, file) }).map((m) => m.message);
    const langchain = 'import { ChatOpenAI } from "@langchain/openai";';
    expect(lintAt("packages/shared/src/hash.ts", langchain)).toHaveLength(1);
    expect(lintAt("packages/langchain/src/provider.ts", langchain)).toHaveLength(0);
    expect(lintAt("packages/importer/src/langchain-map.ts", langchain)).toHaveLength(0);
    expect(lintAt("packages/importer/src/index.ts", langchain)).toHaveLength(1);
    expect(lintAt("packages/importer/src/langchain-map.test.ts", langchain)).toHaveLength(1);
    expect(lintAt("packages/codegen/src/templates/langchain/agent.ts", langchain)).toHaveLength(0);
    expect(lintAt("packages/codegen/src/index.ts", langchain)).toHaveLength(1);
    expect(lintAt("apps/worker/src/plugins/loader.ts", langchain)).toHaveLength(0);
    expect(lintAt("apps/worker/src/index.ts", langchain)).toHaveLength(1);
    // The exception lifts only the third-party ban: the DAG still applies in those files.
    expect(
      lintAt("packages/importer/src/langchain-map.ts", 'import { db } from "@flowaid/database";'),
    ).toHaveLength(1);
    // Package-local configs carry the same exception relative to the package directory.
    expect(thirdPartyExceptionConfigs("importer").flatMap((c) => c.files ?? [])).toEqual([
      "src/langchain-map.ts",
    ]);
    expect(thirdPartyExceptionConfigs("shared")).toEqual([]);
  });
});

describe("package eslint.config.js files", () => {
  const configFiles = workspaceDirs()
    .filter((dir) => dir !== "packages/config")
    .map((dir) => ({ dir, path: join(ROOT, dir, "eslint.config.js") }));

  it('every package and app applies boundaryConfig("<name>")', () => {
    expect(configFiles.length).toBeGreaterThan(0);
    const byDir = new Map(Object.entries(boundaries.packages).map(([n, p]) => [p.dir, n]));
    for (const { dir, path } of configFiles) {
      expect(existsSync(path), `${dir} has no eslint.config.js`).toBe(true);
      const name = byDir.get(dir);
      expect(name, `${dir} is not in boundaries.json`).toBeDefined();
      const source = readFileSync(path, "utf8");
      expect(
        source,
        `${dir}/eslint.config.js must apply boundaryConfig("${name ?? ""}")`,
      ).toContain(`boundaryConfig("${name ?? ""}")`);
      if (boundaries.packages[name ?? ""]?.browserSafe === true) {
        expect(source, `${dir}/eslint.config.js must apply testBoundaryConfig`).toContain(
          `testBoundaryConfig("${name ?? ""}")`,
        );
      }
      if (thirdPartyExceptionConfigs(name ?? "").length > 0) {
        expect(source, `${dir}/eslint.config.js must spread thirdPartyExceptionConfigs`).toContain(
          `thirdPartyExceptionConfigs("${name ?? ""}")`,
        );
      }
    }
  });

  async function resolvedRules(dir: string, file: string): Promise<Record<string, unknown>> {
    const eslint = new ESLint({ cwd: join(ROOT, dir) });
    const config: unknown = await eslint.calculateConfigForFile(join(ROOT, dir, file));
    if (typeof config !== "object" || config === null || !("rules" in config)) {
      throw new Error(`${dir}: no config for ${file}`);
    }
    const rules: unknown = config.rules;
    if (typeof rules !== "object" || rules === null) {
      throw new Error(`${dir}: rules is not an object`);
    }
    return { ...rules };
  }

  function severityOf(entry: unknown): number {
    if (Array.isArray(entry)) {
      return severityOf(entry[0]);
    }
    if (typeof entry === "number") {
      return entry;
    }
    if (entry === "error") {
      return 2;
    }
    if (entry === "warn") {
      return 1;
    }
    return 0;
  }

  function selectorsOf(entry: unknown): string[] {
    if (!Array.isArray(entry)) {
      return [];
    }
    return entry.slice(1).flatMap((option: unknown) => {
      if (typeof option === "string") {
        return [option];
      }
      if (typeof option === "object" && option !== null && "selector" in option) {
        const selector: unknown = option.selector;
        return typeof selector === "string" ? [selector] : [];
      }
      return [];
    });
  }

  it("bans process.env everywhere except in packages/env (and packages/cli)", async () => {
    const shared = await resolvedRules("packages/shared", "src/index.ts");
    const sharedRule = shared["no-restricted-syntax"];
    expect(severityOf(sharedRule)).toBe(2);
    const selectors = selectorsOf(sharedRule);
    expect(selectors.some((s) => s.includes("process") && s.includes("env"))).toBe(true);

    const env = await resolvedRules("packages/env", "src/load.ts");
    expect(severityOf(env["no-restricted-syntax"])).toBe(0);
    expect(severityOf(env["no-restricted-imports"])).toBe(2);

    for (const dir of ["packages/workflow-core", "packages/ui"]) {
      const rules = await resolvedRules(dir, "src/index.ts");
      expect(severityOf(rules["no-restricted-syntax"]), `${dir} must ban process.env`).toBe(2);
    }

    // The root config (`eslint .`) carries the same override, scoped to packages/env and
    // packages/cli only.
    const root = async (file: string): Promise<Record<string, unknown>> => {
      const config: unknown = await new ESLint({ cwd: ROOT }).calculateConfigForFile(
        join(ROOT, file),
      );
      if (typeof config !== "object" || config === null || !("rules" in config)) {
        throw new Error(`root: no config for ${file}`);
      }
      const rules: unknown = config.rules;
      return typeof rules === "object" && rules !== null ? { ...rules } : {};
    };
    expect(severityOf((await root("packages/env/src/load.ts"))["no-restricted-syntax"])).toBe(0);
    expect(severityOf((await root("packages/cli/src/index.ts"))["no-restricted-syntax"])).toBe(0);
    expect(severityOf((await root("packages/shared/src/index.ts"))["no-restricted-syntax"])).toBe(
      2,
    );
    expect(severityOf((await root("apps/api/src/server.ts"))["no-restricted-syntax"])).toBe(2);
  });

  it("applies the React preset (react-hooks + jsx-a11y) to packages/ui", async () => {
    const rules = await resolvedRules("packages/ui", "src/index.ts");
    for (const rule of [
      "react-hooks/rules-of-hooks",
      "react-hooks/refs",
      "react-hooks/set-state-in-effect",
      "react-hooks/purity",
    ]) {
      expect(severityOf(rules[rule]), rule).toBe(2);
    }
    const tsx = await resolvedRules("packages/ui", "src/primitives/Button.tsx");
    for (const rule of [
      "jsx-a11y/alt-text",
      "jsx-a11y/no-static-element-interactions",
      "jsx-a11y/label-has-associated-control",
      "jsx-a11y/no-autofocus",
    ]) {
      expect(severityOf(tsx[rule]), rule).toBe(2);
    }
    // The React preset still carries the base rules (typed TS rules and the process.env ban).
    expect(severityOf(tsx["@typescript-eslint/no-explicit-any"])).toBe(2);
    expect(severityOf(tsx["no-restricted-syntax"])).toBe(2);
    // Plain-TS packages do not get the React rules.
    const shared = await resolvedRules("packages/shared", "src/index.ts");
    expect(shared["react-hooks/rules-of-hooks"]).toBeUndefined();

    // The root config (`eslint .`) applies the same preset to the React packages only.
    const rootRules = async (file: string): Promise<Record<string, unknown>> => {
      const config: unknown = await new ESLint({ cwd: ROOT }).calculateConfigForFile(
        join(ROOT, file),
      );
      if (typeof config !== "object" || config === null || !("rules" in config)) {
        throw new Error(`root: no config for ${file}`);
      }
      const rules: unknown = config.rules;
      return typeof rules === "object" && rules !== null ? { ...rules } : {};
    };
    const uiRoot = await rootRules("packages/ui/src/primitives/Button.tsx");
    expect(severityOf(uiRoot["jsx-a11y/alt-text"])).toBe(2);
    expect(severityOf(uiRoot["react-hooks/refs"])).toBe(2);
    expect(severityOf(uiRoot["no-restricted-imports"])).toBe(2);
    const webRoot = await rootRules("apps/web/app/page.tsx");
    expect(severityOf(webRoot["jsx-a11y/alt-text"])).toBe(2);
    const sharedRoot = await rootRules("packages/shared/src/index.ts");
    expect(sharedRoot["react-hooks/rules-of-hooks"]).toBeUndefined();
  });

  it("rejects a process.env read with the base config and accepts it in packages/env", async () => {
    // Typed linting resolves `filePath` through the TypeScript project service, so the probe
    // must name a file that exists in the package's tsconfig; `code` replaces its content.
    const lintWith = async (dir: string, file: string, code: string): Promise<string[]> => {
      const eslint = new ESLint({ cwd: join(ROOT, dir) });
      const [result] = await eslint.lintText(code, { filePath: join(ROOT, dir, file) });
      const messages = result?.messages ?? [];
      const parseErrors = messages.filter((m) => m.ruleId === null).map((m) => m.message);
      expect(parseErrors, `${dir}/${file}`).toEqual([]);
      return messages.filter((m) => m.ruleId === "no-restricted-syntax").map((m) => m.message);
    };
    const reads = [
      "export const a = process.env.PORT;",
      'export const b = process.env["PORT"];',
      "export const { PORT } = process.env;",
      "export const c = globalThis.process.env.PORT;",
    ];
    for (const code of reads) {
      const messages = await lintWith("packages/shared", "src/index.ts", code);
      expect(messages, code).toHaveLength(1);
      expect(messages[0]).toContain("@flowaid/env");
    }
    expect(
      await lintWith("packages/shared", "src/index.ts", "export const d = process.argv;"),
    ).toHaveLength(0);
    expect(await lintWith("packages/env", "src/index.ts", reads[0] ?? "")).toHaveLength(0);
  });
});
