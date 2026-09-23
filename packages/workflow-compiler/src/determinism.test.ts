/**
 * Determinism (P1-01 gate): compiling is a pure function of the canonical definition. The same
 * input always yields the same plan and diagnostics, and reordering object keys — which jsonb
 * storage does — never changes the planHash.
 */
import fc from "fast-check";
import { definitionHash } from "@flowaid/workflow-core";
import { describe, expect, it } from "vitest";
import { compile } from "./index.js";
import { DEMOS, instantiate, resolveTool } from "./test/demos.js";
import { fixtureCatalog, readJson } from "./test/support.js";

/** A deep copy whose object keys are permuted by `rand` (arrays keep their order). */
function shuffleKeys(value: unknown, rand: () => number): unknown {
  if (Array.isArray(value)) return value.map((v) => shuffleKeys(v, rand));
  if (typeof value !== "object" || value === null) return value;
  const keys = Object.keys(value);
  for (let i = keys.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [keys[i], keys[j]] = [keys[j] as string, keys[i] as string];
  }
  const out: Record<string, unknown> = {};
  for (const key of keys) out[key] = shuffleKeys((value as Record<string, unknown>)[key], rand);
  return out;
}

const DOCUMENTS = [
  { name: "example-support-reply", doc: readJson("example-support-reply.json") },
  ...DEMOS.map((name) => ({ name, doc: instantiate(readJson(`${name}.json`)) })),
];

function planHashOf(doc: unknown): string {
  const result = compile(doc, { catalog: fixtureCatalog(), resolveTool });
  if (!result.ok)
    throw new Error(JSON.stringify(result.diagnostics.filter((d) => d.severity === "error")));
  return result.plan.planHash;
}

describe.each(DOCUMENTS)("$name", ({ doc }) => {
  const reference = compile(doc, { catalog: fixtureCatalog(), resolveTool });

  it("compiles to the same plan and diagnostics every time", () => {
    const again = compile(JSON.parse(JSON.stringify(doc)), {
      catalog: fixtureCatalog(),
      resolveTool,
    });
    expect(again).toEqual(reference);
  });

  it("is independent of object key order (equal definitionHash ⇒ equal planHash)", () => {
    const expected = planHashOf(doc);
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 2 ** 31 - 1 }), (seed) => {
        let state = seed;
        const rand = () => {
          state = (state * 48271) % 2147483647;
          return state / 2147483647;
        };
        const shuffled = shuffleKeys(doc, rand);
        expect(definitionHash(shuffled)).toBe(definitionHash(doc));
        expect(planHashOf(shuffled)).toBe(expected);
        const diagnostics = compile(shuffled, {
          catalog: fixtureCatalog(),
          resolveTool,
        }).diagnostics;
        expect(diagnostics.map((d) => d.code)).toEqual(reference.diagnostics.map((d) => d.code));
      }),
      { numRuns: 25 },
    );
  });

  it("changes the planHash when the compiler version changes", () => {
    const other = compile(doc, {
      catalog: fixtureCatalog(),
      resolveTool,
      compilerVersion: "9.9.9",
    });
    if (!reference.ok || !other.ok) throw new Error("must compile");
    expect(other.plan.planHash).not.toBe(reference.plan.planHash);
  });
});
