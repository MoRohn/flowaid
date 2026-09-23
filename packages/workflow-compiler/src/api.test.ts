import type { NodeManifest } from "@flowaid/workflow-core";
import { describe, expect, it } from "vitest";
import {
  COMPILER_VERSION,
  checkBinding,
  compile,
  diff,
  migrateDefinition,
  validate,
  verifyPlan,
} from "./index.js";
import { FIXTURE_MANIFESTS, catalogOf, fixtureCatalog, readJson } from "./test/support.js";

type Doc = Record<string, any>;
const base = (): Doc => readJson("example-support-reply.json") as Doc;
const node = (doc: Doc, id: string): Doc => (doc.nodes as Doc[]).find((n) => n.id === id) as Doc;

describe("compile options", () => {
  it("defaults to draft level and the package's compiler version", () => {
    const result = compile(base(), { catalog: fixtureCatalog() });
    expect(result.ok && result.plan.compilerVersion).toBe(COMPILER_VERSION);
  });

  it("validate() returns exactly compile()'s diagnostics", () => {
    const doc = base();
    node(doc, "draft").inputs.prompt = { kind: "template", source: "{{ nope.x }}" };
    expect(validate(doc, { catalog: fixtureCatalog() })).toEqual(
      compile(doc, { catalog: fixtureCatalog() }).diagnostics,
    );
  });

  it("stops after the pass group that failed (no type checks when structure is broken)", () => {
    const doc = base();
    node(doc, "intent").type = "flowaid.decision.nope";
    const codes = compile(doc, { catalog: fixtureCatalog() }).diagnostics.map((d) => d.code);
    expect(codes).toContain("E_UNKNOWN_NODE_TYPE");
    expect(codes).not.toContain("E_TYPE_MISMATCH");
  });
});

describe("diff", () => {
  it("is empty for identical documents and layout-only for moved nodes", () => {
    const a = base();
    const b = base();
    const same = diff(a, b);
    expect(same.layoutOnly).toBe(false);
    expect(same.nodes).toEqual({ added: [], removed: [], changed: [] });
    b.layout = { nodes: { start: { x: 10, y: 20 } } };
    expect(diff(a, b).layoutOnly).toBe(true);
  });

  it("reports added, removed and changed nodes, rewired edges and section patches", () => {
    const a = base();
    const b = base();
    b.nodes = b.nodes.filter((n: Doc) => n.id !== "out_rejected");
    b.edges = b.edges.filter((e: Doc) => e.to.node !== "out_rejected");
    b.nodes.push({ id: "note", kind: "note", name: "Note", text: "hi" });
    node(b, "draft").config.temperature = 0.1;
    b.edges.find((e: Doc) => e.id === "c2").to.node = "approve";
    b.variables[1].default = 0.9;
    b.name = "Renamed";
    const d = diff(a, b);
    expect(d.nodes.added).toEqual(["note"]);
    expect(d.nodes.removed).toEqual(["out_rejected"]);
    expect(d.nodes.changed).toEqual([
      { id: "draft", patch: [{ op: "replace", path: "/config/temperature", value: 0.1 }] },
    ]);
    expect(d.edges).toEqual({ added: ["c2"], removed: ["c2", "c5", "c6"] });
    expect(d.variables).toEqual([{ op: "replace", path: "/1/default", value: 0.9 }]);
    expect(d.document).toEqual([{ op: "replace", path: "/name", value: "Renamed" }]);
    expect(d.layoutOnly).toBe(false);
  });
});

describe("migrateDefinition", () => {
  const choice = FIXTURE_MANIFESTS.find((m) => m.id === "flowaid.decision.choice") as NodeManifest;
  const catalog = catalogOf([
    ...FIXTURE_MANIFESTS,
    { ...choice, version: "1.1.0", migrations: ["1.0.0"] },
    { ...choice, version: "2.0.0", migrations: ["1.1.0"] },
    { ...choice, version: "3.0.0", migrations: [] },
  ]);

  it("follows the declared chain one version at a time and stops where it ends", () => {
    const { def, applied } = migrateDefinition(base(), catalog);
    expect(applied).toEqual([
      { node: "intent", from: "1.0.0", to: "1.1.0" },
      { node: "intent", from: "1.1.0", to: "2.0.0" },
    ]);
    expect(node(def, "intent").typeVersion).toBe("2.0.0");
  });

  it("lets the caller transform config per step and never mutates the input", () => {
    const input = base();
    const { def } = migrateDefinition(input, catalog, {
      transform: ({ config, to }) => ({
        ...config,
        instructions: `${config.instructions as string} [${to}]`,
      }),
    });
    expect(node(def, "intent").config.instructions).toMatch(/\[1\.1\.0\] \[2\.0\.0\]$/);
    expect(node(input, "intent").typeVersion).toBe("1.0.0");
  });
});

describe("checkBinding", () => {
  it("accepts a well-typed binding and returns its schema", () => {
    const check = checkBinding(
      base(),
      { node: "gate", port: "decision" },
      { kind: "ref", ref: { kind: "port", node: "intent", port: "decision" } },
      { catalog: fixtureCatalog() },
    );
    expect(check.ok).toBe(true);
    expect(check.schema).toMatchObject({ type: "object" });
  });

  it("reports only the diagnostics of that binding", () => {
    const check = checkBinding(
      base(),
      { node: "gate", port: "decision" },
      { kind: "ref", ref: { kind: "port", node: "draft", port: "text" } },
      { catalog: fixtureCatalog() },
    );
    expect(check.ok).toBe(false);
    expect(check.diagnostics.map((d) => d.code)).toEqual(["E_TYPE_MISMATCH"]);
  });

  it("rejects nodes without bindable inputs", () => {
    const check = checkBinding(
      base(),
      { node: "route", port: "x" },
      { kind: "literal", value: 1 },
      { catalog: fixtureCatalog() },
    );
    expect(check.ok).toBe(false);
  });
});

describe("verifyPlan", () => {
  it("accepts the plan compiled from the same definition", () => {
    const result = compile(base(), { catalog: fixtureCatalog() });
    if (!result.ok) throw new Error("must compile");
    expect(verifyPlan(result.plan, base(), { catalog: fixtureCatalog() })).toEqual([]);
  });

  it("rejects a plan the definition no longer compiles to", () => {
    const result = compile(base(), { catalog: fixtureCatalog() });
    if (!result.ok) throw new Error("must compile");
    const changed = base();
    node(changed, "draft").config.temperature = 0.9;
    expect(
      verifyPlan(result.plan, changed, { catalog: fixtureCatalog() }).map((d) => d.code),
    ).toEqual(["E_PLAN_HASH_MISMATCH"]);
  });
});
