import { describe, expect, it } from "vitest";
import { JsonPatchError, applyJsonPatch, getPointer } from "./patch.js";

describe("applyJsonPatch (RFC 6902)", () => {
  const doc = { a: { b: [1, 2, 3] }, "x/y": { "~t": 1 } };

  it("adds, removes, replaces, moves, copies and tests without touching the input", () => {
    const out = applyJsonPatch(doc, [
      { op: "add", path: "/a/b/1", value: 9 },
      { op: "add", path: "/a/b/-", value: 4 },
      { op: "remove", path: "/a/b/0" },
      { op: "replace", path: "/x~1y/~0t", value: 2 },
      { op: "copy", from: "/a/b", path: "/c" },
      { op: "move", from: "/c", path: "/d" },
      { op: "test", path: "/d/0", value: 9 },
    ]);
    expect(out).toEqual({ a: { b: [9, 2, 3, 4] }, "x/y": { "~t": 2 }, d: [9, 2, 3, 4] });
    expect(doc).toEqual({ a: { b: [1, 2, 3] }, "x/y": { "~t": 1 } });
    expect(getPointer(out, "/a/b/3")).toBe(4);
    expect(getPointer(out, "/missing/x")).toBeUndefined();
  });

  it("replaces the whole document at the root pointer", () => {
    expect(applyJsonPatch<number[]>([1], [{ op: "replace", path: "", value: [2] }])).toEqual([2]);
  });

  it("fails as a whole on a missing path, a bad index or a failing test", () => {
    expect(() => applyJsonPatch(doc, [{ op: "remove", path: "/nope" }])).toThrow(JsonPatchError);
    expect(() => applyJsonPatch(doc, [{ op: "add", path: "/a/b/7", value: 0 }])).toThrow(
      /out of range/,
    );
    expect(() => applyJsonPatch(doc, [{ op: "test", path: "/a/b/0", value: 2 }])).toThrow(
      /test failed/,
    );
    expect(() => applyJsonPatch(doc, [{ op: "move", from: "/a", path: "/a/z" }])).toThrow(
      /into itself/,
    );
  });
});
