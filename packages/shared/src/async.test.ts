import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AbortError, TimeoutError, isAbortError, pLimit, sleep, withTimeout } from "./async.js";

describe("sleep", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves after the duration", async () => {
    const p = sleep(1000);
    let settled = false;
    void p.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
  });

  it("rejects immediately when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(sleep(10, controller.signal)).rejects.toSatisfy(isAbortError);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects with the abort reason and clears the timer when aborted mid-sleep", async () => {
    const controller = new AbortController();
    const reason = new Error("stop");
    const p = sleep(10_000, controller.signal);
    const assertion = expect(p).rejects.toBe(reason);
    controller.abort(reason);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("wraps non-Error abort reasons in AbortError", async () => {
    const controller = new AbortController();
    const p = sleep(10, controller.signal);
    controller.abort("because");
    let caught: unknown;
    try {
      await p;
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AbortError);
    expect(caught instanceof AbortError ? caught.cause : undefined).toBe("because");
  });

  it("rejects invalid durations", async () => {
    await expect(sleep(-1)).rejects.toThrow(RangeError);
    await expect(sleep(Number.NaN)).rejects.toThrow(RangeError);
  });
});

describe("withTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the operation's value when it settles in time", async () => {
    const result = await withTimeout(() => Promise.resolve(42), 100);
    expect(result).toBe(42);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("propagates the operation's own rejection", async () => {
    await expect(withTimeout(() => Promise.reject(new Error("inner")), 100)).rejects.toThrow(
      "inner",
    );
  });

  it("rejects with TimeoutError and aborts the inner signal on deadline", async () => {
    let innerAborted = false;
    const p = withTimeout(
      (signal) =>
        new Promise<never>((_, reject) => {
          signal.addEventListener("abort", () => {
            innerAborted = true;
            reject(new Error("inner saw abort"));
          });
        }),
      50,
    );
    const assertion = expect(p).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
    expect(innerAborted).toBe(true);
  });

  it("rejects with TimeoutError even if the operation never settles", async () => {
    const p = withTimeout(() => new Promise<never>(() => undefined), 10);
    const assertion = expect(p).rejects.toThrow("timed out after 10 ms");
    await vi.advanceTimersByTimeAsync(10);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("honours an outer abort signal", async () => {
    const controller = new AbortController();
    const reason = new Error("outer");
    const p = withTimeout(() => new Promise<never>(() => undefined), 10_000, controller.signal);
    const assertion = expect(p).rejects.toBe(reason);
    controller.abort(reason);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("throws synchronously-ish for an already aborted outer signal and invalid timeouts", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(withTimeout(() => Promise.resolve(1), 10, controller.signal)).rejects.toSatisfy(
      isAbortError,
    );
    await expect(withTimeout(() => Promise.resolve(1), -5)).rejects.toThrow(RangeError);
  });
});

describe("pLimit", () => {
  it("never runs more than `concurrency` tasks at once and preserves FIFO order", async () => {
    const limit = pLimit(2);
    let running = 0;
    let peak = 0;
    const started: number[] = [];
    const release: (() => void)[] = [];

    const task = (i: number) => (): Promise<number> => {
      running += 1;
      peak = Math.max(peak, running);
      started.push(i);
      return new Promise<number>((resolve) => {
        release.push(() => {
          running -= 1;
          resolve(i);
        });
      });
    };

    const results = Promise.all([0, 1, 2, 3, 4].map((i) => limit.run(task(i))));
    await Promise.resolve();
    expect(started).toEqual([0, 1]);
    expect(limit.active).toBe(2);
    expect(limit.pending).toBe(3);
    expect(limit.concurrency).toBe(2);

    release.shift()?.();
    await Promise.resolve();
    expect(started).toEqual([0, 1, 2]);

    while (release.length > 0) {
      release.shift()?.();
      await Promise.resolve();
    }
    expect(await results).toEqual([0, 1, 2, 3, 4]);
    expect(peak).toBe(2);
    expect(limit.active).toBe(0);
    expect(limit.pending).toBe(0);
  });

  it("propagates rejections and synchronous throws without stalling the queue", async () => {
    const limit = pLimit(1);
    const failing = limit.run(() => Promise.reject(new Error("bad")));
    const throwing = limit.run(() => {
      throw new Error("sync bad");
    });
    const fine = limit.run(() => Promise.resolve("ok"));
    await expect(failing).rejects.toThrow("bad");
    await expect(throwing).rejects.toThrow("sync bad");
    expect(await fine).toBe("ok");
    expect(limit.active).toBe(0);
  });

  it("rejects invalid concurrency", () => {
    expect(() => pLimit(0)).toThrow(RangeError);
    expect(() => pLimit(1.5)).toThrow(RangeError);
  });
});
