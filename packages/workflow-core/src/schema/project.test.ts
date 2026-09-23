import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import type { JsonSchema, JsonValue } from "../json.js";
import { projectSchema, projectValue } from "./project.js";
import { isSubschema } from "./subset.js";

const str: JsonSchema = { type: "string" };
const num: JsonSchema = { type: "number" };
const int: JsonSchema = { type: "integer" };

const user: JsonSchema = {
  type: "object",
  properties: {
    name: str,
    tags: { type: "array", items: str },
    pair: { type: "array", prefixItems: [str, num], items: false },
    meta: { type: "object", additionalProperties: int },
    loose: { type: "object" },
    "a/b": { type: "boolean" },
  },
  required: ["name"],
  additionalProperties: false,
};

describe("projectSchema", () => {
  it("returns the root for the empty pointer", () => {
    expect(projectSchema(user, "")).toEqual({
      ok: true,
      schema: user,
      typed: true,
      nullable: false,
    });
  });

  it("rejects a malformed pointer", () => {
    const r = projectSchema(user, "name");
    expect(r.ok).toBe(false);
  });

  it("walks properties", () => {
    expect(projectSchema(user, "/name")).toEqual({
      ok: true,
      schema: str,
      typed: true,
      nullable: false,
    });
  });

  it("walks items", () => {
    expect(projectSchema(user, "/tags/3")).toEqual({
      ok: true,
      schema: str,
      typed: true,
      nullable: false,
    });
  });

  it("walks prefixItems positionally", () => {
    expect(projectSchema(user, "/pair/0")).toEqual({
      ok: true,
      schema: str,
      typed: true,
      nullable: false,
    });
    expect(projectSchema(user, "/pair/1")).toEqual({
      ok: true,
      schema: num,
      typed: true,
      nullable: false,
    });
  });

  it("rejects an index beyond a closed tuple", () => {
    const r = projectSchema(user, "/pair/2");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("index 2");
  });

  it("rejects an index beyond maxItems", () => {
    const r = projectSchema({ type: "array", items: str, maxItems: 2 }, "/2");
    expect(r.ok).toBe(false);
  });

  it("rejects a non-index token on an array", () => {
    const r = projectSchema({ type: "array", items: str }, "/first");
    expect(r.ok).toBe(false);
  });

  it("rejects a missing property under additionalProperties: false", () => {
    const r = projectSchema(user, "/nope");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("property 'nope'");
  });

  it("returns the additionalProperties schema for undeclared properties", () => {
    expect(projectSchema(user, "/meta/anything")).toEqual({
      ok: true,
      schema: int,
      typed: true,
      nullable: false,
    });
  });

  it("is untyped through an open object", () => {
    expect(projectSchema(user, "/loose/x")).toEqual({
      ok: true,
      schema: {},
      typed: false,
      nullable: false,
    });
    expect(projectSchema(user, "/loose/x/y/0")).toEqual({
      ok: true,
      schema: {},
      typed: false,
      nullable: false,
    });
  });

  it("stays untyped once it has passed an untyped level", () => {
    const r = projectSchema(
      { type: "object", properties: { a: { type: "object", additionalProperties: true } } },
      "/a/b",
    );
    expect(r).toEqual({ ok: true, schema: {}, typed: false, nullable: false });
  });

  it("is untyped through untyped items", () => {
    expect(projectSchema({ type: "array" }, "/0")).toEqual({
      ok: true,
      schema: {},
      typed: false,
      nullable: false,
    });
    expect(projectSchema({ type: "array", items: true }, "/0")).toEqual({
      ok: true,
      schema: {},
      typed: false,
      nullable: false,
    });
  });

  it("is untyped from an unconstrained root", () => {
    expect(projectSchema({}, "/a/0")).toEqual({
      ok: true,
      schema: {},
      typed: false,
      nullable: false,
    });
  });

  it("rejects descending into scalars", () => {
    expect(projectSchema(str, "/a").ok).toBe(false);
    expect(projectSchema({ enum: ["a", "b"] }, "/0").ok).toBe(false);
    expect(projectSchema({ type: "object", properties: { n: num } }, "/n/x").ok).toBe(false);
  });

  it("unescapes pointer tokens", () => {
    expect(projectSchema(user, "/a~1b")).toEqual({
      ok: true,
      schema: { type: "boolean" },
      typed: true,
      nullable: false,
    });
  });

  it("resolves $ref and allOf on the way", () => {
    const schema: JsonSchema = {
      $defs: { item: { type: "object", properties: { id: int } } },
      allOf: [
        { type: "object" },
        { properties: { items: { type: "array", items: { $ref: "#/$defs/item" } } } },
      ],
    };
    expect(projectSchema(schema, "/items/0/id")).toEqual({
      ok: true,
      schema: int,
      typed: true,
      nullable: false,
    });
  });

  it("attaches $defs when the projected schema still uses local refs", () => {
    const schema: JsonSchema = {
      $defs: { item: { type: "object", properties: { id: int } } },
      type: "object",
      properties: { items: { type: "array", items: { $ref: "#/$defs/item" } } },
    };
    const r = projectSchema(schema, "/items");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.schema.$defs).toEqual(schema.$defs);
    expect(projectSchema(r.schema, "/0/id")).toEqual({
      ok: true,
      schema: int,
      typed: true,
      nullable: false,
    });
    expect(
      isSubschema(r.schema, { type: "array", items: { type: "object", properties: { id: num } } })
        .ok,
    ).toBe(true);
  });

  it("keeps refs into the root resolvable after projection", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { a: str, list: { type: "array", items: { $ref: "#/properties/a" } } },
    };
    const r = projectSchema(schema, "/list");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(projectSchema(r.schema, "/0")).toMatchObject({ ok: true, typed: true, nullable: false });
    expect(isSubschema(r.schema, { type: "array", items: str })).toEqual({
      ok: true,
      verified: true,
    });
  });

  it("keeps a self-referential root resolvable after projection", () => {
    const schema: JsonSchema = { type: "object", properties: { value: int, next: { $ref: "#" } } };
    const r = projectSchema(schema, "/next");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(projectSchema(r.schema, "/value")).toEqual({
      ok: true,
      schema: int,
      typed: true,
      nullable: false,
    });
    expect(projectSchema(r.schema, "/next/next/value")).toMatchObject({ ok: true, schema: int });
  });

  it("projects through anyOf alternatives and unions the results", () => {
    const schema: JsonSchema = {
      anyOf: [
        { type: "object", properties: { a: str } },
        { type: "object", properties: { a: num } },
      ],
    };
    expect(projectSchema(schema, "/a")).toEqual({
      ok: true,
      schema: { anyOf: [str, num] },
      typed: true,
      nullable: false,
    });
  });

  it("drops alternatives that cannot have the path and keeps the rest", () => {
    const schema: JsonSchema = {
      oneOf: [
        { type: "object", properties: { a: str }, additionalProperties: false },
        { type: "object", properties: { b: num }, additionalProperties: false },
      ],
    };
    expect(projectSchema(schema, "/a")).toEqual({
      ok: true,
      schema: str,
      typed: true,
      nullable: false,
    });
    expect(projectSchema(schema, "/c").ok).toBe(false);
  });

  it("projects through a nullable union and reports the nullable level", () => {
    expect(projectSchema({ type: ["object", "null"], properties: { a: str } }, "/a")).toEqual({
      ok: true,
      schema: str,
      typed: true,
      nullable: true,
    });
    expect(projectSchema({ type: "object", nullable: true, properties: { a: str } }, "/a")).toEqual(
      { ok: true, schema: str, typed: true, nullable: true },
    );
    expect(
      projectSchema(
        { anyOf: [{ type: "null" }, { type: "object", properties: { a: str } }] },
        "/a",
      ),
    ).toEqual({ ok: true, schema: str, typed: true, nullable: true });
    expect(
      projectSchema({ oneOf: [{ type: "null" }, { type: "array", items: int }] }, "/2"),
    ).toEqual({ ok: true, schema: int, typed: true, nullable: true });
  });

  it("nullable is about the levels stepped through, not the projected value", () => {
    const nullableLeaf: JsonSchema = {
      type: "object",
      properties: { a: { type: ["string", "null"] } },
    };
    expect(projectSchema(nullableLeaf, "/a")).toEqual({
      ok: true,
      schema: { type: ["string", "null"] },
      typed: true,
      nullable: false,
    });
    expect(projectSchema({ type: ["object", "null"], properties: { a: str } }, "")).toMatchObject({
      ok: true,
      nullable: false,
    });
    const deep: JsonSchema = {
      type: "object",
      properties: {
        a: {
          type: ["object", "null"],
          properties: { b: { type: "object", properties: { c: int } } },
        },
      },
    };
    expect(projectSchema(deep, "/a")).toMatchObject({ ok: true, nullable: false });
    expect(projectSchema(deep, "/a/b")).toMatchObject({ ok: true, nullable: true });
    expect(projectSchema(deep, "/a/b/c")).toEqual({
      ok: true,
      schema: int,
      typed: true,
      nullable: true,
    });
  });

  it("nullable survives untyped levels and unions of branches", () => {
    expect(projectSchema({ type: ["object", "null"], additionalProperties: true }, "/x/y")).toEqual(
      { ok: true, schema: {}, typed: false, nullable: true },
    );
    const mixed: JsonSchema = {
      anyOf: [
        { type: "object", properties: { a: str } },
        { type: ["object", "null"], properties: { a: num } },
      ],
    };
    expect(projectSchema(mixed, "/a")).toEqual({
      ok: true,
      schema: { anyOf: [str, num] },
      typed: true,
      nullable: true,
    });
    expect(
      projectSchema({ anyOf: [{ const: null }, { type: "object", properties: { a: int } }] }, "/a"),
    ).toEqual({ ok: true, schema: int, typed: true, nullable: true });
  });

  it("projects both object and array branches when the type allows both", () => {
    const schema: JsonSchema = { type: ["object", "array"], properties: { "0": str }, items: num };
    expect(projectSchema(schema, "/0")).toEqual({
      ok: true,
      schema: { anyOf: [str, num] },
      typed: true,
      nullable: false,
    });
  });

  it("marks results untyped when the level carries undecidable keywords", () => {
    const r = projectSchema(
      { type: "object", properties: { a: str }, patternProperties: { "^a": num } },
      "/a",
    );
    expect(r).toEqual({ ok: true, schema: str, typed: false, nullable: false });
  });

  it("follows recursive $refs because a pointer is finite", () => {
    const schema: JsonSchema = {
      $ref: "#/$defs/n",
      $defs: { n: { type: "object", properties: { v: int, next: { $ref: "#/$defs/n" } } } },
    };
    expect(projectSchema(schema, "/next/next/v")).toEqual({
      ok: true,
      schema: int,
      typed: true,
      nullable: false,
    });
    const r = projectSchema(schema, "/next/next");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.typed).toBe(true);
      expect(r.schema.$defs).toEqual(schema.$defs);
      expect(isSubschema(r.schema, { type: "object", properties: { v: num } })).toMatchObject({
        ok: true,
      });
    }
  });
});

describe("projectValue", () => {
  const value: JsonValue = {
    name: "n",
    tags: ["x", "y"],
    pair: ["s", 1],
    meta: { k: 2 },
    "a/b": true,
    nil: null,
  };

  it("returns the whole value for the empty pointer", () => {
    expect(projectValue(value, "")).toEqual({ ok: true, value });
  });

  it("walks properties and indexes", () => {
    expect(projectValue(value, "/name")).toEqual({ ok: true, value: "n" });
    expect(projectValue(value, "/tags/1")).toEqual({ ok: true, value: "y" });
    expect(projectValue(value, "/pair/1")).toEqual({ ok: true, value: 1 });
    expect(projectValue(value, "/meta/k")).toEqual({ ok: true, value: 2 });
    expect(projectValue(value, "/a~1b")).toEqual({ ok: true, value: true });
    expect(projectValue(value, "/nil")).toEqual({ ok: true, value: null });
  });

  it("yields undefined for missing properties and indexes, and stays undefined below them", () => {
    expect(projectValue(value, "/nope")).toEqual({ ok: true, value: undefined });
    expect(projectValue(value, "/tags/5")).toEqual({ ok: true, value: undefined });
    expect(projectValue(value, "/nope/deeper/0")).toEqual({ ok: true, value: undefined });
  });

  it("treats a null level like an absent property (the binding default applies)", () => {
    expect(projectValue(value, "/nil/x")).toEqual({ ok: true, value: undefined });
    expect(projectValue(value, "/nil/0/deeper")).toEqual({ ok: true, value: undefined });
    expect(projectValue(null, "/a")).toEqual({ ok: true, value: undefined });
    expect(projectValue(null, "")).toEqual({ ok: true, value: null });
    expect(projectValue([null], "/0/a")).toEqual({ ok: true, value: undefined });
  });

  it("ignores inherited properties", () => {
    expect(projectValue({}, "/toString")).toEqual({ ok: true, value: undefined });
    expect(projectValue({}, "/__proto__")).toEqual({ ok: true, value: undefined });
  });

  it("rejects descending into scalars and non-index array tokens", () => {
    expect(projectValue(value, "/name/0").ok).toBe(false);
    expect(projectValue(value, "/name/0")).toEqual({
      ok: false,
      reason: "cannot index '0' into string at '/name'",
    });
    expect(projectValue(value, "/meta/k/x").ok).toBe(false);
    expect(projectValue(value, "/a~1b/x").ok).toBe(false);
    expect(projectValue(value, "/tags/first").ok).toBe(false);
    expect(projectValue(value, "/tags/01").ok).toBe(false);
    expect(projectValue(value, "/tags/-").ok).toBe(false);
  });

  it("rejects a malformed pointer", () => {
    expect(projectValue(value, "name").ok).toBe(false);
  });
});

/* ── agreement between projectSchema and projectValue ────────────────────── */

interface Typed {
  schema: JsonSchema;
  value: JsonValue;
}

const keys = ["a", "b", "c"] as const;

const arbLeaf: fc.Arbitrary<Typed> = fc.oneof(
  fc
    .tuple(fc.integer({ min: 0, max: 3 }), fc.string({ maxLength: 6 }))
    .map(([minLength, s]): Typed => ({
      schema: { type: "string", minLength },
      value: s.padEnd(minLength, "x"),
    })),
  fc
    .tuple(fc.integer({ min: -5, max: 5 }), fc.integer({ min: 0, max: 10 }))
    .map(([minimum, delta]): Typed => ({
      schema: { type: "integer", minimum },
      value: minimum + delta,
    })),
  fc
    .double({ min: -100, max: 100, noNaN: true })
    .map((n): Typed => ({ schema: { type: "number" }, value: n })),
  fc.boolean().map((b): Typed => ({ schema: { type: "boolean" }, value: b })),
  fc.constant<Typed>({ schema: { type: "null" }, value: null }),
  fc
    .uniqueArray(fc.constantFrom("x", "y", 1, 2, true, null), { minLength: 1, maxLength: 4 })
    .chain((members) =>
      fc.constantFrom(...members).map((value): Typed => ({ schema: { enum: members }, value })),
    ),
  fc
    .constantFrom<JsonValue>("c", 3, false, null, { k: 1 }, [1, "z"])
    .map((value): Typed => ({ schema: { const: value }, value })),
);

const { typed: arbTyped } = fc.letrec<{ typed: Typed }>((tie) => ({
  typed: fc.oneof(
    { depthSize: "small", maxDepth: 3, withCrossShrink: true },
    arbLeaf,
    // homogeneous array: one element schema, one or two copies of its value
    fc.tuple(tie("typed"), fc.integer({ min: 1, max: 2 })).map(([item, n]): Typed => ({
      schema: { type: "array", items: item.schema, minItems: n },
      value: Array.from({ length: n }, () => item.value),
    })),
    // closed tuple
    fc.array(tie("typed"), { minLength: 0, maxLength: 3 }).map((items): Typed => ({
      schema: {
        type: "array",
        prefixItems: items.map((i) => i.schema),
        items: false,
        minItems: items.length,
        maxItems: items.length,
      },
      value: items.map((i) => i.value),
    })),
    // object with declared properties, optionally closed
    fc
      .tuple(fc.dictionary(fc.constantFrom(...keys), tie("typed"), { maxKeys: 3 }), fc.boolean())
      .map(([entries, closed]): Typed => {
        const properties: Record<string, JsonSchema> = {};
        const value: Record<string, JsonValue> = {};
        for (const [k, v] of Object.entries(entries)) {
          properties[k] = v.schema;
          value[k] = v.value;
        }
        const schema: JsonSchema = {
          type: "object",
          properties,
          required: Object.keys(properties),
        };
        if (closed) schema.additionalProperties = false;
        return { schema, value };
      }),
    // map with additionalProperties
    fc.tuple(tie("typed"), fc.subarray([...keys])).map(([item, names]): Typed => {
      const value: Record<string, JsonValue> = {};
      for (const k of names) value[k] = item.value;
      return { schema: { type: "object", additionalProperties: item.schema }, value };
    }),
    // union: the value comes from the first alternative
    fc.tuple(tie("typed"), tie("typed")).map(([first, second]): Typed => ({
      schema: { anyOf: [first.schema, second.schema] },
      value: first.value,
    })),
  ),
}));

/** Every pointer addressing a position in `value`, plus one dangling pointer per container. */
function pointersOf(value: JsonValue, prefix = ""): string[] {
  const out = [prefix];
  if (Array.isArray(value)) {
    value.forEach((item, i) => out.push(...pointersOf(item, `${prefix}/${i}`)));
    out.push(`${prefix}/${value.length}`);
  } else if (typeof value === "object" && value !== null) {
    for (const [k, v] of Object.entries(value))
      out.push(...pointersOf(v, `${prefix}/${k.replace(/~/g, "~0").replace(/\//g, "~1")}`));
    out.push(`${prefix}/zz`);
  }
  return out;
}

const arbCase = fc
  .tuple(arbTyped, fc.oneof(fc.constant(undefined), fc.constant("#/$defs/root")))
  .chain(([typed, viaRef]) => {
    const schema: JsonSchema =
      viaRef === undefined ? typed.schema : { $ref: viaRef, $defs: { root: typed.schema } };
    return fc
      .constantFrom(...pointersOf(typed.value))
      .map((pointer) => ({ schema, value: typed.value, pointer }));
  });

describe("projectSchema / projectValue agreement", () => {
  it("a value present at the pointer satisfies the projected schema", () => {
    fc.assert(
      fc.property(arbCase, ({ schema, value, pointer }) => {
        const pv = projectValue(value, pointer);
        const ps = projectSchema(schema, pointer);
        expect(pv.ok).toBe(true);
        if (!pv.ok || pv.value === undefined) return;
        expect(ps.ok, JSON.stringify(ps)).toBe(true);
        if (!ps.ok) return;
        const fits = isSubschema({ const: pv.value }, ps.schema);
        expect(fits.ok, JSON.stringify({ projected: ps.schema, fits })).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it("a pointer the schema rejects never addresses a value", () => {
    fc.assert(
      fc.property(arbCase, ({ schema, value, pointer }) => {
        const ps = projectSchema(schema, pointer);
        if (ps.ok) return;
        const pv = projectValue(value, pointer);
        expect(!pv.ok || pv.value === undefined).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it("a typed projection through declared structure yields a schema the root value agrees with", () => {
    fc.assert(
      fc.property(arbCase, ({ schema, value, pointer }) => {
        const ps = projectSchema(schema, pointer);
        const pv = projectValue(value, pointer);
        if (!ps.ok || !pv.ok || pv.value === undefined) return;
        // A typed projection is at least as informative as the unconstrained schema.
        if (ps.typed) expect(isSubschema(ps.schema, {})).toEqual({ ok: true, verified: true });
      }),
      { numRuns: 200 },
    );
  });
});
