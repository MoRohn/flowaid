/**
 * User code is an async function body that receives `inputs` and returns the output. It is wrapped
 * as `async function __flowaid_main(inputs) { … }` and transpiled by esbuild (types stripped, target
 * ES2022) once per content hash, with an LRU of 200 entries.
 */
import { createHash } from "node:crypto";
import { transform } from "esbuild";
import { SandboxError } from "@flowaid/workflow-core";

const MAX_ENTRIES = 200;
const cache = new Map<string, string>();

export const ENTRY = "__flowaid_main";

export async function transpile(
  code: string,
  language: "javascript" | "typescript",
): Promise<string> {
  const key = createHash("sha256").update(language).update("\0").update(code).digest("hex");
  const hit = cache.get(key);
  if (hit !== undefined) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const wrapped = `async function ${ENTRY}(inputs) {\n${code}\n}`;
  let out: string;
  try {
    const r = await transform(wrapped, {
      loader: language === "typescript" ? "ts" : "js",
      target: "es2022",
      format: "esm",
      logLevel: "silent",
    });
    out = r.code;
  } catch (error) {
    const first = (
      error as { errors?: { text: string; location?: { line: number; column: number } | null }[] }
    ).errors?.[0];
    const where = first?.location
      ? ` (line ${first.location.line - 1}, column ${first.location.column})`
      : "";
    throw new SandboxError(`the code does not compile: ${first?.text ?? String(error)}${where}`);
  }
  if (/^\s*(?:import|export)\s/m.test(out))
    throw new SandboxError("the code cannot use import or export; it runs as a function body");
  cache.set(key, out);
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  return out;
}

export function transpileCacheSize(): number {
  return cache.size;
}
