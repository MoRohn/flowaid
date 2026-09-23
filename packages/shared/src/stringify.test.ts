import { describe, expect, it } from "vitest";

import { StableStringifyError, stableStringify } from "./stringify.js";

describe("stableStringify", () => {
  it("is independent of key insertion order at every depth", () => {
    const a = { z: 1, a: { d: [{ y: 1, x: 2 }], c: null }, m: "s" };
    const b = { m: "s", a: { c: null, d: [{ x: 2, y: 1 }] }, z: 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
    expect(stableStringify(a)).toBe('{"a":{"c":null,"d":[{"x":2,"y":1}]},"m":"s","z":1}');
  });

  it("keeps array order (arrays are ordered by definition)", () => {
    expect(stableStringify([3, 1, 2])).toBe("[3,1,2]");
    expect(stableStringify([3, 1, 2])).not.toBe(stableStringify([1, 2, 3]));
  });

  it("matches JSON.parse round-trips of JSON.stringify output", () => {
    const value = { nested: { list: [1, "two", false, null, { deep: [[]] }] }, s: 'é\n"quote"' };
    const parsed: unknown = JSON.parse(stableStringify(value));
    expect(parsed).toEqual(value);
  });

  it("sorts keys by UTF-16 code unit order and escapes strings like JSON.stringify", () => {
    expect(stableStringify({ b: 1, B: 2, a: 3, "10": 4, "9": 5 })).toBe(
      '{"10":4,"9":5,"B":2,"a":3,"b":1}',
    );
    expect(stableStringify("a b\u0000")).toBe(JSON.stringify("a b\u0000"));
  });

  it("normalises numbers like JSON.stringify", () => {
    expect(stableStringify(-0)).toBe("0");
    expect(stableStringify(1e21)).toBe("1e+21");
    expect(stableStringify(0.1 + 0.2)).toBe("0.30000000000000004");
  });

  it("rejects undefined, functions, symbols and bigints with a path", () => {
    expect(() => stableStringify(undefined)).toThrow(StableStringifyError);
    expect(() => stableStringify({ a: { b: undefined } })).toThrow("/a/b");
    expect(() => stableStringify([1, () => 1])).toThrow("/1");
    expect(() => stableStringify({ s: Symbol("x") })).toThrow(StableStringifyError);
    expect(() => stableStringify({ n: 1n })).toThrow(StableStringifyError);
  });

  it("rejects NaN/Infinity, holes, cycles and non-plain objects", () => {
    expect(() => stableStringify(Number.NaN)).toThrow("non-finite");
    expect(() => stableStringify({ x: Number.POSITIVE_INFINITY })).toThrow("/x");
    expect(() => stableStringify([1, , 2])).toThrow("sparse");
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() => stableStringify(cyclic)).toThrow("circular");
    expect(() => stableStringify(new Date(0))).toThrow("non-plain");
    expect(() => stableStringify(new Map())).toThrow("non-plain");
  });

  it("escapes JSON-pointer segments in error paths", () => {
    expect(() => stableStringify({ "a/b": { "c~d": undefined } })).toThrow("/a~1b/c~0d");
  });

  it("allows the same object to appear twice when it is not an ancestor of itself", () => {
    const shared = { k: 1 };
    expect(stableStringify({ a: shared, b: shared })).toBe('{"a":{"k":1},"b":{"k":1}}');
  });
});
