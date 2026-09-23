/**
 * Time helpers. Every timestamp flowaid persists is an ISO 8601 UTC string with millisecond
 * precision (`2026-09-22T10:15:30.123Z`), which is what `nowIso()` returns.
 */

/** Matches the exact ISO 8601 UTC form produced by {@link nowIso} / `Date#toISOString`. */
export const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** A function returning the current Unix time in milliseconds. Injected into tests. */
export type Clock = () => number;

/** The wall clock: `Date.now`. */
export const systemClock: Clock = () => Date.now();

/** Current UTC time as an ISO 8601 string with millisecond precision. */
export function nowIso(clock: Clock = systemClock): string {
  return new Date(clock()).toISOString();
}

/** Converts a millisecond Unix timestamp to the ISO 8601 UTC form. */
export function toIso(ms: number): string {
  if (!Number.isFinite(ms)) {
    throw new RangeError(`toIso: invalid timestamp ${String(ms)}`);
  }
  return new Date(ms).toISOString();
}

/**
 * Parses an ISO 8601 timestamp to milliseconds. Returns `undefined` for anything `Date`
 * cannot parse, rather than the `NaN` that `Date.parse` would produce.
 */
export function parseIso(value: string): number | undefined {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : ms;
}

/** True when `value` is a string in the exact form produced by {@link nowIso}. */
export function isIsoUtc(value: unknown): value is string {
  return typeof value === "string" && ISO_UTC_RE.test(value) && !Number.isNaN(Date.parse(value));
}

/** Milliseconds elapsed between two ISO timestamps (`to − from`). */
export function elapsedMs(from: string, to: string): number {
  const a = parseIso(from);
  const b = parseIso(to);
  if (a === undefined || b === undefined) {
    throw new RangeError(`elapsedMs: invalid timestamp (${from}, ${to})`);
  }
  return b - a;
}
