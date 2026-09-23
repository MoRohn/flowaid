import { describe, expect, it } from "vitest";
import {
  chunkDiff,
  diffSequences,
  diffStats,
  diffTextLines,
  diffTokens,
  splitLines,
  toSplitRows,
} from "./textDiff";

describe("diffSequences", () => {
  it("returns only equal ops for identical inputs", () => {
    const ops = diffSequences(["a", "b", "c"], ["a", "b", "c"]);
    expect(ops.map((o) => o.type)).toEqual(["equal", "equal", "equal"]);
    expect(ops.map((o) => [o.aIndex, o.bIndex])).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
    ]);
  });

  it("detects a pure insertion", () => {
    const ops = diffSequences(["a", "c"], ["a", "b", "c"]);
    expect(ops.map((o) => `${o.type}:${o.value}`)).toEqual(["equal:a", "add:b", "equal:c"]);
    expect(ops[1]?.bIndex).toBe(1);
    expect(ops[1]?.aIndex).toBeUndefined();
  });

  it("detects a pure deletion", () => {
    const ops = diffSequences(["a", "b", "c"], ["a", "c"]);
    expect(ops.map((o) => `${o.type}:${o.value}`)).toEqual(["equal:a", "remove:b", "equal:c"]);
  });

  it("emits remove then add for a changed element", () => {
    const ops = diffSequences(["x", "old", "y"], ["x", "new", "y"]);
    expect(ops.map((o) => `${o.type}:${o.value}`)).toEqual([
      "equal:x",
      "remove:old",
      "add:new",
      "equal:y",
    ]);
  });

  it("handles empty sides", () => {
    expect(diffSequences([], ["a"]).map((o) => o.type)).toEqual(["add"]);
    expect(diffSequences(["a"], []).map((o) => o.type)).toEqual(["remove"]);
    expect(diffSequences([], [])).toEqual([]);
  });

  it("finds the longest common subsequence in the middle", () => {
    const ops = diffSequences("abcabba".split(""), "cbabac".split(""));
    const equal = ops.filter((o) => o.type === "equal").map((o) => o.value);
    // LCS of abcabba / cbabac has length 4
    expect(equal.length).toBe(4);
    const rebuiltA = ops
      .filter((o) => o.type !== "add")
      .map((o) => o.value)
      .join("");
    const rebuiltB = ops
      .filter((o) => o.type !== "remove")
      .map((o) => o.value)
      .join("");
    expect(rebuiltA).toBe("abcabba");
    expect(rebuiltB).toBe("cbabac");
  });
});

describe("diffTextLines", () => {
  it("numbers lines on both sides", () => {
    const ops = diffTextLines("a\nb\nc", "a\nB\nc\nd");
    expect(ops).toEqual([
      { type: "equal", text: "a", oldLine: 1, newLine: 1 },
      { type: "remove", text: "b", oldLine: 2, newLine: undefined },
      { type: "add", text: "B", oldLine: undefined, newLine: 2 },
      { type: "equal", text: "c", oldLine: 3, newLine: 3 },
      { type: "add", text: "d", oldLine: undefined, newLine: 4 },
    ]);
    expect(diffStats(ops)).toEqual({ added: 2, removed: 1, unchanged: 2 });
  });

  it("ignores a trailing newline and handles CRLF", () => {
    expect(splitLines("a\r\nb\r\n")).toEqual(["a", "b"]);
    expect(splitLines("")).toEqual([]);
    expect(diffStats(diffTextLines("a\nb\n", "a\nb"))).toEqual({
      added: 0,
      removed: 0,
      unchanged: 2,
    });
  });
});

describe("chunkDiff", () => {
  const lines = (n: number, prefix = "l") => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

  it("collapses long unchanged runs and keeps context", () => {
    const oldText = [...lines(10), "old", ...lines(10, "t")].join("\n");
    const newText = [...lines(10), "new", ...lines(10, "t")].join("\n");
    const chunks = chunkDiff(diffTextLines(oldText, newText), 3);
    expect(chunks.map((c) => c.kind)).toEqual(["collapsed", "visible", "collapsed"]);
    expect(chunks[0]?.ops.length).toBe(7);
    const visible = chunks[1]?.ops ?? [];
    expect(visible.map((o) => o.type)).toEqual([
      "equal",
      "equal",
      "equal",
      "remove",
      "add",
      "equal",
      "equal",
      "equal",
    ]);
    expect(chunks[2]?.ops.length).toBe(7);
  });

  it("does not collapse when there are no changes", () => {
    const text = lines(40).join("\n");
    const chunks = chunkDiff(diffTextLines(text, text));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.kind).toBe("visible");
  });

  it("keeps short unchanged runs visible", () => {
    const ops = diffTextLines("a\nb\nc\nd", "A\nb\nc\nD");
    const chunks = chunkDiff(ops, 1);
    expect(chunks.every((c) => c.kind === "visible")).toBe(true);
  });
});

describe("toSplitRows", () => {
  it("pairs removes with adds and pads the shorter side", () => {
    const rows = toSplitRows(diffTextLines("a\nb\nc", "a\nB\nC\nD"));
    expect(rows).toHaveLength(4);
    expect(rows[0]?.paired).toBe(false);
    expect(rows[1]?.left?.text).toBe("b");
    expect(rows[1]?.right?.text).toBe("B");
    expect(rows[1]?.paired).toBe(true);
    expect(rows[2]?.left?.text).toBe("c");
    expect(rows[2]?.right?.text).toBe("C");
    expect(rows[3]?.left).toBeNull();
    expect(rows[3]?.right?.text).toBe("D");
  });
});

describe("diffTokens", () => {
  it("flags only the changed tokens", () => {
    const { old, new: next } = diffTokens('"auto": 0.85,', '"auto": 0.9,');
    expect(old.filter((s) => s.changed).map((s) => s.text)).toEqual(["85"]);
    expect(next.filter((s) => s.changed).map((s) => s.text)).toEqual(["9"]);
    expect(old.map((s) => s.text).join("")).toBe('"auto": 0.85,');
    expect(next.map((s) => s.text).join("")).toBe('"auto": 0.9,');
  });
});
