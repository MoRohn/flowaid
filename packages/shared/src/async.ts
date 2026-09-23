/**
 * A small, bounded set of async utilities. Everything here is cancellable through
 * `AbortSignal` and never leaves a dangling timer behind, which matters in workers that must
 * shut down promptly.
 */

/** Thrown when an operation is cancelled through an `AbortSignal`. */
export class AbortError extends Error {
  override readonly name = "AbortError";

  constructor(message = "The operation was aborted", options?: { cause?: unknown }) {
    super(message, options);
  }
}

/** Thrown by {@link withTimeout} when the deadline passes before the operation settles. */
export class TimeoutError extends Error {
  override readonly name = "TimeoutError";

  constructor(
    /** The deadline that was exceeded, in milliseconds. */
    readonly timeoutMs: number,
    message = `Operation timed out after ${String(timeoutMs)} ms`,
  ) {
    super(message);
  }
}

/** True when `error` is an {@link AbortError} or a DOM-style abort (`name === "AbortError"`). */
export function isAbortError(error: unknown): boolean {
  return (
    error instanceof AbortError ||
    (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError")
  );
}

function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  if (reason instanceof Error) {
    return reason;
  }
  return new AbortError(undefined, reason === undefined ? undefined : { cause: reason });
}

/**
 * Resolves after `ms` milliseconds. Rejects immediately with the signal's reason (or an
 * {@link AbortError}) if `signal` is already aborted, or as soon as it aborts. The timer is
 * always cleared, so a cancelled sleep never keeps the event loop alive.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (!Number.isFinite(ms) || ms < 0) {
    return Promise.reject(new RangeError(`sleep: invalid duration ${String(ms)}`));
  }
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal === undefined ? new AbortError() : abortReason(signal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Runs `operation` with a deadline. `operation` receives an `AbortSignal` that aborts when
 * the deadline passes or when the optional outer `signal` aborts; it should forward that
 * signal to whatever it awaits. On deadline the returned promise rejects with
 * {@link TimeoutError}; on outer abort with the signal's reason.
 */
export async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new RangeError(`withTimeout: invalid timeout ${String(timeoutMs)}`);
  }
  if (signal?.aborted) {
    throw abortReason(signal);
  }
  const controller = new AbortController();
  const timeoutError = new TimeoutError(timeoutMs);
  const timer = setTimeout(() => {
    controller.abort(timeoutError);
  }, timeoutMs);
  const onOuterAbort = (): void => {
    controller.abort(signal === undefined ? new AbortError() : abortReason(signal));
  };
  signal?.addEventListener("abort", onOuterAbort, { once: true });
  try {
    return await new Promise<T>((resolve, reject) => {
      controller.signal.addEventListener(
        "abort",
        () => {
          reject(abortReason(controller.signal));
        },
        { once: true },
      );
      operation(controller.signal).then(resolve, (error: unknown) => {
        // A timed-out operation usually rejects with the abort reason it was handed; report
        // the timeout (or outer abort) rather than the operation's own wrapping of it.
        if (controller.signal.aborted) {
          reject(abortReason(controller.signal));
        } else {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onOuterAbort);
  }
}

/** A concurrency limiter returned by {@link pLimit}. */
export interface Limiter {
  /** Schedules `task`; it starts once fewer than `concurrency` tasks are running. */
  run<T>(task: () => Promise<T>): Promise<T>;
  /** Number of tasks currently running. */
  readonly active: number;
  /** Number of tasks waiting to start. */
  readonly pending: number;
  /** The configured concurrency. */
  readonly concurrency: number;
}

/**
 * Creates a limiter that runs at most `concurrency` tasks at the same time, in FIFO order.
 * Rejections propagate to the caller of the individual task and never stall the queue.
 */
export function pLimit(concurrency: number): Limiter {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError(
      `pLimit: concurrency must be a positive integer, received ${String(concurrency)}`,
    );
  }
  let active = 0;
  const queue: (() => void)[] = [];

  const next = (): void => {
    active -= 1;
    const run = queue.shift();
    if (run !== undefined) {
      run();
    }
  };

  const run = <T>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const start = (): void => {
        active += 1;
        let result: Promise<T>;
        try {
          result = task();
        } catch (error) {
          next();
          reject(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        result.then(
          (value) => {
            next();
            resolve(value);
          },
          (error: unknown) => {
            next();
            reject(error instanceof Error ? error : new Error(String(error)));
          },
        );
      };
      if (active < concurrency) {
        start();
      } else {
        queue.push(start);
      }
    });

  return {
    run,
    concurrency,
    get active() {
      return active;
    },
    get pending() {
      return queue.length;
    },
  };
}
