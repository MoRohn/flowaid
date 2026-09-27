import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { Code, call, js } from "./literal.js";

describe("js", () => {
  it("quotes keys that are not identifiers and never lets __proto__ set a prototype", () => {
    const source = js({ a: 1, "b-c": [true, null], ["__proto__"]: { polluted: 1 } });
    expect(source).toBe('{a: 1, "b-c": [true, null], ["__proto__"]: {polluted: 1}}');
    const value = runInNewContext(`(${source})`) as Record<string, unknown>;
    expect(Object.getOwnPropertyNames(value)).toContain("__proto__");
    expect(Object.getPrototypeOf(value)).not.toHaveProperty("polluted");
  });

  it("drops undefined properties and trailing undefined arguments, and keeps Code verbatim", () => {
    expect(js({ a: undefined, b: new Code("x()") })).toBe("{b: x()}");
    expect(call("f", 1, undefined, undefined).source).toBe("f(1)");
    expect(call("f", undefined, 2).source).toBe("f(undefined, 2)");
  });
});
