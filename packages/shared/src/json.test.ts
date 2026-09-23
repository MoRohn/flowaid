import { describe, expect, it } from "vitest";

import {
  canonicalize,
  cloneJson,
  deepEqual,
  isJsonObject,
  isJsonValue,
  isPlainObject,
} from "./json.js";

describe("isPlainObject", () => {
  it("accepts object literals and null-prototype objects", () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
    expect(isPlainObject(Object.create(null))).toBe(true);
    expect(isPlainObject(JSON.parse('{"x":1}'))).toBe(true);
  });

  it("rejects arrays, null, class instances and built-ins", () => {
    class Foo {}
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject(new Foo())).toBe(false);
    expect(isPlainObject(new Date())).toBe(false);
    expect(isPlainObject(new Map())).toBe(false);
    expect(isPlainObject("str")).toBe(false);
    expect(isPlainObject(() => undefined)).toBe(false);
  });
});

describe("isJsonValue / isJsonObject", () => {
  it("accepts every JSON primitive and nested structure", () => {
    expect(isJsonValue(null)).toBe(true);
    expect(isJsonValue(true)).toBe(true);
    expect(isJsonValue("s")).toBe(true);
    expect(isJsonValue(0)).toBe(true);
    expect(isJsonValue(-1.5)).toBe(true);
    expect(isJsonValue([])).toBe(true);
    expect(isJsonValue({})).toBe(true);
    expect(isJsonValue({ a: [1, { b: null }], c: "x" })).toBe(true);
  });

  it("rejects values JSON cannot represent", () => {
    expect(isJsonValue(undefined)).toBe(false);
    expect(isJsonValue(Number.NaN)).toBe(false);
    expect(isJsonValue(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isJsonValue(10n)).toBe(false);
    expect(isJsonValue(Symbol("s"))).toBe(false);
    expect(isJsonValue(() => 1)).toBe(false);
    expect(isJsonValue(new Date())).toBe(false);
    expect(isJsonValue({ a: undefined })).toBe(false);
    expect(isJsonValue([1, undefined])).toBe(false);
    expect(isJsonValue({ a: { b: new Map() } })).toBe(false);
    expect(isJsonValue([1, , 3])).toBe(false);
  });

  it("isJsonObject requires a plain object", () => {
    expect(isJsonObject({ a: 1 })).toBe(true);
    expect(isJsonObject([1])).toBe(false);
    expect(isJsonObject(null)).toBe(false);
    expect(isJsonObject({ a: () => 1 })).toBe(false);
  });
});

describe("deepEqual", () => {
  it("compares primitives with ===", () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual("a", "a")).toBe(true);
    expect(deepEqual(null, null)).toBe(true);
    expect(deepEqual(1, "1")).toBe(false);
    expect(deepEqual(0, -0)).toBe(true);
    expect(deepEqual(Number.NaN, Number.NaN)).toBe(false);
    expect(deepEqual(null, undefined)).toBe(false);
    expect(deepEqual(null, {})).toBe(false);
  });

  it("ignores key order but not key sets", () => {
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(deepEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false);
    expect(deepEqual({ a: 1 }, { b: 1 })).toBe(false);
  });

  it("compares arrays positionally", () => {
    expect(deepEqual([1, [2, 3]], [1, [2, 3]])).toBe(true);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(deepEqual([], {})).toBe(false);
    expect(deepEqual({}, [])).toBe(false);
  });

  it("handles deep nesting and mixed structures", () => {
    const a = { x: [{ y: { z: [1, "2", null, true] } }], w: {} };
    const b = { w: {}, x: [{ y: { z: [1, "2", null, true] } }] };
    expect(deepEqual(a, b)).toBe(true);
    expect(deepEqual(a, { ...b, x: [{ y: { z: [1, "2", null, false] } }] })).toBe(false);
  });

  it("treats non-plain objects as equal only by reference", () => {
    const d = new Date(0);
    expect(deepEqual(d, d)).toBe(true);
    expect(deepEqual(new Date(0), new Date(0))).toBe(false);
    expect(deepEqual(new Map(), new Map())).toBe(false);
  });
});

describe("canonicalize", () => {
  it("sorts keys at every depth and keeps array order", () => {
    const out = canonicalize({ b: { d: 1, c: [{ z: 1, y: 2 }] }, a: [3, 1, 2] });
    expect(JSON.stringify(out)).toBe('{"a":[3,1,2],"b":{"c":[{"y":2,"z":1}],"d":1}}');
  });

  it("does not mutate its input and returns a fresh structure", () => {
    const input = { b: 1, a: { d: 2, c: 3 } };
    const before = JSON.stringify(input);
    const out = canonicalize(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(out).not.toBe(input);
    expect(out.a).not.toBe(input.a);
    expect(deepEqual(out, input)).toBe(true);
  });

  it("passes primitives through", () => {
    expect(canonicalize(1)).toBe(1);
    expect(canonicalize("s")).toBe("s");
    expect(canonicalize(null)).toBe(null);
  });
});

describe("cloneJson", () => {
  it("deep-clones without sharing references", () => {
    const input = { a: [{ b: 1 }], c: { d: "x" } };
    const out = cloneJson(input);
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
    expect(out.a).not.toBe(input.a);
    expect(out.a[0]).not.toBe(input.a[0]);
    expect(out.c).not.toBe(input.c);
  });
});
