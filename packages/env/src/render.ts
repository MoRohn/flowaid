/**
 * Renders the environment variable table as `.env.example` and as a Markdown table for the
 * README. `scripts/gen-env-example.ts` writes the files; `docs.test.ts` verifies that the
 * checked-in files equal this output.
 */

import {
  ENV_GROUPS,
  ENV_GROUP_TITLES,
  ENV_VAR_DOCS,
  ENV_VAR_NAMES,
  type EnvVarDoc,
  type EnvVarName,
} from "./docs.js";

/** Markers between which the README table is (re)generated. */
export const README_TABLE_START = "<!-- env-table:start -->";
export const README_TABLE_END = "<!-- env-table:end -->";

function wrap(text: string, width: number, prefix: string): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current === "") {
      current = word;
    } else if (current.length + 1 + word.length > width) {
      lines.push(current);
      current = word;
    } else {
      current = `${current} ${word}`;
    }
  }
  if (current !== "") {
    lines.push(current);
  }
  return lines.map((line) => `${prefix}${line}`);
}

function byGroup(): [group: (typeof ENV_GROUPS)[number], names: EnvVarName[]][] {
  return ENV_GROUPS.map((group) => [
    group,
    ENV_VAR_NAMES.filter((name) => ENV_VAR_DOCS[name].group === group),
  ]);
}

function exampleLine(name: EnvVarName, doc: EnvVarDoc): string {
  if (doc.required) {
    return `${name}=${doc.example}`;
  }
  if (doc.composeRequired === true) {
    return `${name}=`;
  }
  if (doc.quickstart !== undefined) {
    return `${name}=${doc.quickstart}`;
  }
  if (doc.default !== undefined) {
    return `${name}=${doc.default}`;
  }
  return `# ${name}=${doc.example}`;
}

/**
 * The text of `.env.example`: every variable grouped, described in comments, with required
 * variables set to their example, defaulted variables set to their default, quick-start
 * variables set to their local value and every other optional variable commented out.
 */
export function renderEnvExample(): string {
  const out: string[] = [
    "# flowaid environment — generated from packages/env/src/docs.ts by `pnpm env:example`.",
    "# Copy to `.env` and edit. Every variable is documented in packages/env/README.md.",
    "# Required variables are set to a working local example; defaults are shown as set;",
    "# the first-boot owner is set to local quick-start values (change them before any",
    "# deployment; production refuses them); passwords the compose stack requires are left",
    "# empty for you to generate; other optional variables are commented out.",
  ];
  for (const [group, names] of byGroup()) {
    out.push(
      "",
      `# ── ${ENV_GROUP_TITLES[group]} ${"─".repeat(Math.max(3, 78 - ENV_GROUP_TITLES[group].length - 5))}`,
    );
    for (const name of names) {
      const doc = ENV_VAR_DOCS[name];
      out.push("");
      out.push(...wrap(doc.description.replace(/`/g, ""), 76, "# "));
      if (doc.values !== undefined) {
        out.push(`# Values: ${doc.values.join(" | ")}`);
      }
      if (doc.quickstart !== undefined) {
        out.push(`# Quick-start value; example: ${doc.example}`);
      } else if (doc.composeRequired === true) {
        out.push(`# Required by docker compose (no default); example: ${doc.example}`);
      } else if (!doc.required && doc.default === undefined) {
        out.push(`# Example: ${doc.example}`);
      }
      out.push(exampleLine(name, doc));
    }
  }
  out.push("");
  return out.join("\n");
}

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/** The Markdown table of every variable, grouped, for the README. */
export function renderReadmeTable(): string {
  const out: string[] = [];
  for (const [group, names] of byGroup()) {
    out.push(`### ${ENV_GROUP_TITLES[group]}`, "");
    out.push("| Variable | Required | Default | Description |", "|---|---|---|---|");
    for (const name of names) {
      const doc = ENV_VAR_DOCS[name];
      const required = doc.required ? "yes" : doc.composeRequired === true ? "compose" : "no";
      const def = doc.default === undefined ? "—" : `\`${doc.default}\``;
      const values =
        doc.values === undefined ? "" : ` Values: ${doc.values.map((v) => `\`${v}\``).join(", ")}.`;
      const secret = doc.secret ? " Secret." : "";
      const example =
        doc.required || doc.default === undefined ? ` Example: \`${cell(doc.example)}\`.` : "";
      const quickstart =
        doc.quickstart === undefined ? "" : ` Quick start: \`${cell(doc.quickstart)}\`.`;
      const family = doc.pattern === true ? " A family of variables, not a setting." : "";
      const compose = doc.composeOnly === true ? " Compose only: not read by the api." : "";
      out.push(
        `| \`${name}\` | ${required} | ${def} | ${cell(doc.description)}${values}${example}${quickstart}${secret}${family}${compose} |`,
      );
    }
    out.push("");
  }
  return out.join("\n").trimEnd();
}

/**
 * Replaces the section between {@link README_TABLE_START} and {@link README_TABLE_END} in a
 * README with the generated table. Throws when the markers are missing.
 */
export function injectReadmeTable(readme: string): string {
  const start = readme.indexOf(README_TABLE_START);
  const end = readme.indexOf(README_TABLE_END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`README is missing the ${README_TABLE_START} / ${README_TABLE_END} markers`);
  }
  const before = readme.slice(0, start + README_TABLE_START.length);
  const after = readme.slice(end);
  return `${before}\n\n${renderReadmeTable()}\n\n${after}`;
}
