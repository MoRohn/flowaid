/**
 * Exhaustiveness and invariant helpers.
 */

/** Thrown when an invariant that the type system could not express is violated at runtime. */
export class InvariantError extends Error {
  override readonly name = "InvariantError";
}

/**
 * Marks an unreachable branch. Use it as the `default` of a `switch` over a discriminated
 * union: the parameter type `never` makes the compiler fail when a new variant is added and
 * not handled, and the runtime throw catches values that bypassed the type system.
 */
export function assertNever(value: never, message?: string): never {
  const shown = describeUnexpected(value);
  throw new InvariantError(message ?? `Unexpected value: ${shown}`);
}

function describeUnexpected(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "object" && value !== null) {
    try {
      return JSON.stringify(value) ?? Object.prototype.toString.call(value);
    } catch {
      return Object.prototype.toString.call(value);
    }
  }
  return String(value);
}

/**
 * Throws {@link InvariantError} unless `condition` is truthy. Narrows `condition` for the
 * rest of the block. `message` may be lazy to avoid building strings on the happy path.
 */
export function invariant(
  condition: unknown,
  message: string | (() => string) = "Invariant violated",
): asserts condition {
  if (!condition) {
    throw new InvariantError(typeof message === "function" ? message() : message);
  }
}

/** Throws {@link InvariantError} when `value` is `null` or `undefined`; returns it otherwise. */
export function assertDefined<T>(value: T, message?: string): NonNullable<T> {
  if (value === null || value === undefined) {
    throw new InvariantError(message ?? "Expected a defined value");
  }
  return value;
}
