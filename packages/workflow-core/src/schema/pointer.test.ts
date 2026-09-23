import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import {
  appendPointerToken,
  escapePointerToken,
  formatPointer,
  isArrayIndexToken,
  isJsonPointer,
  parsePointer,
  unescapePointerToken,
} from "./pointer.js";

describe("RFC 6901 pointer utilities", () => {
  it("escapes and unescapes in the order the RFC requires", () => {
    expect(escapePointerToken("a/b")).toBe("a~1b");
    expect(escapePointerToken("a~b")).toBe("a~0b");
    expect(escapePointerToken("~1")).toBe("~01");
    expect(unescapePointerToken("~01")).toBe("~1");
    expect(unescapePointerToken("a~1b")).toBe("a/b");
    expect(unescapePointerToken("~0~1")).toBe("~/");
  });

  it("parses the RFC examples", () => {
    expect(parsePointer("")).toEqual({ ok: true, tokens: [] });
    expect(parsePointer("/foo")).toEqual({ ok: true, tokens: ["foo"] });
    expect(parsePointer("/foo/0")).toEqual({ ok: true, tokens: ["foo", "0"] });
    expect(parsePointer("/")).toEqual({ ok: true, tokens: [""] });
    expect(parsePointer("/a~1b")).toEqual({ ok: true, tokens: ["a/b"] });
    expect(parsePointer("/m~0n")).toEqual({ ok: true, tokens: ["m~n"] });
    expect(parsePointer("/ ")).toEqual({ ok: true, tokens: [" "] });
  });

  it("rejects malformed pointers", () => {
    expect(parsePointer("foo").ok).toBe(false);
    expect(parsePointer("/a~b").ok).toBe(false);
    expect(parsePointer("/a~2").ok).toBe(false);
    expect(isJsonPointer("/a~")).toBe(false);
    expect(isJsonPointer("")).toBe(true);
  });

  it("formats and appends", () => {
    expect(formatPointer([])).toBe("");
    expect(formatPointer(["a/b", "0", "~"])).toBe("/a~1b/0/~0");
    expect(appendPointerToken("", "x/y")).toBe("/x~1y");
    expect(appendPointerToken("/a", "0")).toBe("/a/0");
  });

  it("recognises canonical array indexes only", () => {
    expect(isArrayIndexToken("0")).toBe(true);
    expect(isArrayIndexToken("10")).toBe(true);
    expect(isArrayIndexToken("01")).toBe(false);
    expect(isArrayIndexToken("-")).toBe(false);
    expect(isArrayIndexToken("")).toBe(false);
    expect(isArrayIndexToken("1e3")).toBe(false);
  });

  it("round-trips arbitrary tokens", () => {
    fc.assert(
      fc.property(fc.array(fc.string()), (tokens) => {
        const pointer = formatPointer(tokens);
        expect(isJsonPointer(pointer)).toBe(true);
        expect(parsePointer(pointer)).toEqual({ ok: true, tokens });
      }),
    );
  });
});
