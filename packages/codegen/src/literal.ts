/**
 * JavaScript source for JSON values and builder calls. Strings are emitted with `JSON.stringify`
 * (never interpolated), object keys are identifiers or quoted strings, and `__proto__` is emitted
 * as a computed key so a document key never sets a prototype.
 */

/** Raw source text, emitted verbatim by {@link js}. */
export class Code {
  constructor(readonly source: string) {}
}

/** A call expression: `callee(arg1, arg2)` with trailing `undefined` arguments dropped. */
export function call(callee: string, ...args: unknown[]): Code {
  while (args.length > 0 && args[args.length - 1] === undefined) args.pop();
  return new Code(`${callee}(${args.map((a) => js(a)).join(", ")})`);
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function key(name: string): string {
  if (name === "__proto__") return `["__proto__"]`;
  return IDENTIFIER.test(name) ? name : JSON.stringify(name);
}

/** Source for a value: {@link Code} verbatim, arrays and plain objects recursively, the rest as JSON. */
export function js(value: unknown): string {
  if (value instanceof Code) return value.source;
  if (Array.isArray(value)) return `[${value.map((v) => js(v)).join(", ")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    return `{${entries.map(([k, v]) => `${key(k)}: ${js(v)}`).join(", ")}}`;
  }
  if (value === undefined) return "undefined";
  return JSON.stringify(value);
}
