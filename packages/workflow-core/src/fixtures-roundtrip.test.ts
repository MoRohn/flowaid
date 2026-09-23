/**
 * Round-trip and hashing guarantees for every golden workflow fixture in `fixtures/*.json`
 * (read from disk, so a new fixture is covered the moment it is added):
 * parse → stringify → parse is the identity, and `definitionHash` ignores key order,
 * node/edge order, layout and metadata while reacting to every substantive change.
 * Only the top-level files are first-slice definitions: the knowledge-slice variants in
 * `fixtures/variants/` and the `fixtures/templates/*.resources.json` blocks are covered by
 * `fixtures.test.ts`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  WorkflowDefinitionSchema,
  canonicalDefinition,
  definitionHash,
  type WorkflowDefinition,
} from "./definition.js";
import { WORKFLOW_SCHEMA_URI } from "./definition.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const FIXTURE_FILES = readdirSync(FIXTURES_DIR)
  .filter((f) => f.endsWith(".json"))
  .sort();

/**
 * Golden `definitionHash` of every fixture (RFC-0008). Resolved schema
 * defaults are part of the hash, so a changed default in `policy.ts` /
 * `definition.ts` — or an edited fixture — shows up here as a reviewed diff
 * and, for a default, a hash-changing release noted in `VERSIONS.md`.
 */
const GOLDEN_HASHES: Readonly<Record<string, string>> = {
  "example-support-reply.json": "d86f40190bb139f3aca03f12fcb59cfe8c327db928c410e772bf949e701d9228",
  "github-issue-triage.json": "fbb3c9129da615fb78f8b88d272493f476ffd0ca131cb526452b74bb39623ca6",
  "research-agent.json": "964543cefb52c83bf1f3488d572740357396aa67d5318dbb57297d6f123076cd",
  "support-triage.json": "a844a4cba93f9706ef4bdfd2bb897131ad0b18a207c5048457fc291aa4606a4f",
};

function readRaw(file: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, file), "utf8"));
}

/** Deterministic deep key reordering: reverse insertion order at every level. */
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (typeof value === "object" && value !== null) {
    const record: Record<string, unknown> = { ...value };
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).reverse()) out[key] = reverseKeys(record[key]);
    return out;
  }
  return value;
}

/** Deterministic deep key reordering: sorted at every level (a different order from `reverseKeys`). */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === "object" && value !== null) {
    const record: Record<string, unknown> = { ...value };
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) out[key] = sortKeys(record[key]);
    return out;
  }
  return value;
}

describe("golden workflow fixtures", () => {
  it("exist for the example workflow and the three demos", () => {
    expect(FIXTURE_FILES).toEqual([
      "example-support-reply.json",
      "github-issue-triage.json",
      "research-agent.json",
      "support-triage.json",
    ]);
  });

  for (const file of FIXTURE_FILES) {
    describe(file, () => {
      const raw = readRaw(file);
      const parsed: WorkflowDefinition = WorkflowDefinitionSchema.parse(raw);

      it("parse → stringify → parse is the identity", () => {
        const text = JSON.stringify(parsed);
        const again = WorkflowDefinitionSchema.parse(JSON.parse(text));
        expect(again).toEqual(parsed);
        expect(JSON.stringify(again)).toBe(text);
        expect(JSON.parse(JSON.stringify(again))).toEqual(parsed);
        expect(parsed.$schema).toBe(WORKFLOW_SCHEMA_URI);
      });

      it("only adds defaults when parsed (the authored file is a subset of its parse)", () => {
        const parsedAgain = WorkflowDefinitionSchema.parse(raw);
        expect(parsedAgain).toEqual(parsed);
        expect(JSON.stringify(raw).length).toBeLessThanOrEqual(JSON.stringify(parsed).length);
        expect(definitionHash(parsedAgain)).toBe(definitionHash(parsed));
      });

      it("definitionHash is a 64-char lowercase sha256 hex and deterministic", () => {
        const hash = definitionHash(parsed);
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
        expect(definitionHash(WorkflowDefinitionSchema.parse(readRaw(file)))).toBe(hash);
      });

      it("definitionHash of the raw document equals the golden constant and the hash of its parse (RFC-0008)", () => {
        const golden = GOLDEN_HASHES[file];
        expect(golden, `${file} needs a golden hash`).toBeDefined();
        expect(definitionHash(raw)).toBe(golden);
        expect(definitionHash(parsed)).toBe(golden);
        expect(definitionHash(WorkflowDefinitionSchema.parse(parsed))).toBe(golden);
        expect(definitionHash(JSON.parse(JSON.stringify(parsed)))).toBe(golden);
      });

      it("definitionHash ignores key order at every depth", () => {
        const hash = definitionHash(parsed);
        const reversed = WorkflowDefinitionSchema.parse(reverseKeys(raw));
        const sorted = WorkflowDefinitionSchema.parse(sortKeys(raw));
        expect(JSON.stringify(reversed)).not.toBe(JSON.stringify(parsed));
        expect(definitionHash(reversed)).toBe(hash);
        expect(definitionHash(sorted)).toBe(hash);
      });

      it("definitionHash ignores layout changes and removal", () => {
        const hash = definitionHash(parsed);
        const moved: WorkflowDefinition = {
          ...parsed,
          layout: {
            nodes: Object.fromEntries(
              parsed.nodes.map((n, i) => [
                n.id,
                { x: i * 17, y: -i, w: 200, h: 80, collapsed: i % 2 === 0 },
              ]),
            ),
            viewport: { x: 12, y: 34, zoom: 0.5 },
          },
        };
        const { layout: _layout, ...withoutLayout } = parsed;
        expect(definitionHash(moved)).toBe(hash);
        expect(definitionHash(WorkflowDefinitionSchema.parse(withoutLayout))).toBe(hash);
        expect(definitionHash({ ...parsed, layout: { nodes: {} } })).toBe(hash);
      });

      it("definitionHash ignores metadata and node/edge order", () => {
        const hash = definitionHash(parsed);
        expect(
          definitionHash({
            ...parsed,
            metadata: { author: "someone", tags: ["a", "b"], nested: { deep: true } },
          }),
        ).toBe(hash);
        expect(
          definitionHash({
            ...parsed,
            nodes: [...parsed.nodes].reverse(),
            edges: [...parsed.edges].reverse(),
          }),
        ).toBe(hash);
        const rotated = [...parsed.nodes.slice(1), ...parsed.nodes.slice(0, 1)];
        expect(definitionHash({ ...parsed, nodes: rotated })).toBe(hash);
      });

      it("definitionHash changes on every substantive edit", () => {
        const hash = definitionHash(parsed);
        const variants: WorkflowDefinition[] = [
          { ...parsed, name: `${parsed.name} (copy)` },
          { ...parsed, description: `${parsed.description} changed` },
          { ...parsed, id: "00000000-0000-4000-8000-000000000000" },
          { ...parsed, inputs: { ...parsed.inputs, description: "changed" } },
          { ...parsed, outputs: { ...parsed.outputs, description: "changed" } },
          {
            ...parsed,
            execution: { ...parsed.execution, concurrency: parsed.execution.concurrency + 1 },
          },
          {
            ...parsed,
            nodes: parsed.nodes.map((n, i) => (i === 0 ? { ...n, name: `${n.name}!` } : n)),
          },
          {
            ...parsed,
            nodes: parsed.nodes.map((n, i) => (i === 1 ? { ...n, disabled: !n.disabled } : n)),
          },
          {
            ...parsed,
            variables: [
              ...parsed.variables,
              { name: "extraVar", schema: { type: "string" }, source: "definition" },
            ],
          },
          { ...parsed, secrets: parsed.secrets.slice(1) },
          { ...parsed, triggers: [...parsed.triggers, { type: "manual" }] },
        ];
        if (parsed.edges.length > 0) variants.push({ ...parsed, edges: parsed.edges.slice(1) });
        const hashes = variants.map(definitionHash);
        for (const [i, h] of hashes.entries()) expect(h, `variant ${i}`).not.toBe(hash);
        expect(new Set(hashes).size).toBe(hashes.length);
      });

      it("canonicalDefinition drops layout/metadata, sorts nodes and edges by id and is pure", () => {
        const before = JSON.stringify(parsed);
        const canon = canonicalDefinition({ ...parsed, metadata: { x: 1 } });
        expect(JSON.stringify(parsed)).toBe(before);
        if (typeof canon !== "object" || canon === null || Array.isArray(canon))
          throw new Error("canonical definition is an object");
        expect(canon).not.toHaveProperty("layout");
        expect(canon).not.toHaveProperty("metadata");
        const ids = (list: unknown): string[] => {
          if (!Array.isArray(list)) return [];
          const items: unknown[] = list;
          return items.map((n) =>
            typeof n === "object" && n !== null && "id" in n && typeof n.id === "string"
              ? n.id
              : "",
          );
        };
        expect(ids(canon.nodes)).toEqual([...ids(canon.nodes)].sort());
        expect(ids(canon.edges)).toEqual([...ids(canon.edges)].sort());
        expect(ids(canon.nodes).sort()).toEqual(parsed.nodes.map((n) => n.id).sort());
      });
    });
  }

  it("pins a golden hash for every fixture and nothing else", () => {
    expect(Object.keys(GOLDEN_HASHES).sort()).toEqual(FIXTURE_FILES);
    expect(new Set(Object.values(GOLDEN_HASHES)).size).toBe(FIXTURE_FILES.length);
  });

  it("produces distinct hashes for distinct fixtures", () => {
    const hashes = FIXTURE_FILES.map((f) =>
      definitionHash(WorkflowDefinitionSchema.parse(readRaw(f))),
    );
    expect(new Set(hashes).size).toBe(FIXTURE_FILES.length);
  });
});
