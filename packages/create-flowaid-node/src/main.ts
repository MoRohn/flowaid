#!/usr/bin/env node
/**
 * `npm create flowaid-node <package-name> [--dir <dir>] [--description <text>]` — writes a new
 * FlowAId node package. Refuses to write into a non-empty directory.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { scaffold } from "./scaffold.js";

export function create(argv: string[], cwd: string, out: (line: string) => void): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      dir: { type: "string" },
      description: { type: "string" },
      author: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const name = positionals[0];
  if (values.help || !name) {
    out("Usage: npm create flowaid-node <package-name> [--dir <dir>] [--description <text>]");
    return values.help ? 0 : 2;
  }
  const files = scaffold({
    name,
    ...(values.description ? { description: values.description } : {}),
    ...(values.author ? { author: values.author } : {}),
  });
  const dir = resolve(cwd, values.dir ?? name.replace(/^@[^/]+\//, ""));
  if (existsSync(dir) && readdirSync(dir).length > 0) {
    out(`${dir} is not empty; choose another --dir`);
    return 1;
  }
  for (const [path, content] of Object.entries(files)) {
    const target = join(dir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  out(`Created ${name} in ${dir}\n\n  cd ${dir}\n  npm install\n  npm test\n`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1] ?? ""}`)
  process.exit(
    create(process.argv.slice(2), process.cwd(), (l) => void process.stdout.write(`${l}\n`)),
  );
