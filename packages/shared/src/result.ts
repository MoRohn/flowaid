/**
 * A minimal, allocation-light `Result<T, E>` for code paths where failure is an expected
 * outcome rather than an exception (validation, parsing, provider calls with typed errors).
 *
 * The discriminant is `ok`; both branches are plain frozen objects so results are safe to
 * serialise, compare with {@link deepEqual} and pass across worker boundaries.
 */

/** A successful result carrying `value`. */
export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

/** A failed result carrying `error`. */
export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

/** Either an {@link Ok} or an {@link Err}. */
export type Result<T, E = Error> = Ok<T> | Err<E>;

/** Wraps `value` in an {@link Ok}. */
export function ok<T>(value: T): Ok<T>;
export function ok(): Ok<undefined>;
export function ok<T>(value?: T): Ok<T | undefined> {
  const result: Ok<T | undefined> = { ok: true, value };
  return Object.freeze(result);
}

/** Wraps `error` in an {@link Err}. */
export function err<E>(error: E): Err<E> {
  const result: Err<E> = { ok: false, error };
  return Object.freeze(result);
}

/** Type guard: true when `result` succeeded. */
export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

/** Type guard: true when `result` failed. */
export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}

/**
 * Raised by {@link unwrap} when the error is not itself an `Error`. The original error
 * value is available as `cause`.
 */
export class UnwrapError extends Error {
  override readonly name = "UnwrapError";

  constructor(readonly value: unknown) {
    super(`unwrap() called on an Err result: ${describe(value)}`, { cause: value });
  }
}

function describe(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Returns the value of an {@link Ok}. For an {@link Err} it throws the error when it is an
 * `Error` instance, otherwise an {@link UnwrapError} whose `cause` is the error value.
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) {
    return result.value;
  }
  if (result.error instanceof Error) {
    throw result.error;
  }
  throw new UnwrapError(result.error);
}

/** Returns the value of an {@link Ok}, or `fallback` for an {@link Err}. */
export function unwrapOr<T, E, F = T>(result: Result<T, E>, fallback: F): T | F {
  return result.ok ? result.value : fallback;
}

/** Applies `fn` to the value of an {@link Ok}; an {@link Err} passes through unchanged. */
export function map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

/** Applies `fn` to the error of an {@link Err}; an {@link Ok} passes through unchanged. */
export function mapErr<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  return result.ok ? result : err(fn(result.error));
}

/** Chains a result-returning function onto an {@link Ok}; an {@link Err} short-circuits. */
export function andThen<T, U, E, F>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, F>,
): Result<U, E | F> {
  return result.ok ? fn(result.value) : result;
}

/**
 * Runs `fn` and captures a thrown exception as an {@link Err}. `onError` converts the
 * thrown value (which is `unknown`) into the error type; it defaults to passing it through.
 */
export function tryCatch<T>(fn: () => T): Result<T, unknown>;
export function tryCatch<T, E>(fn: () => T, onError: (thrown: unknown) => E): Result<T, E>;
export function tryCatch<T, E>(fn: () => T, onError?: (thrown: unknown) => E): Result<T, unknown> {
  try {
    return ok(fn());
  } catch (thrown) {
    return err(onError ? onError(thrown) : thrown);
  }
}

/** Async variant of {@link tryCatch}: awaits `fn` and captures a rejection as an {@link Err}. */
export async function tryCatchAsync<T>(fn: () => Promise<T>): Promise<Result<T, unknown>>;
export async function tryCatchAsync<T, E>(
  fn: () => Promise<T>,
  onError: (thrown: unknown) => E,
): Promise<Result<T, E>>;
export async function tryCatchAsync<T, E>(
  fn: () => Promise<T>,
  onError?: (thrown: unknown) => E,
): Promise<Result<T, unknown>> {
  try {
    return ok(await fn());
  } catch (thrown) {
    return err(onError ? onError(thrown) : thrown);
  }
}

/**
 * Collects an array of results into a result of an array. The first {@link Err} wins;
 * otherwise the values are returned in order.
 */
export function all<T, E>(results: readonly Result<T, E>[]): Result<T[], E> {
  const values: T[] = [];
  for (const result of results) {
    if (!result.ok) {
      return result;
    }
    values.push(result.value);
  }
  return ok(values);
}
