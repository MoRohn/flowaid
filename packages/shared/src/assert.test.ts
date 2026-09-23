import { describe, expect, it } from "vitest";

import { InvariantError, assertDefined, assertNever, invariant } from "./assert.js";

type Shape = { kind: "circle"; r: number } | { kind: "square"; s: number };

function area(shape: Shape): number {
  switch (shape.kind) {
    case "circle":
      return Math.PI * shape.r ** 2;
    case "square":
      return shape.s ** 2;
    default:
      return assertNever(shape);
  }
}

describe("assertNever", () => {
  it("is unreachable for handled unions", () => {
    expect(area({ kind: "square", s: 2 })).toBe(4);
  });

  it("throws InvariantError describing the value that bypassed the type system", () => {
    const bogus: unknown = { kind: "hexagon" };
    expect(() => area(bogus as Shape)).toThrow(InvariantError);
    expect(() => area(bogus as Shape)).toThrow('{"kind":"hexagon"}');
  });

  it("uses a custom message when provided", () => {
    const value: unknown = "x";
    expect(() => assertNever(value as never, "custom")).toThrow("custom");
  });
});

describe("invariant", () => {
  it("passes on truthy conditions and narrows", () => {
    const value: string | null = "v";
    invariant(value !== null);
    expect(value.toUpperCase()).toBe("V");
  });

  it("throws with eager or lazy messages", () => {
    expect(() => invariant(false)).toThrow("Invariant violated");
    expect(() => invariant(0, "zero")).toThrow("zero");
    expect(() => invariant(null, () => "lazy")).toThrow("lazy");
  });
});

describe("assertDefined", () => {
  it("returns defined values and rejects null/undefined", () => {
    expect(assertDefined(0)).toBe(0);
    expect(assertDefined("")).toBe("");
    expect(() => assertDefined(undefined)).toThrow(InvariantError);
    expect(() => assertDefined(null, "missing")).toThrow("missing");
  });
});
