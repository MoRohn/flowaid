/**
 * Generates the `@flowaid/ui` group → exports table in `docs/design/UI.md` §3 from the
 * fourteen `packages/ui/src/<group>/index.ts` files, so the doc always names the code
 * names that actually ship (UI.md §3 "Names are the code names exported from …").
 *
 * Run with `pnpm ui:inventory` (tsx) to rewrite the block between the
 * `<!-- ui-inventory:start -->` / `<!-- ui-inventory:end -->` markers; pass `--check`
 * to exit non-zero when the checked-in doc is stale. `scripts/ui-inventory.test.ts`
 * runs the same comparison in CI (`pnpm boundaries`).
 *
 * Only value exports (components, hooks, helpers, constants) are listed; type-only
 * exports are the contracts and are documented with them. Planned line items and
 * later-phase components are annotations kept here, next to the generator, so the doc
 * can still point at what is coming without inventing exports.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { format as prettierFormat, resolveConfig } from "prettier";
import ts from "typescript";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const UI_SRC = join(ROOT, "packages/ui/src");
export const UI_DOC = join(ROOT, "docs/design/UI.md");
export const START_MARKER = "<!-- ui-inventory:start -->";
export const END_MARKER = "<!-- ui-inventory:end -->";

/** The fourteen groups, in the order the table lists them (README "Groups and the import direction"). */
export const UI_GROUPS = [
  "lib",
  "theme",
  "primitives",
  "decision",
  "data",
  "inspector",
  "forms",
  "node",
  "canvas",
  "trace",
  "observability",
  "human",
  "builder",
  "shell",
] as const;
export type UiGroup = (typeof UI_GROUPS)[number];

/** Line items the plan still owes each group (UPGRADE_PLAN.md P0-16 … P4-02); marked *(planned)* in the doc. */
export const PLANNED: Partial<Record<UiGroup, readonly string[]>> = {
  canvas: ["ProblemsOverlay"],
  trace: ["NodeRunDetail", "GenerationCard"],
  inspector: ["PortRow", "RefPicker", "DependencyPanel"],
  shell: ["DraftStatusPill"],
  observability: ["CostBreakdown"],
  human: ["ReviewForm", "ExternalReviewPage"],
  builder: ["PublishDialog", "ConflictDialog", "ExportDialog", "RunPanel"],
};

/** Exports that exist but mount only behind their `FeatureKey`; marked *(later phase)* in the doc. */
export const LATER_PHASE: Partial<Record<UiGroup, readonly string[]>> = {
  builder: ["AIBuilderPanel", "WorkflowCriticPanel", "CostOptimizerPanel"],
};

/** Exports kept for one release on their old path; marked *(deprecated)* in the doc. */
export const DEPRECATED: Partial<Record<UiGroup, readonly string[]>> = {
  inspector: [
    "JsonView",
    "buildJsonPath",
    "DiffView",
    "toDiffText",
    "diffTextLines",
    "diffSequences",
    "diffStats",
    "diffTokens",
    "chunkDiff",
    "toSplitRows",
    "splitLines",
    "tokenize",
  ],
  shell: ["BottomPanel"],
};

function resolveModule(fromFile: string, specifier: string): string | undefined {
  const base = resolve(dirname(fromFile), specifier);
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node)
    ? (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    : false;
}

/**
 * Value exports of a module in declaration order: named re-exports (`export { a, b as c }`,
 * skipping `type` specifiers), `export *` targets (recursively) and exported declarations.
 */
export function valueExportsOf(file: string, seen: Set<string> = new Set()): string[] {
  if (seen.has(file)) return [];
  seen.add(file);
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const names: string[] = [];
  const push = (name: string) => {
    if (!names.includes(name)) names.push(name);
  };
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly) continue;
      const specifier =
        statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
          ? statement.moduleSpecifier.text
          : undefined;
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          if (element.isTypeOnly) continue;
          push(element.name.text);
        }
      } else if (!statement.exportClause && specifier) {
        const target = resolveModule(file, specifier);
        if (target) for (const name of valueExportsOf(target, seen)) push(name);
      }
      continue;
    }
    if (!hasExportModifier(statement)) continue;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) push(declaration.name.text);
      }
    } else if (
      ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isEnumDeclaration(statement)
    ) {
      if (statement.name) push(statement.name.text);
    }
  }
  return names;
}

export interface GroupInventory {
  group: UiGroup;
  exports: string[];
}

/** The inventory of every group, read from its `index.ts`. */
export function collectInventory(src: string = UI_SRC): GroupInventory[] {
  return UI_GROUPS.map((group) => {
    const index = join(src, group, "index.ts");
    if (!existsSync(index)) throw new Error(`missing ${index}`);
    return { group, exports: valueExportsOf(index) };
  });
}

function annotate(group: UiGroup, name: string): string {
  const code = `\`${name}\``;
  if (LATER_PHASE[group]?.includes(name)) return `${code} _(later phase)_`;
  if (DEPRECATED[group]?.includes(name)) return `${code} _(deprecated)_`;
  return code;
}

/** The raw Markdown block that goes between the markers (see {@link formatInventory} for the checked-in form). */
export function renderInventory(inventory: GroupInventory[] = collectInventory()): string {
  const lines: string[] = [
    START_MARKER,
    "",
    "`@flowaid/ui` group → value exports. Names are the **code names** exported from `packages/ui/src/<group>/index.ts`; `scripts/ui-inventory.ts` regenerates this table (`pnpm ui:inventory`) and `scripts/ui-inventory.test.ts` fails CI when the two diverge. Entries marked _(planned)_ are line items of the upgrade plan not yet exported; _(later phase)_ exports mount only behind their `FeatureKey`; _(deprecated)_ exports stay on their old path for one release.",
    "",
    "| group | exports |",
    "|---|---|",
  ];
  for (const { group, exports } of inventory) {
    const cells = exports.map((name) => annotate(group, name));
    const planned = (PLANNED[group] ?? []).map((name) => `\`${name}\` _(planned)_`);
    lines.push(`| \`${group}\` | ${[...cells, ...planned].join(", ")} |`);
  }
  lines.push("", END_MARKER);
  return lines.join("\n");
}

/**
 * The block as the repository's Prettier config prints it (padded table cells), so
 * `pnpm format` and `pnpm ui:inventory` agree on the checked-in bytes.
 */
export async function formatInventory(block: string = renderInventory()): Promise<string> {
  const options = (await resolveConfig(UI_DOC)) ?? {};
  const formatted = await prettierFormat(block, { ...options, parser: "markdown" });
  return formatted.trimEnd();
}

/** Replaces the block between the markers in a document, or throws when the markers are missing. */
export function injectInventory(doc: string, block: string): string {
  const start = doc.indexOf(START_MARKER);
  const end = doc.indexOf(END_MARKER);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`${UI_DOC} must contain ${START_MARKER} … ${END_MARKER}`);
  }
  return doc.slice(0, start) + block + doc.slice(end + END_MARKER.length);
}

/** The block currently checked in. */
export function currentInventoryBlock(doc: string): string {
  const start = doc.indexOf(START_MARKER);
  const end = doc.indexOf(END_MARKER);
  if (start === -1 || end === -1 || end < start) return "";
  return doc.slice(start, end + END_MARKER.length);
}

async function main(): Promise<void> {
  const check = process.argv.includes("--check");
  const doc = readFileSync(UI_DOC, "utf8");
  const next = injectInventory(doc, await formatInventory());
  if (next === doc) {
    console.log(`up to date  ${UI_DOC}`);
    return;
  }
  if (check) {
    console.error(`stale       ${UI_DOC} (run pnpm ui:inventory)`);
    process.exit(1);
  }
  writeFileSync(UI_DOC, next);
  console.log(`rewrote     ${UI_DOC}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
