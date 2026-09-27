/**
 * Command-line values: `@path` reads a file (JSON, or YAML for `.yaml`/`.yml`), `-` reads stdin,
 * anything else is parsed as JSON when it parses and kept as a string otherwise. Output is JSON
 * (default) or YAML.
 */
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { CliIO } from "./io.js";
import type { CliParam } from "./operation.js";

function parseText(text: string, path?: string): unknown {
  if (path && /\.ya?ml$/i.test(path)) return parseYaml(text) as unknown;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    if (path) return parseYaml(text) as unknown;
    return text;
  }
}

/** A structured value from a flag (`@file`, `-`, JSON, or a bare string). */
export async function readValue(io: CliIO, raw: string): Promise<unknown> {
  if (raw === "-") return parseText(await io.readStdin());
  if (raw.startsWith("@")) {
    const path = raw.slice(1);
    return parseText(await io.readText(path), path);
  }
  return parseText(raw);
}

/** A flag value converted to the parameter's JSON Schema type. */
export async function coerce(io: CliIO, param: CliParam, raw: unknown): Promise<unknown> {
  if (typeof raw === "boolean") return raw;
  const text = String(raw);
  switch (param.type) {
    case "integer":
    case "number": {
      const n = Number(text);
      if (!Number.isFinite(n))
        throw new Error(`--${kebab(param.name)} expects a number, got '${text}'`);
      return n;
    }
    case "boolean":
      if (text === "true") return true;
      if (text === "false") return false;
      throw new Error(`--${kebab(param.name)} expects true or false, got '${text}'`);
    case "string":
      return text.startsWith("@") ? io.readText(text.slice(1)) : text;
    case "array": {
      const v =
        text.startsWith("[") || text.startsWith("@") ? await readValue(io, text) : text.split(",");
      return v;
    }
    default:
      return readValue(io, text);
  }
}

export const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

export type OutputFormat = "json" | "yaml";

export function outputFormat(o: { output?: string; json?: boolean }): OutputFormat {
  if (o.json) return "json";
  const f = (o.output ?? "json").toLowerCase();
  if (f !== "json" && f !== "yaml") throw new Error(`--output must be json or yaml (got ${f})`);
  return f;
}

export function render(value: unknown, format: OutputFormat): string {
  if (value === undefined) return "";
  if (format === "yaml") return stringifyYaml(value);
  return JSON.stringify(value, null, 2);
}
