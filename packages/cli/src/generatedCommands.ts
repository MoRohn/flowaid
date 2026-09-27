/**
 * The generated half of the CLI (API.md §8.3): every OpenAPI operation becomes
 * `flowaid <noun> <verb>` from its `x-cli` extension. Positional path parameters become
 * arguments; query parameters and top-level body properties become `--kebab-case` flags
 * (`@file` and `-` read values from a file or stdin); `--body` supplies the whole JSON body.
 * JSON responses print as JSON or YAML, text responses as is, binary ones go to `--out`.
 */
import type { Command } from "commander";
import { Option } from "commander";
import { fillPath, type Flowaid } from "@flowaid/workflow-sdk";
import { OPERATIONS } from "./generated/operations.js";
import type { CliOperation, CliParam } from "./operation.js";
import { client, type GlobalOptions } from "./config.js";
import type { CliIO } from "./io.js";
import { coerce, kebab, outputFormat, readValue, render } from "./values.js";

/** Flags every generated command reserves for itself. */
const RESERVED = new Set(["body", "out", "help"]);

export const commandKey = (op: Pick<CliOperation, "noun" | "verb">) => `${op.noun} ${op.verb}`;

function describe(p: CliParam): string {
  const parts = [p.description ?? ""];
  if (p.enum) parts.push(`one of: ${p.enum.map(String).join(", ")}`);
  if (p.type === "object" || p.type === "any") parts.push("JSON or @file");
  if (p.type === "array") parts.push("comma list, JSON or @file");
  return parts.filter(Boolean).join("; ");
}

function flag(p: CliParam): Option {
  const name = `--${kebab(p.name)}`;
  const o =
    p.type === "boolean"
      ? new Option(`${name} [value]`, describe(p)).argParser((v) => v !== "false")
      : new Option(`${name} <value>`, describe(p));
  return o;
}

/** Runs one operation: path, query and body from arguments and flags; prints the response. */
export async function runOperation(
  io: CliIO,
  fa: Flowaid,
  op: CliOperation,
  args: string[],
  opts: Record<string, unknown>,
  g: GlobalOptions,
): Promise<void> {
  const pathValues: Record<string, string> = {};
  op.positional.forEach((name, i) => {
    if (args[i] !== undefined) pathValues[name] = args[i];
  });
  for (const name of op.path.match(/\{([^}]+)\}/g)?.map((m) => m.slice(1, -1)) ?? [])
    if (pathValues[name] === undefined && typeof opts[name] === "string")
      pathValues[name] = opts[name];

  const query: Record<string, string | number | boolean> = {};
  for (const q of op.query) {
    const raw = opts[q.name];
    if (raw !== undefined) query[q.name] = (await coerce(io, q, raw)) as string | number | boolean;
  }

  let body: Record<string, unknown> | undefined;
  if (op.body) {
    const base = typeof opts.body === "string" ? await readValue(io, opts.body) : undefined;
    if (base !== undefined && (base === null || typeof base !== "object" || Array.isArray(base)))
      throw new Error("--body must be a JSON object");
    body = { ...(base as Record<string, unknown> | undefined) };
    for (const p of op.body.properties) {
      const raw = opts[p.name];
      if (raw !== undefined && !op.query.some((q) => q.name === p.name))
        body[p.name] = await coerce(io, p, raw);
    }
  }

  const res = await fa.transport.raw(op.method, fillPath(op.path, pathValues), {
    query,
    ...(body !== undefined ? { body } : {}),
  });
  const out = typeof opts.out === "string" ? opts.out : undefined;
  if (res.status === 204) return;
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("json")) {
    const text = render(await res.json(), outputFormat(g));
    if (out) await io.writeFile(out, `${text}\n`);
    else io.out(text);
    return;
  }
  if (type.startsWith("text/") || type.includes("yaml") || type.includes("typescript")) {
    const text = await res.text();
    if (out) await io.writeFile(out, text);
    else io.out(text);
    return;
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!out)
    throw new Error(`the response is binary (${type || "unknown type"}); pass --out <file>`);
  await io.writeFile(out, bytes);
  io.err(`wrote ${bytes.byteLength} bytes to ${out}`);
}

function nounCommand(program: Command, noun: string): Command {
  const existing = program.commands.find((c) => c.name() === noun);
  if (existing) return existing;
  const cmd = program.command(noun).description(`${noun} operations`);
  if (!noun.endsWith("s")) cmd.alias(`${noun}s`);
  return cmd;
}

/** Adds every operation not in `skip` (the hand-written ones) under its noun. */
export function registerOperations(
  program: Command,
  io: CliIO,
  skip: ReadonlySet<string>,
  operations: readonly CliOperation[] = OPERATIONS,
): void {
  for (const op of operations) {
    if (skip.has(commandKey(op))) {
      nounCommand(program, op.noun);
      continue;
    }
    const cmd = nounCommand(program, op.noun)
      .command(op.verb)
      .description(
        op.summary ? `${op.summary}  [${op.method} ${op.path}]` : `${op.method} ${op.path}`,
      );
    for (const name of op.positional) cmd.argument(`<${name}>`);
    const taken = new Set<string>(RESERVED);
    for (const name of op.path.match(/\{([^}]+)\}/g)?.map((m) => m.slice(1, -1)) ?? []) {
      if (op.positional.includes(name)) continue;
      cmd.requiredOption(`--${kebab(name)} <value>`, "path parameter");
      taken.add(name);
    }
    for (const p of [...op.query, ...(op.body?.properties ?? [])]) {
      if (taken.has(p.name)) continue;
      taken.add(p.name);
      cmd.addOption(flag(p));
    }
    if (op.body)
      cmd.option(
        "--body <json>",
        "the whole JSON body (JSON, @file or -); flags override its fields",
      );
    cmd.option("--out <file>", "write the response to a file");
    cmd.action(async (...params: unknown[]) => {
      const self = params.at(-1) as Command;
      const args = params.slice(0, op.positional.length) as string[];
      const g = self.optsWithGlobals<GlobalOptions>();
      await runOperation(io, await client(io, g), op, args, self.opts(), g);
    });
  }
}
