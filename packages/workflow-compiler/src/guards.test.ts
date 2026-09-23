import fc from "fast-check";
import type { Guard } from "@flowaid/workflow-core";
import { describe, expect, it } from "vitest";
import {
  ALWAYS,
  MAX_CLAUSES,
  NEVER,
  and,
  andAll,
  contradicts,
  exclusive,
  implies,
  or,
  simplify,
  type Exclusivity,
} from "./guards.js";

/** `b` is a first-mode branch (yes/no/maybe); `h` a human task (approved/rejected); `a` an all-mode branch. */
const families: Record<string, string[][]> = {
  b: [["yes", "no", "maybe"]],
  h: [["approved", "rejected"]],
  a: [],
};
const ex: Exclusivity = (node) => families[node] ?? [];
const lit = (node: string, port: string) => ({ node, port });

describe("literals", () => {
  it("contradict only within one exclusive family", () => {
    expect(contradicts(lit("b", "yes"), lit("b", "no"), ex)).toBe(true);
    expect(contradicts(lit("b", "yes"), lit("b", "yes"), ex)).toBe(false);
    expect(contradicts(lit("a", "x"), lit("a", "y"), ex)).toBe(false);
    expect(contradicts(lit("b", "yes"), lit("h", "approved"), ex)).toBe(false);
  });
});

describe("and / or", () => {
  it("ALWAYS is the unit of and, NEVER the unit of or", () => {
    const g: Guard = [[lit("b", "yes")]];
    expect(and(ALWAYS, g, ex)).toEqual(g);
    expect(or(NEVER, g, ex)).toEqual(g);
  });

  it("drops contradictory clauses", () => {
    expect(and([[lit("b", "yes")]], [[lit("b", "no")]], ex)).toEqual(NEVER);
  });

  it("keeps literal order: left operand first (AND after a branch labels the path)", () => {
    expect(and([[lit("b", "yes")]], [[lit("h", "approved")]], ex)).toEqual([
      [lit("b", "yes"), lit("h", "approved")],
    ]);
  });

  it("removes subsumed clauses", () => {
    expect(or([[lit("b", "yes")]], [[lit("b", "yes"), lit("h", "approved")]], ex)).toEqual([
      [lit("b", "yes")],
    ]);
  });

  it("merges a disjunction that covers a whole family back into its rest", () => {
    const covered = simplify(
      [
        [lit("h", "approved"), lit("b", "yes")],
        [lit("h", "approved"), lit("b", "no")],
        [lit("h", "approved"), lit("b", "maybe")],
      ],
      ex,
    );
    expect(covered).toEqual([[lit("h", "approved")]]);
    // A partial cover stays as it is.
    expect(simplify([[lit("b", "yes")], [lit("b", "no")]], ex)).toEqual([
      [lit("b", "yes")],
      [lit("b", "no")],
    ]);
  });

  it(`widens to ALWAYS beyond ${MAX_CLAUSES} clauses`, () => {
    const many: Guard = Array.from({ length: MAX_CLAUSES + 1 }, (_, i) => [lit(`n${i}`, "x")]);
    expect(simplify(many, ex)).toEqual(ALWAYS);
  });
});

describe("exclusive / implies", () => {
  it("guards on different outcomes of one node are exclusive", () => {
    expect(exclusive([[lit("b", "yes")]], [[lit("b", "no")], [lit("b", "maybe")]], ex)).toBe(true);
    expect(exclusive([[lit("b", "yes")]], ALWAYS, ex)).toBe(false);
    expect(exclusive([[lit("a", "x")]], [[lit("a", "y")]], ex)).toBe(false);
  });

  it("a narrower guard implies a wider one", () => {
    expect(implies([[lit("b", "yes"), lit("h", "approved")]], [[lit("b", "yes")]])).toBe(true);
    expect(implies([[lit("b", "yes")]], [[lit("b", "yes"), lit("h", "approved")]])).toBe(false);
    expect(implies([[lit("b", "yes")]], ALWAYS)).toBe(true);
  });

  it("and is commutative up to literal order, and idempotent", () => {
    const arbGuard = fc.array(
      fc.array(
        fc.record({
          node: fc.constantFrom("b", "h", "a"),
          port: fc.constantFrom("yes", "no", "approved", "rejected", "x"),
        }),
        {
          maxLength: 3,
        },
      ),
      { maxLength: 4 },
    );
    const norm = (g: Guard) =>
      g
        .map((c) =>
          c
            .map((l) => `${l.node}.${l.port}`)
            .sort()
            .join("&"),
        )
        .sort();
    fc.assert(
      fc.property(arbGuard, arbGuard, (x, y) => {
        expect(norm(and(x, y, ex))).toEqual(norm(and(y, x, ex)));
        const sx = simplify(x, ex);
        expect(norm(and(sx, sx, ex))).toEqual(norm(sx));
        expect(norm(andAll([sx], ex))).toEqual(norm(sx));
      }),
    );
  });
});
