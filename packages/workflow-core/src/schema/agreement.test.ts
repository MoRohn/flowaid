/**
 * The three JSON-pointer walkers agree (workflow-core review §11): for every
 * (schema, value, pointer) triple in the table, `projectSchema` (compile time),
 * `projectValue` (the worker) and `createEvalScope` (tests, playground, SDK
 * harness) reach the same verdict — a value, an absence the binding `default`
 * fills, or a rejection with the projector's reason. A pointer through a
 * nullable level is admitted by the schema walker, reported as `nullable`, and
 * resolves to an absence (not an error) at runtime.
 */
import { describe, expect, it } from "vitest";
import type { Ref } from "../bindings.js";
import { ExpressionError } from "../errors.js";
import { expressionErrorReason } from "../expr/evaluator.js";
import { createEvalScope } from "../expr/scope.js";
import type { JsonSchema, JsonValue } from "../json.js";
import { projectSchema, projectValue } from "./project.js";

const str: JsonSchema = { type: "string" };
const int: JsonSchema = { type: "integer" };
const nullableUser: JsonSchema = {
  type: ["object", "null"],
  properties: { name: str, tags: { type: "array", items: str } },
};
const closedUser: JsonSchema = {
  type: "object",
  properties: { name: str },
  required: ["name"],
  additionalProperties: false,
};
const openUser: JsonSchema = { type: "object", properties: { name: str } };
const tuple: JsonSchema = { type: "array", prefixItems: [str, int], items: false };
const nested: JsonSchema = {
  type: "object",
  properties: {
    a: { type: ["object", "null"], properties: { b: { type: "object", properties: { c: int } } } },
  },
};
const viaAnyOf: JsonSchema = {
  anyOf: [{ type: "null" }, { type: "object", properties: { name: str } }],
};
const nullableLeaf: JsonSchema = {
  type: "object",
  properties: { nil: { type: ["integer", "null"] } },
};

/** What every walker must agree on for one triple. */
type Expected =
  /** The pointer addresses a value; the schema walker projects `schema`. */
  | { kind: "value"; value: JsonValue; schema: JsonSchema; typed: boolean; nullable: boolean }
  /** Nothing is there (missing member, index past the end or a `null` level): the default applies, the scope yields `null`. */
  | { kind: "absent"; schema: JsonSchema | "rejected"; typed?: boolean; nullable?: boolean }
  /** Structure violation (into a scalar, non-index token on an array): both walkers refuse, the scope throws TYPE. */
  | { kind: "rejected"; reason: string };

interface Row {
  name: string;
  schema: JsonSchema;
  value: JsonValue;
  pointer: string;
  expected: Expected;
}

const rows: Row[] = [
  {
    name: "empty pointer returns the root",
    schema: closedUser,
    value: { name: "n" },
    pointer: "",
    expected: {
      kind: "value",
      value: { name: "n" },
      schema: closedUser,
      typed: true,
      nullable: false,
    },
  },
  {
    name: "empty pointer on a null root",
    schema: nullableUser,
    value: null,
    pointer: "",
    expected: { kind: "value", value: null, schema: nullableUser, typed: true, nullable: false },
  },
  {
    name: "declared property",
    schema: closedUser,
    value: { name: "n" },
    pointer: "/name",
    expected: { kind: "value", value: "n", schema: str, typed: true, nullable: false },
  },
  {
    name: "nullable object, present",
    schema: nullableUser,
    value: { name: "n", tags: [] },
    pointer: "/name",
    expected: { kind: "value", value: "n", schema: str, typed: true, nullable: true },
  },
  {
    name: "nullable object, null",
    schema: nullableUser,
    value: null,
    pointer: "/name",
    expected: { kind: "absent", schema: str, typed: true, nullable: true },
  },
  {
    name: "nullable object, null, deeper",
    schema: nullableUser,
    value: null,
    pointer: "/tags/0",
    expected: { kind: "absent", schema: str, typed: true, nullable: true },
  },
  {
    name: "nullable object via anyOf, present",
    schema: viaAnyOf,
    value: { name: "n" },
    pointer: "/name",
    expected: { kind: "value", value: "n", schema: str, typed: true, nullable: true },
  },
  {
    name: "nullable object via anyOf, null",
    schema: viaAnyOf,
    value: null,
    pointer: "/name",
    expected: { kind: "absent", schema: str, typed: true, nullable: true },
  },
  {
    name: "nested nullable level, present",
    schema: nested,
    value: { a: { b: { c: 1 } } },
    pointer: "/a/b/c",
    expected: { kind: "value", value: 1, schema: int, typed: true, nullable: true },
  },
  {
    name: "nested nullable level, null",
    schema: nested,
    value: { a: null },
    pointer: "/a/b/c",
    expected: { kind: "absent", schema: int, typed: true, nullable: true },
  },
  {
    name: "nested nullable level itself",
    schema: nested,
    value: { a: null },
    pointer: "/a",
    expected: {
      kind: "value",
      value: null,
      schema: {
        type: ["object", "null"],
        properties: { b: { type: "object", properties: { c: int } } },
      },
      typed: true,
      nullable: false,
    },
  },
  {
    name: "nullable leaf is a value, not an absence",
    schema: nullableLeaf,
    value: { nil: null },
    pointer: "/nil",
    expected: {
      kind: "value",
      value: null,
      schema: { type: ["integer", "null"] },
      typed: true,
      nullable: false,
    },
  },
  {
    name: "scalar root",
    schema: str,
    value: "text",
    pointer: "/0",
    expected: { kind: "rejected", reason: "cannot index '0' into string at '/'" },
  },
  {
    name: "into a string property",
    schema: closedUser,
    value: { name: "n" },
    pointer: "/name/0",
    expected: { kind: "rejected", reason: "cannot index '0' into string at '/name'" },
  },
  {
    name: "into an integer",
    schema: tuple,
    value: ["s", 1],
    pointer: "/1/x",
    expected: { kind: "rejected", reason: "cannot index 'x' into number at '/1'" },
  },
  {
    name: "into a boolean",
    schema: { type: "object", properties: { ok: { type: "boolean" } } },
    value: { ok: true },
    pointer: "/ok/x",
    expected: { kind: "rejected", reason: "cannot index 'x' into boolean at '/ok'" },
  },
  {
    name: "non-index token on an array",
    schema: tuple,
    value: ["s", 1],
    pointer: "/first",
    expected: { kind: "rejected", reason: "'first' is not an array index at '/'" },
  },
  {
    name: "non-canonical index on an array",
    schema: tuple,
    value: ["s", 1],
    pointer: "/01",
    expected: { kind: "rejected", reason: "'01' is not an array index at '/'" },
  },
  {
    name: "tuple in range",
    schema: tuple,
    value: ["s", 1],
    pointer: "/1",
    expected: { kind: "value", value: 1, schema: int, typed: true, nullable: false },
  },
  {
    name: "tuple past the end",
    schema: tuple,
    value: ["s", 1],
    pointer: "/2",
    expected: { kind: "absent", schema: "rejected" },
  },
  {
    name: "tuple past the end, deeper",
    schema: tuple,
    value: ["s", 1],
    pointer: "/2/x",
    expected: { kind: "absent", schema: "rejected" },
  },
  {
    name: "closed object, undeclared property",
    schema: closedUser,
    value: { name: "n" },
    pointer: "/nope",
    expected: { kind: "absent", schema: "rejected" },
  },
  {
    name: "closed object, undeclared property, deeper",
    schema: closedUser,
    value: { name: "n" },
    pointer: "/nope/deeper/0",
    expected: { kind: "absent", schema: "rejected" },
  },
  {
    name: "open object, undeclared property missing",
    schema: openUser,
    value: { name: "n" },
    pointer: "/extra",
    expected: { kind: "absent", schema: {}, typed: false, nullable: false },
  },
  {
    name: "open object, undeclared property present",
    schema: openUser,
    value: { name: "n", extra: [1] },
    pointer: "/extra/0",
    expected: { kind: "value", value: 1, schema: {}, typed: false, nullable: false },
  },
  {
    name: "open object, null level below an untyped step",
    schema: openUser,
    value: { name: "n", extra: null },
    pointer: "/extra/0",
    expected: { kind: "absent", schema: {}, typed: false, nullable: false },
  },
  {
    name: "array index past the end",
    schema: nullableUser,
    value: { name: "n", tags: ["x"] },
    pointer: "/tags/3",
    expected: { kind: "absent", schema: str, typed: true, nullable: true },
  },
  {
    name: "escaped tokens",
    schema: { type: "object", properties: { "a/b": { type: "object", properties: { "~": int } } } },
    value: { "a/b": { "~": 7 } },
    pointer: "/a~1b/~0",
    expected: { kind: "value", value: 7, schema: int, typed: true, nullable: false },
  },
];

function resolveViaScope(
  value: JsonValue,
  pointer: string,
): { kind: "value"; value: JsonValue | undefined } | { kind: "error"; error: ExpressionError } {
  const scope = createEvalScope({ ports: { n: { p: value } } });
  const ref: Ref =
    pointer === ""
      ? { kind: "port", node: "n", port: "p" }
      : { kind: "port", node: "n", port: "p", path: pointer };
  try {
    return { kind: "value", value: scope.resolve(ref) };
  } catch (error) {
    if (error instanceof ExpressionError) return { kind: "error", error };
    throw error;
  }
}

describe("projectSchema / projectValue / createEvalScope agreement", () => {
  it.each(rows)("$name ($pointer)", ({ schema, value, pointer, expected }) => {
    const ps = projectSchema(schema, pointer);
    const pv = projectValue(value, pointer);
    const scoped = resolveViaScope(value, pointer);

    switch (expected.kind) {
      case "value": {
        expect(ps).toEqual({
          ok: true,
          schema: expected.schema,
          typed: expected.typed,
          nullable: expected.nullable,
        });
        expect(pv).toEqual({ ok: true, value: expected.value });
        expect(scoped).toEqual({ kind: "value", value: expected.value });
        break;
      }
      case "absent": {
        if (expected.schema === "rejected") {
          expect(ps.ok).toBe(false);
        } else {
          expect(ps).toEqual({
            ok: true,
            schema: expected.schema,
            typed: expected.typed,
            nullable: expected.nullable,
          });
        }
        expect(pv).toEqual({ ok: true, value: undefined });
        expect(scoped).toEqual({ kind: "value", value: null });
        break;
      }
      case "rejected": {
        expect(ps.ok).toBe(false);
        expect(pv).toEqual({ ok: false, reason: expected.reason });
        expect(scoped.kind).toBe("error");
        if (scoped.kind !== "error") return;
        expect(expressionErrorReason(scoped.error)).toBe("TYPE");
        expect(scoped.error.message).toContain(expected.reason);
        expect(scoped.error.message).toContain(`'${pointer}'`);
        break;
      }
    }
  });

  it("a nullable level is the only way a typed, admitted pointer can be absent at runtime", () => {
    for (const row of rows) {
      const ps = projectSchema(row.schema, row.pointer);
      const pv = projectValue(row.value, row.pointer);
      if (!ps.ok || !ps.typed || !pv.ok || pv.value !== undefined) continue;
      // Missing array index (`/tags/3`) is the other admitted absence; everything else needs a nullable level.
      const lastToken = row.pointer.slice(row.pointer.lastIndexOf("/") + 1);
      expect(ps.nullable || /^(0|[1-9][0-9]*)$/.test(lastToken), row.name).toBe(true);
    }
  });

  it("the scope reports the projector reason verbatim for every rejected pointer", () => {
    for (const row of rows) {
      const pv = projectValue(row.value, row.pointer);
      if (pv.ok) continue;
      const scoped = resolveViaScope(row.value, row.pointer);
      expect(scoped.kind, row.name).toBe("error");
      if (scoped.kind === "error")
        expect(scoped.error.message).toBe(
          `cannot resolve reference path '${row.pointer}': ${pv.reason}`,
        );
    }
  });
});
