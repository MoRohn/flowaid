import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  canonicalDefinition,
  definitionHash,
  WorkflowDefinitionSchema,
  type WorkflowDefinition,
} from "./definition.js";
import exampleSupportReply from "../fixtures/example-support-reply.json" with { type: "json" };
import supportTriage from "../fixtures/support-triage.json" with { type: "json" };
import githubIssueTriage from "../fixtures/github-issue-triage.json" with { type: "json" };
import researchAgent from "../fixtures/research-agent.json" with { type: "json" };

const FIXTURES: Record<string, unknown> = {
  "example-support-reply": exampleSupportReply,
  "support-triage": supportTriage,
  "github-issue-triage": githubIssueTriage,
  "research-agent": researchAgent,
};
/** Parses a fresh copy of a fixture (each call yields an independent object). */
function loadFixture(name: string): WorkflowDefinition {
  return WorkflowDefinitionSchema.parse(JSON.parse(JSON.stringify(FIXTURES[name])));
}

/** Rebuilds an object with its keys in reverse insertion order (recursively). */
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).reverse())
      out[key] = reverseKeys((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
}

describe("definitionHash", () => {
  const def = loadFixture("example-support-reply");

  it("is a lowercase hex sha256 and deterministic", () => {
    const h = definitionHash(def);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(definitionHash(def)).toBe(h);
    expect(definitionHash(loadFixture("example-support-reply"))).toBe(h);
  });

  it("ignores layout", () => {
    const moved: WorkflowDefinition = {
      ...def,
      layout: { nodes: { start: { x: 999, y: 999 } }, viewport: { x: 1, y: 2, zoom: 3 } },
    };
    const { layout: _layout, ...withoutLayout } = def;
    expect(definitionHash(moved)).toBe(definitionHash(def));
    expect(definitionHash(WorkflowDefinitionSchema.parse(withoutLayout))).toBe(definitionHash(def));
  });

  it("ignores metadata", () => {
    expect(definitionHash({ ...def, metadata: { author: "x", tags: ["a"] } })).toBe(
      definitionHash(def),
    );
  });

  it("ignores key order", () => {
    const reversed = WorkflowDefinitionSchema.parse(reverseKeys(def));
    expect(JSON.stringify(reversed)).not.toBe(JSON.stringify(def));
    expect(definitionHash(reversed)).toBe(definitionHash(def));
  });

  it("ignores node and edge order", () => {
    const shuffled: WorkflowDefinition = {
      ...def,
      nodes: [...def.nodes].reverse(),
      edges: [...def.edges].reverse(),
    };
    expect(definitionHash(shuffled)).toBe(definitionHash(def));
  });

  it("ignores undefined-valued properties", () => {
    const withUndefined = {
      ...def,
      layout: undefined,
      nodes: def.nodes.map((n) => ({ ...n, description: undefined })),
    };
    expect(definitionHash(withUndefined as WorkflowDefinition)).toBe(definitionHash(def));
  });

  it("changes when the substance changes", () => {
    const base = definitionHash(def);
    expect(definitionHash({ ...def, name: "Renamed" })).not.toBe(base);
    expect(definitionHash({ ...def, description: "other" })).not.toBe(base);
    expect(definitionHash({ ...def, edges: def.edges.slice(1) })).not.toBe(base);
    expect(
      definitionHash({
        ...def,
        execution: { ...def.execution, timeoutMs: def.execution.timeoutMs + 1 },
      }),
    ).not.toBe(base);
    const nodes = def.nodes.map((n) => (n.id === "route" ? { ...n, name: "Changed" } : n));
    expect(definitionHash({ ...def, nodes })).not.toBe(base);
  });

  it("differs between the fixtures", () => {
    const hashes = [
      "example-support-reply",
      "support-triage",
      "github-issue-triage",
      "research-agent",
    ].map((n) => definitionHash(loadFixture(n)));
    expect(new Set(hashes).size).toBe(4);
  });

  it("hashes a raw document and its parsed form identically (RFC-0008)", () => {
    for (const name of Object.keys(FIXTURES)) {
      const raw: unknown = JSON.parse(JSON.stringify(FIXTURES[name]));
      const parsed = WorkflowDefinitionSchema.parse(raw);
      expect(definitionHash(raw), name).toBe(definitionHash(parsed));
      expect(definitionHash(parsed), name).toBe(
        definitionHash(WorkflowDefinitionSchema.parse(parsed)),
      );
    }
  });

  it("treats an omitted default and its explicit value as the same document", () => {
    const raw: unknown = JSON.parse(JSON.stringify(FIXTURES["example-support-reply"]));
    if (typeof raw !== "object" || raw === null || Array.isArray(raw))
      throw new Error("fixture is an object");
    const {
      execution: _execution,
      description: _description,
      ...withoutDefaults
    } = raw as Record<string, unknown>;
    const explicit = {
      ...withoutDefaults,
      description: "",
      execution: WorkflowDefinitionSchema.parse(withoutDefaults).execution,
    };
    expect(definitionHash(withoutDefaults)).toBe(definitionHash(explicit));
    expect(definitionHash({ ...withoutDefaults, description: "x" })).not.toBe(
      definitionHash(withoutDefaults),
    );
  });

  it("rejects a document the schema rejects instead of hashing it", () => {
    expect(() => definitionHash({ ...def, nodes: [] })).toThrow(ZodError);
    expect(() => definitionHash(null)).toThrow(ZodError);
    expect(() => definitionHash({ ...def, $schema: "https://example.com/other" })).toThrow(
      ZodError,
    );
    const nan = { ...def, nodes: def.nodes.map((n) => ({ ...n, disabled: Number.NaN })) };
    expect(() => definitionHash(nan)).toThrow(ZodError);
  });

  it("throws a TypeError on duplicate node or edge ids", () => {
    const first = def.nodes[0];
    if (first === undefined) throw new Error("fixture has nodes");
    const dupNodes = { ...def, nodes: [...def.nodes, { ...first }] };
    expect(() => definitionHash(dupNodes)).toThrow(TypeError);
    expect(() => definitionHash(dupNodes)).toThrow(`duplicate node id '${first.id}'`);
    const edge = def.edges[0];
    if (edge === undefined) throw new Error("fixture has edges");
    const dupEdges = { ...def, edges: [...def.edges, { ...edge, to: { ...edge.to } }] };
    expect(() => definitionHash(dupEdges)).toThrow(TypeError);
    expect(() => definitionHash(dupEdges)).toThrow(`duplicate edge id '${edge.id}'`);
    expect(() => canonicalDefinition(dupNodes)).toThrow(TypeError);
    expect(() => canonicalDefinition(dupEdges)).toThrow(TypeError);
  });
});

describe("canonicalDefinition", () => {
  const def = loadFixture("research-agent");

  it("rejects non-JSON values instead of silently altering the document", () => {
    const bad = {
      ...def,
      metadata: {},
      nodes: def.nodes.map((n) => ({ ...n, disabled: Number.NaN as unknown as boolean })),
    };
    expect(() => canonicalDefinition(bad)).toThrow(TypeError);
    expect(() => canonicalDefinition(bad)).toThrow(/non-finite number/);
    const fn = {
      ...def,
      nodes: def.nodes.map((n) => ({ ...n, name: (() => "x") as unknown as string })),
    };
    expect(() => canonicalDefinition(fn)).toThrow(/function is not a JSON value/);
  });

  it("drops layout and metadata and sorts nodes/edges by id", () => {
    const canon = canonicalDefinition({ ...def, metadata: { x: 1 } });
    expect(canon).toBeTypeOf("object");
    if (typeof canon !== "object" || canon === null || Array.isArray(canon))
      throw new Error("expected object");
    expect(canon).not.toHaveProperty("layout");
    expect(canon).not.toHaveProperty("metadata");
    const nodes = canon.nodes;
    const edges = canon.edges;
    if (!Array.isArray(nodes) || !Array.isArray(edges)) throw new Error("expected arrays");
    const nodeIds = nodes.map((n) =>
      typeof n === "object" && n !== null && !Array.isArray(n) ? n.id : undefined,
    );
    expect(nodeIds).toEqual([...nodeIds].sort());
    const edgeIds = edges.map((e) =>
      typeof e === "object" && e !== null && !Array.isArray(e) ? e.id : undefined,
    );
    expect(edgeIds).toEqual([...edgeIds].sort());
    expect(canon.name).toBe("Research Agent");
  });

  it("does not mutate its input", () => {
    const before = JSON.stringify(def);
    canonicalDefinition(def);
    expect(JSON.stringify(def)).toBe(before);
  });
});
