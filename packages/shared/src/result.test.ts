import { describe, expect, it } from "vitest";

import {
  UnwrapError,
  all,
  andThen,
  err,
  isErr,
  isOk,
  map,
  mapErr,
  ok,
  tryCatch,
  tryCatchAsync,
  unwrap,
  unwrapOr,
} from "./result.js";

describe("Result", () => {
  it("ok()/err() build frozen discriminated values", () => {
    const a = ok(1);
    const b = err("boom");
    expect(a).toEqual({ ok: true, value: 1 });
    expect(b).toEqual({ ok: false, error: "boom" });
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(b)).toBe(true);
    expect(ok()).toEqual({ ok: true, value: undefined });
  });

  it("isOk/isErr narrow the union", () => {
    const r = Math.random() >= 0 ? ok(2) : err(new Error("x"));
    expect(isOk(r)).toBe(true);
    expect(isErr(r)).toBe(false);
    if (isOk(r)) {
      expect(r.value).toBe(2);
    }
    const e = err(new Error("x"));
    expect(isErr(e)).toBe(true);
    expect(isOk(e)).toBe(false);
  });

  it("unwrap returns the value or throws the error", () => {
    expect(unwrap(ok("v"))).toBe("v");
    const error = new Error("real");
    expect(() => unwrap(err(error))).toThrow(error);
  });

  it("unwrap wraps non-Error errors in UnwrapError with the original as cause", () => {
    let thrown: unknown;
    try {
      unwrap(err({ code: "E_X" }));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(UnwrapError);
    if (thrown instanceof UnwrapError) {
      expect(thrown.cause).toEqual({ code: "E_X" });
      expect(thrown.value).toEqual({ code: "E_X" });
      expect(thrown.message).toContain('{"code":"E_X"}');
    }
  });

  it("unwrapOr falls back on Err only", () => {
    expect(unwrapOr(ok(1), 9)).toBe(1);
    expect(unwrapOr(err("x"), 9)).toBe(9);
  });

  it("map/mapErr/andThen transform the right branch", () => {
    expect(map(ok(2), (v) => v * 2)).toEqual(ok(4));
    expect(map(err("e"), (v: number) => v * 2)).toEqual(err("e"));
    expect(mapErr(err("e"), (e) => e.toUpperCase())).toEqual(err("E"));
    expect(mapErr(ok(1), (e: string) => e.toUpperCase())).toEqual(ok(1));
    expect(andThen(ok(2), (v) => ok(String(v)))).toEqual(ok("2"));
    expect(andThen(ok(2), () => err("nope"))).toEqual(err("nope"));
    expect(andThen(err("first"), () => ok(1))).toEqual(err("first"));
  });

  it("tryCatch captures throws, optionally mapping them", () => {
    expect(tryCatch(() => 1)).toEqual(ok(1));
    const boom = new Error("boom");
    const r = tryCatch(() => {
      throw boom;
    });
    expect(r).toEqual(err(boom));
    const mapped = tryCatch(
      () => {
        throw boom;
      },
      (e) => (e instanceof Error ? e.message : "?"),
    );
    expect(mapped).toEqual(err("boom"));
  });

  it("tryCatchAsync captures rejections", async () => {
    expect(await tryCatchAsync(() => Promise.resolve("x"))).toEqual(ok("x"));
    const r = await tryCatchAsync(
      () => Promise.reject(new Error("async boom")),
      (e) => (e instanceof Error ? e.message : "?"),
    );
    expect(r).toEqual(err("async boom"));
  });

  it("all collects values or returns the first Err", () => {
    expect(all([ok(1), ok(2)])).toEqual(ok([1, 2]));
    expect(all([ok(1), err("a"), err("b")])).toEqual(err("a"));
    expect(all([])).toEqual(ok([]));
  });
});
