/**
 * Deterministic JSON serialisation.
 *
 * `stableStringify` produces the same string for any two values that are structurally equal
 * regardless of the order in which object keys were inserted, which makes it the input for
 * content hashes (`definitionHash`, `planHash`, idempotency keys). Unlike `JSON.stringify`
 * it refuses to silently drop or coerce values: `undefined`, functions, symbols, bigints,
 * non-finite numbers, non-plain objects and cycles are rejected with a `TypeError` naming
 * the offending path.
 */

import { isPlainObject } from "./json.js";

/** Thrown by {@link stableStringify} for values that have no faithful JSON representation. */
export class StableStringifyError extends TypeError {
  override readonly name = "StableStringifyError";

  constructor(
    /** JSON Pointer (RFC 6901) of the offending value; `""` is the root. */
    readonly path: string,
    reason: string,
  ) {
    super(`stableStringify: ${reason} at ${path === "" ? "(root)" : path}`);
  }
}

function escapePointerSegment(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

interface WriteContext {
  readonly parts: string[];
  readonly stack: object[];
}

function write(value: unknown, path: string, ctx: WriteContext): void {
  switch (typeof value) {
    case "string":
      ctx.parts.push(JSON.stringify(value));
      return;
    case "boolean":
      ctx.parts.push(value ? "true" : "false");
      return;
    case "number":
      if (!Number.isFinite(value)) {
        throw new StableStringifyError(path, `non-finite number ${String(value)}`);
      }
      // JSON.stringify normalises -0 to "0" and uses the shortest round-trip form.
      ctx.parts.push(JSON.stringify(value));
      return;
    case "undefined":
      throw new StableStringifyError(path, "undefined is not a JSON value");
    case "function":
      throw new StableStringifyError(path, "functions are not JSON values");
    case "symbol":
      throw new StableStringifyError(path, "symbols are not JSON values");
    case "bigint":
      throw new StableStringifyError(path, "bigints are not JSON values");
    case "object":
      break;
  }
  if (value === null) {
    ctx.parts.push("null");
    return;
  }
  if (ctx.stack.includes(value)) {
    throw new StableStringifyError(path, "circular reference");
  }
  if (Array.isArray(value)) {
    ctx.stack.push(value);
    ctx.parts.push("[");
    for (let i = 0; i < value.length; i += 1) {
      if (i > 0) {
        ctx.parts.push(",");
      }
      const itemPath = `${path}/${String(i)}`;
      if (!(i in value)) {
        throw new StableStringifyError(itemPath, "sparse array hole");
      }
      write(value[i], itemPath, ctx);
    }
    ctx.parts.push("]");
    ctx.stack.pop();
    return;
  }
  if (!isPlainObject(value)) {
    const tag = Object.prototype.toString.call(value);
    throw new StableStringifyError(path, `non-plain object ${tag}`);
  }
  ctx.stack.push(value);
  ctx.parts.push("{");
  const keys = Object.keys(value).sort();
  let first = true;
  for (const key of keys) {
    if (!first) {
      ctx.parts.push(",");
    }
    first = false;
    ctx.parts.push(JSON.stringify(key), ":");
    write(value[key], `${path}/${escapePointerSegment(key)}`, ctx);
  }
  ctx.parts.push("}");
  ctx.stack.pop();
}

/**
 * Serialises `value` to compact JSON with object keys sorted (code-unit order) at every depth.
 * Arrays keep their order. Throws {@link StableStringifyError} for `undefined`, functions,
 * symbols, bigints, `NaN`/`Infinity`, sparse arrays, cycles and non-plain objects (`Date`,
 * `Map`, class instances) so that a hash never silently covers a lossy encoding.
 */
export function stableStringify(value: unknown): string {
  const ctx: WriteContext = { parts: [], stack: [] };
  write(value, "", ctx);
  return ctx.parts.join("");
}
