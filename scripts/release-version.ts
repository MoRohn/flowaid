/**
 * `pnpm version-packages`: runs after `changeset version` (the "Version packages" pull request).
 *
 * 1. Keeps `PACKAGE_VERSIONS` in packages/codegen in step with the bumped package.json files, so
 *    exported code packages pin the release they ship with (a codegen test enforces it), and the
 *    node SDK version plugins are resolved against (plugins, the scaffold, `flowaid.sdk` ranges).
 * 2. Adds a `## <version>` section to the root CHANGELOG.md from the entries changesets wrote into
 *    the packages' changelogs, without the "Updated dependencies" noise. The release workflow
 *    uses that section as the GitHub release notes.
 *
 * Idempotent: running it twice changes nothing the second time.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLOSURE = join(ROOT, "packages/codegen/src/packageClosure.ts");
const ROOT_CHANGELOG = join(ROOT, "CHANGELOG.md");

/** Rewrites the values of the `PACKAGE_VERSIONS` object literal; unknown keys keep theirs. */
export function syncPackageVersions(source: string, versions: ReadonlyMap<string, string>): string {
  const start = source.indexOf("export const PACKAGE_VERSIONS");
  if (start < 0) throw new Error("PACKAGE_VERSIONS not found");
  const end = source.indexOf("};", start);
  const block = source
    .slice(start, end)
    .replace(
      /^(\s*)("?)([a-z0-9-]+)\2: "[^"]*",$/gm,
      (line, indent: string, q: string, key: string) => {
        const v = versions.get(key);
        return v ? `${indent}${q}${key}${q}: "${v}",` : line;
      },
    );
  return source.slice(0, start) + block + source.slice(end);
}

/** Sets `export const <name> = "<value>";` (the first one), failing loudly if it is gone. */
export function syncConstant(source: string, name: string, value: string): string {
  const re = new RegExp(`^(export )?const ${name} = "[^"]*";$`, "m");
  if (!re.test(source)) throw new Error(`const ${name} not found`);
  return source.replace(re, (line) => line.replace(/"[^"]*"/, `"${value}"`));
}

/** The release notes of one version in a package changelog: its bullets, minus dependency bumps. */
export function entriesFor(changelog: string, version: string): string[] {
  const lines = changelog.split("\n");
  const at = lines.findIndex((l) => l.trim() === `## ${version}`);
  if (at < 0) return [];
  const out: string[] = [];
  let skipping = false;
  for (const line of lines.slice(at + 1)) {
    if (line.startsWith("## ")) break;
    if (line.startsWith("- ")) {
      // dependency bumps: "- Updated dependencies [...]" or "- @flowaid/shared@0.4.0"
      skipping = /^- (Updated dependencies|@?[\w./-]+@\d)/.test(line);
      if (!skipping) out.push(line.replace(/^- [0-9a-f]{7,40}: /, "- "));
    } else if (/^\s+\S/.test(line) && !skipping && out.length > 0) {
      out[out.length - 1] += `\n${line}`;
    }
  }
  return out;
}

/** Inserts the version's section above the newest one; a version already present is left alone. */
export function prependRelease(
  changelog: string,
  version: string,
  date: string,
  entries: readonly string[],
): string {
  if (new RegExp(`^## ${version.replace(/\./g, "\\.")}\\b`, "m").test(changelog)) return changelog;
  const body = entries.length ? entries.join("\n") : "- Maintenance release.";
  const section = `## ${version} — ${date}\n\n${body}\n\n`;
  const first = changelog.search(/^## /m);
  return first < 0
    ? `${changelog.trimEnd()}\n\n${section}`
    : changelog.slice(0, first) + section + changelog.slice(first);
}

function workspacePackages(): { dir: string; name: string; version: string }[] {
  const out: { dir: string; name: string; version: string }[] = [];
  for (const group of ["apps", "packages"]) {
    for (const entry of readdirSync(join(ROOT, group), { withFileTypes: true })) {
      const file = join(ROOT, group, entry.name, "package.json");
      if (!entry.isDirectory() || !existsSync(file)) continue;
      const pkg = JSON.parse(readFileSync(file, "utf8")) as { name: string; version: string };
      out.push({ dir: join(ROOT, group, entry.name), name: pkg.name, version: pkg.version });
    }
  }
  return out;
}

function main(): void {
  const packages = workspacePackages();
  const versions = new Map(
    packages
      .filter((p) => p.name.startsWith("@flowaid/"))
      .map((p) => [p.name.slice("@flowaid/".length), p.version]),
  );
  writeFileSync(CLOSURE, syncPackageVersions(readFileSync(CLOSURE, "utf8"), versions));

  // The node SDK version plugins are checked against: the platform's own, the scaffold's, and
  // the `flowaid.sdk` range of every node package in the workspace (bundled plugins included).
  const sdk = versions.get("node-sdk");
  if (!sdk) throw new Error("@flowaid/node-sdk has no version");
  const range = `^${sdk}`;
  const edit = (file: string, fn: (s: string) => string) =>
    writeFileSync(join(ROOT, file), fn(readFileSync(join(ROOT, file), "utf8")));
  const own = (name: string) => {
    const v = versions.get(name);
    if (!v) throw new Error(`@flowaid/${name} has no version`);
    return v;
  };
  edit("packages/plugins/src/resolve.ts", (s) => syncConstant(s, "PLATFORM_SDK_VERSION", sdk));
  edit("packages/create-flowaid-node/src/scaffold.ts", (s) =>
    syncConstant(syncConstant(s, "SDK_RANGE", range), "SDK_VERSION", sdk),
  );
  // the bundled node packages describe themselves (plugin rows, compatibility checks)
  for (const name of ["nodes-core", "nodes-langchain"])
    edit(`packages/${name}/src/index.ts`, (s) =>
      syncConstant(syncConstant(s, "PACKAGE_VERSION", own(name)), "SDK_RANGE", range),
    );
  edit("packages/cli/src/program.ts", (s) => syncConstant(s, "CLI_VERSION", own("cli")));
  for (const p of packages) {
    const file = join(p.dir, "package.json");
    const text = readFileSync(file, "utf8");
    const pkg = JSON.parse(text) as { flowaid?: { sdk?: string } };
    if (pkg.flowaid?.sdk && pkg.flowaid.sdk !== range)
      writeFileSync(file, text.replace(`"sdk": "${pkg.flowaid.sdk}"`, `"sdk": "${range}"`));
  }

  const version = versions.get("api");
  if (!version) throw new Error("@flowaid/api has no version");
  const entries = [
    ...new Set(
      packages.flatMap((p) => {
        const file = join(p.dir, "CHANGELOG.md");
        return existsSync(file) ? entriesFor(readFileSync(file, "utf8"), version) : [];
      }),
    ),
  ];
  const date = new Date().toISOString().slice(0, 10);
  writeFileSync(
    ROOT_CHANGELOG,
    prependRelease(readFileSync(ROOT_CHANGELOG, "utf8"), version, date, entries),
  );
  console.log(`version ${version}: ${entries.length} changelog entries`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
