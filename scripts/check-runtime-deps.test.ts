/**
 * Repository-level guard for the production images: the api and the worker run from a pruned
 * tree (`pnpm deploy --prod` in docker/Dockerfile) that holds their `dependencies` only. A module
 * the running code imports but the package lists under `devDependencies` works in development
 * and in CI (the whole workspace is installed) and crashes the container at start. Every
 * non-type import of a package from an app's runtime sources must be a runtime dependency.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
/** The apps that ship as pruned production images. */
const APPS = ["api", "worker"] as const;

/** Test and evaluation sources never reach an image's runtime. */
const NOT_RUNTIME = /\.test\.ts$|\/test\/|\/evals\//;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return path.endsWith(".ts") && !NOT_RUNTIME.test(path) ? [path] : [];
  });
}

/** The package a specifier names: "zod", "@flowaid/database", "drizzle-orm" (from "drizzle-orm/pg-core"). */
function packageOf(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier);
}

/** Packages imported for their values (type-only imports are erased by the compiler). */
function runtimeImports(source: string): string[] {
  const found: string[] = [];
  const statics = /^\s*import\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?["']([^"'./][^"']*)["']/gm;
  const dynamics = /\bimport\(\s*["']([^"'./][^"']*)["']\s*\)/g;
  for (const re of [statics, dynamics])
    for (const m of source.matchAll(re)) {
      const spec = m[1];
      if (spec && !spec.startsWith("node:")) found.push(packageOf(spec));
    }
  return found;
}

describe("production images carry every runtime import", () => {
  for (const app of APPS) {
    it(`apps/${app}: every package its runtime code imports is in dependencies`, () => {
      const dir = join(ROOT, "apps", app);
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
        dependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
      };
      const declared = new Set([
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.optionalDependencies ?? {}),
      ]);
      const missing = sources(join(dir, "src")).flatMap((file) =>
        runtimeImports(readFileSync(file, "utf8"))
          .filter((name) => !declared.has(name))
          .map((name) => `${name} (${relative(dir, file)})`),
      );
      expect(missing, "move these to dependencies so `pnpm deploy --prod` keeps them").toEqual([]);
    });
  }

  it("recognises value imports and ignores type-only and relative ones", () => {
    expect(
      runtimeImports(
        [
          'import { z } from "zod";',
          'import type { Foo } from "@flowaid/node-sdk";',
          'import { sql } from "drizzle-orm/pg-core";',
          'import "@flowaid/nodes-core/register";',
          'import { x } from "./local.js";',
          'import { readFile } from "node:fs";',
          'const m = await import("@flowaid/sandbox");',
        ].join("\n"),
      ),
    ).toEqual(["zod", "drizzle-orm", "@flowaid/nodes-core", "@flowaid/sandbox"]);
  });
});
