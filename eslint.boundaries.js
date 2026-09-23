// Dependency-boundary rules generated from boundaries.json (the DAG of ARCHITECTURE.md §1.1).
//
// Each package's eslint.config.js adds `boundaryConfig("<name>")` (plus
// `thirdPartyExceptionConfigs("<name>")` when boundaries.json grants it file-level exceptions);
// the root eslint.config.js adds `boundaryConfigs()` (the same rules scoped by directory) so
// `eslint .` at the root enforces every boundary at once. The rules are plain
// `no-restricted-imports` entries, so they need no resolver and behave identically in editors,
// CI and the root test.

import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));

/** The workspace scope every internal package lives under. */
export const SCOPE = "@flowaid";

/** Tooling-only package that any package may reference (devDependency) without a DAG edge. */
export const TOOLING_PACKAGES = Object.freeze(["config"]);

/**
 * @typedef {{ dir: string; allow: string[]; browserSafe?: boolean }} PackageBoundary
 * @typedef {{
 *   key: string;
 *   specifiers: string[];
 *   regex: string;
 *   packages: string[];
 *   files: string[];
 * }} ThirdPartyBoundary
 *   `key` is the raw boundaries.json key, `specifiers` its `|`-split globs, `regex` the anchored
 *   regex matching any of them, `packages` the package names that may import them and `files`
 *   the repo-relative globs of files (in any other package) that may import them.
 * @typedef {{ packages: Record<string, PackageBoundary>; thirdParty: ThirdPartyBoundary[] }} Boundaries
 */

/** @returns {Boundaries} */
export function loadBoundaries() {
  const raw = readFileSync(join(ROOT, "boundaries.json"), "utf8");
  /** @type {unknown} */
  const parsed = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || !("packages" in parsed)) {
    throw new Error("boundaries.json must be an object with a `packages` map");
  }
  const packages = /** @type {{ packages: unknown }} */ (parsed).packages;
  if (typeof packages !== "object" || packages === null || Array.isArray(packages)) {
    throw new Error("boundaries.json `packages` must be an object");
  }
  /** @type {Record<string, PackageBoundary>} */
  const out = {};
  for (const [name, entry] of Object.entries(/** @type {Record<string, unknown>} */ (packages))) {
    out[name] = parsePackageBoundary(name, entry);
  }
  const thirdPartyRaw = "thirdParty" in parsed ? parsed.thirdParty : {};
  if (typeof thirdPartyRaw !== "object" || thirdPartyRaw === null || Array.isArray(thirdPartyRaw)) {
    throw new Error("boundaries.json `thirdParty` must be an object");
  }
  /** @type {ThirdPartyBoundary[]} */
  const thirdParty = [];
  for (const [key, entry] of Object.entries(
    /** @type {Record<string, unknown>} */ (thirdPartyRaw),
  )) {
    thirdParty.push(parseThirdPartyBoundary(key, entry, out));
  }
  return { packages: out, thirdParty };
}

/**
 * @param {string} name
 * @param {unknown} entry
 * @returns {PackageBoundary}
 */
function parsePackageBoundary(name, entry) {
  if (typeof entry !== "object" || entry === null) {
    throw new Error(`boundaries.json: package "${name}" must be an object`);
  }
  const record = /** @type {Record<string, unknown>} */ (entry);
  const dir = record.dir;
  const allow = record.allow;
  if (
    typeof dir !== "string" ||
    !Array.isArray(allow) ||
    !allow.every((a) => typeof a === "string")
  ) {
    throw new Error(`boundaries.json: package "${name}" needs { dir: string, allow: string[] }`);
  }
  return {
    dir,
    allow: allow.map(String),
    browserSafe: record.browserSafe === true,
  };
}

/**
 * @param {unknown} value
 * @returns {value is string[]}
 */
function isStringArray(value) {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/**
 * @param {string} key
 * @param {unknown} entry
 * @param {Record<string, PackageBoundary>} packages
 * @returns {ThirdPartyBoundary}
 */
function parseThirdPartyBoundary(key, entry, packages) {
  if (typeof entry !== "object" || entry === null) {
    throw new Error(`boundaries.json: thirdParty "${key}" must be an object`);
  }
  const record = /** @type {Record<string, unknown>} */ (entry);
  const allowedPackages = record.packages;
  const files = record.files;
  if (!isStringArray(allowedPackages) || !isStringArray(files)) {
    throw new Error(
      `boundaries.json: thirdParty "${key}" needs { packages: string[], files: string[] }`,
    );
  }
  for (const name of allowedPackages) {
    if (!(name in packages)) {
      throw new Error(`boundaries.json: thirdParty "${key}" names unknown package "${name}"`);
    }
  }
  const dirs = Object.values(packages).map((p) => p.dir);
  for (const file of files) {
    if (!dirs.some((dir) => file.startsWith(`${dir}/`))) {
      throw new Error(
        `boundaries.json: thirdParty "${key}" file "${file}" is not inside a registered package`,
      );
    }
  }
  const specifiers = key
    .split("|")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  if (specifiers.length === 0) {
    throw new Error(`boundaries.json: thirdParty key "${key}" lists no specifier`);
  }
  return {
    key,
    specifiers,
    regex: `^(${specifiers.map(specifierGlobToRegex).join("|")})$`,
    packages: [...allowedPackages],
    files: [...files],
  };
}

/** Parsed boundaries.json. */
export const boundaries = loadBoundaries();

/** @param {string} text */
function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/**
 * Turns a module-specifier glob (`@langchain/*`, `langchain`) into an unanchored regex source
 * where `*` matches any run of characters.
 * @param {string} glob
 */
function specifierGlobToRegex(glob) {
  return glob.split("*").map(escapeRegex).join(".*");
}

/**
 * Builds the regex that matches every *forbidden* `@flowaid/...` specifier for `name`:
 * anything under the scope that is not an allowed package (or allowed subpath).
 * @param {string} name
 */
export function forbiddenScopeRegex(name) {
  const pkg = boundaries.packages[name];
  if (pkg === undefined) {
    throw new Error(`boundaries.json has no package named "${name}"`);
  }
  const alternatives = [];
  for (const allowed of [...TOOLING_PACKAGES, ...pkg.allow]) {
    if (allowed.includes("/")) {
      // Subpath-only permission: exactly that specifier (with an optional file extension).
      alternatives.push(`${escapeRegex(allowed)}(\\.[a-z]+)?$`);
    } else {
      alternatives.push(`${escapeRegex(allowed)}(/|$)`);
    }
  }
  const lookahead = alternatives.length > 0 ? `(?!(${alternatives.join("|")}))` : "";
  return `^${escapeRegex(SCOPE)}/${lookahead}`;
}

const NODE_BUILTINS = builtinModules.filter((m) => !m.startsWith("_"));

/** Regex matching Node built-in module specifiers (`node:fs`, `fs`, `fs/promises`, …). */
export const NODE_BUILTIN_REGEX = `^(node:|(${NODE_BUILTINS.map(escapeRegex).join("|")})(/|$))`;

/**
 * The third-party boundaries that `name` is *not* allowed to import wholesale, i.e. every
 * boundary whose `packages` list does not contain it. (A package may still hold file-level
 * exceptions; see {@link thirdPartyExceptionConfigs}.)
 * @param {string} name
 * @returns {ThirdPartyBoundary[]}
 */
export function restrictedThirdParty(name) {
  if (boundaries.packages[name] === undefined) {
    throw new Error(`boundaries.json has no package named "${name}"`);
  }
  return boundaries.thirdParty.filter((tp) => !tp.packages.includes(name));
}

/**
 * The third-party boundaries whose `files` list has an entry inside `name`'s directory, with
 * the matching globs.
 * @param {string} name
 * @returns {{ boundary: ThirdPartyBoundary; files: string[] }[]}
 */
export function thirdPartyExceptions(name) {
  const pkg = boundaries.packages[name];
  if (pkg === undefined) {
    throw new Error(`boundaries.json has no package named "${name}"`);
  }
  const out = [];
  for (const boundary of boundaries.thirdParty) {
    const files = boundary.files.filter((f) => f.startsWith(`${pkg.dir}/`));
    if (files.length > 0) {
      out.push({ boundary, files });
    }
  }
  return out;
}

/**
 * Whether `name` may declare `specifier` (a package name such as `@langchain/core`) as a
 * dependency in its package.json: the package is either listed in the third-party boundary's
 * `packages`, or owns one of its file-level exceptions (the file still needs the module
 * installed to compile).
 * @param {string} name
 * @param {string} specifier
 */
export function mayDependOnThirdParty(name, specifier) {
  for (const boundary of restrictedThirdParty(name)) {
    if (!new RegExp(boundary.regex).test(specifier)) {
      continue;
    }
    if (!thirdPartyExceptions(name).some((e) => e.boundary === boundary)) {
      return false;
    }
  }
  return true;
}

/**
 * @param {ThirdPartyBoundary} boundary
 * @param {string} name
 */
function thirdPartyMessage(boundary, name) {
  const where = [
    ...boundary.packages.map((p) => `${SCOPE}/${p}`),
    ...boundary.files.map((f) => `\`${f}\``),
  ];
  return `${SCOPE}/${name} may not import ${boundary.specifiers.join(", ")}: only ${where.join(", ")} may (ARCHITECTURE.md §1.1, LANGCHAIN.md, boundaries.json thirdParty).`;
}

/**
 * The `no-restricted-imports` rule options for one package.
 * @param {string} name
 * @param {{ nodeBuiltins?: boolean; thirdParty?: boolean }} [options] `nodeBuiltins: false`
 *   lifts the browser-safety ban on Node built-ins (used for test files only; see
 *   {@link testBoundaryConfig}); `thirdParty: false` lifts the third-party boundaries (used
 *   for the file-level exceptions of boundaries.json `thirdParty[].files` only; see
 *   {@link thirdPartyExceptionConfigs}).
 */
export function boundaryRuleOptions(name, options = {}) {
  const pkg = boundaries.packages[name];
  if (pkg === undefined) {
    throw new Error(`boundaries.json has no package named "${name}"`);
  }
  const allowedList =
    pkg.allow.length > 0 ? pkg.allow.map((a) => `${SCOPE}/${a}`).join(", ") : "nothing";
  const patterns = [
    {
      regex: forbiddenScopeRegex(name),
      message: `@flowaid/${name} may only import ${allowedList} (ARCHITECTURE.md §1.1, boundaries.json).`,
    },
    {
      regex: "^(\\.\\.?/)+(packages|apps)/",
      message: "Import other workspace packages by their @flowaid/* name, never by relative path.",
    },
  ];
  if (pkg.browserSafe && options.nodeBuiltins !== false) {
    patterns.push({
      regex: NODE_BUILTIN_REGEX,
      message: `@flowaid/${name} must run in the browser: no Node built-ins (ARCHITECTURE.md §1.1).`,
    });
  }
  if (options.thirdParty !== false) {
    for (const boundary of restrictedThirdParty(name)) {
      patterns.push({ regex: boundary.regex, message: thirdPartyMessage(boundary, name) });
    }
  }
  return { patterns };
}

/**
 * A flat-config entry enforcing the boundaries of one package for every file it is applied
 * to. Used by that package's own eslint.config.js.
 * @param {string} name
 * @returns {import("eslint").Linter.Config}
 */
export function boundaryConfig(name) {
  return {
    name: `flowaid/boundaries:${name}`,
    rules: {
      "no-restricted-imports": ["error", boundaryRuleOptions(name)],
    },
  };
}

/** Glob matching co-located test files (`*.test.ts` and friends). */
const TEST_FILE_GLOB = "**/*.test.{ts,tsx,mts,cts,js,jsx,mjs,cjs}";

/**
 * A companion entry for a package's co-located test files: the same package boundaries,
 * except that a browser-safe package's tests may import Node built-ins (they read fixtures
 * and design documents from disk). Tests never ship: every tsconfig.build.json excludes
 * `*.test.ts`, so the browser bundle is unaffected. Add it after `boundaryConfig(name)`.
 * @param {string} name
 * @returns {import("eslint").Linter.Config}
 */
export function testBoundaryConfig(name) {
  return {
    name: `flowaid/boundaries:${name}:tests`,
    files: [TEST_FILE_GLOB],
    rules: {
      "no-restricted-imports": ["error", boundaryRuleOptions(name, { nodeBuiltins: false })],
    },
  };
}

/**
 * @param {{ root?: string }} options
 */
function rootPrefix(options) {
  const root = options.root ?? "";
  return root === "" ? "" : `${root.replace(/\/$/, "")}/`;
}

/**
 * Strips a package's directory from a repo-relative file glob so the result is relative to
 * that package (for the package's own eslint.config.js, which ESLint runs from its dir).
 * @param {PackageBoundary} pkg
 * @param {string} file
 */
function packageRelative(pkg, file) {
  return file.slice(pkg.dir.length + 1);
}

/**
 * Flat-config entries for the file-level third-party exceptions of one package
 * (boundaries.json `thirdParty[].files` under its directory): the same boundaries as
 * {@link boundaryConfig}/{@link testBoundaryConfig}, minus the third-party ban, scoped to
 * exactly those files. Empty for a package without exceptions. A package's own
 * eslint.config.js spreads it after `boundaryConfig(name)` and `testBoundaryConfig(name)`;
 * `options.root` prefixes the globs for the root config.
 * @param {string} name
 * @param {{ root?: string; repoRelative?: boolean }} [options] `repoRelative: true` keeps the
 *   globs repo-relative (root config); the default makes them relative to the package dir.
 * @returns {import("eslint").Linter.Config[]}
 */
export function thirdPartyExceptionConfigs(name, options = {}) {
  const pkg = boundaries.packages[name];
  if (pkg === undefined) {
    throw new Error(`boundaries.json has no package named "${name}"`);
  }
  const prefix = rootPrefix(options);
  /** @type {import("eslint").Linter.Config[]} */
  const configs = [];
  for (const { files } of thirdPartyExceptions(name)) {
    const globs = files.map((f) =>
      options.repoRelative === true ? `${prefix}${f}` : packageRelative(pkg, f),
    );
    configs.push({
      name: `flowaid/boundaries:${name}:third-party-exceptions`,
      files: globs,
      rules: {
        "no-restricted-imports": ["error", boundaryRuleOptions(name, { thirdParty: false })],
      },
    });
    if (pkg.browserSafe) {
      // Test files inside an exception glob keep both liftings (nested array = AND).
      configs.push({
        name: `flowaid/boundaries:${name}:third-party-exceptions:tests`,
        files: globs.map((glob) => [glob, TEST_FILE_GLOB]),
        rules: {
          "no-restricted-imports": [
            "error",
            boundaryRuleOptions(name, { thirdParty: false, nodeBuiltins: false }),
          ],
        },
      });
    }
  }
  return configs;
}

/**
 * Directory-scoped {@link testBoundaryConfig} entries for every package, for the root
 * eslint.config.js (spread after `boundaryConfigs()` so they win for test files).
 * @param {{ root?: string }} [options]
 * @returns {import("eslint").Linter.Config[]}
 */
export function testBoundaryConfigs(options = {}) {
  const prefix = rootPrefix(options);
  return Object.entries(boundaries.packages).map(([name, pkg]) => ({
    ...testBoundaryConfig(name),
    files: [`${prefix}${pkg.dir}/${TEST_FILE_GLOB}`],
  }));
}

/**
 * Directory-scoped {@link thirdPartyExceptionConfigs} entries for every package, for the
 * root eslint.config.js (spread after `testBoundaryConfigs()` so they win for the excepted
 * files).
 * @param {{ root?: string }} [options]
 * @returns {import("eslint").Linter.Config[]}
 */
export function thirdPartyExceptionConfigsForRoot(options = {}) {
  return Object.keys(boundaries.packages).flatMap((name) =>
    thirdPartyExceptionConfigs(name, { ...options, repoRelative: true }),
  );
}

/**
 * Flat-config entries for every package in boundaries.json, each scoped to that package's
 * directory, followed by the directory-scoped test entries and the file-scoped third-party
 * exceptions. Used by the root eslint.config.js: this alone enforces every boundary.
 * @param {{ root?: string }} [options]
 * @returns {import("eslint").Linter.Config[]}
 */
export function boundaryConfigs(options = {}) {
  const prefix = rootPrefix(options);
  const perPackage = Object.entries(boundaries.packages).map(([name, pkg]) => ({
    ...boundaryConfig(name),
    files: [`${prefix}${pkg.dir}/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}`],
  }));
  return [
    ...perPackage,
    ...testBoundaryConfigs(options),
    ...thirdPartyExceptionConfigsForRoot(options),
  ];
}
