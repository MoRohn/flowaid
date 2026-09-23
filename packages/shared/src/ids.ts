/**
 * UUID version 7 (RFC 9562 §5.7) generator.
 *
 * Layout (128 bits, big-endian):
 *   unix_ts_ms (48) | ver=7 (4) | rand_a (12) | var=10 (2) | rand_b (62)
 *
 * Monotonicity: `rand_a` is used as the RFC 9562 §6.2 "Method 1" fixed-length dedicated
 * counter. It is seeded with a random value whose top bit is clear whenever the millisecond
 * changes, and incremented for every id minted within the same millisecond. Because the
 * timestamp is never allowed to move backwards (a clock step back keeps using the last seen
 * millisecond) and a counter overflow rolls into the next millisecond, ids produced by one
 * process are strictly increasing in both binary and string form.
 */

const HEX: readonly string[] = Array.from({ length: 256 }, (_, i) =>
  i.toString(16).padStart(2, "0"),
);

/** Matches the canonical lower-case textual form of any RFC 9562 UUID. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Matches the canonical lower-case textual form of a version 7 UUID. */
export const UUID_V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The counter lives in the 12 `rand_a` bits. */
const COUNTER_MAX = 0xfff;

interface GeneratorState {
  lastMs: number;
  counter: number;
}

const state: GeneratorState = { lastMs: -1, counter: 0 };

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function nextTimestampAndCounter(nowMs: number): { ms: number; counter: number } {
  let ms = nowMs > state.lastMs ? nowMs : state.lastMs;
  let counter: number;
  if (ms === state.lastMs) {
    counter = state.counter + 1;
    if (counter > COUNTER_MAX) {
      // Counter exhausted inside one millisecond: borrow the next one (RFC 9562 §6.2).
      ms += 1;
      counter = seedCounter();
    }
  } else {
    counter = seedCounter();
  }
  state.lastMs = ms;
  state.counter = counter;
  return { ms, counter };
}

/** Random 12-bit seed with the top bit clear, leaving 2048 increments before rollover. */
function seedCounter(): number {
  const seed = randomBytes(2);
  const b0 = seed[0] ?? 0;
  const b1 = seed[1] ?? 0;
  return ((b0 << 8) | b1) & 0x7ff;
}

/**
 * Generates a UUIDv7 as 16 raw bytes. Ids from the same process are strictly increasing.
 * `nowMs` overrides the clock (tests only); it is clamped so the sequence never regresses.
 */
export function uuidv7Bytes(nowMs: number = Date.now()): Uint8Array {
  const { ms, counter } = nextTimestampAndCounter(Math.floor(nowMs));
  const bytes = randomBytes(16);
  // 48-bit timestamp, big-endian. `ms` is below 2^48 until the year 10889.
  const hi = Math.floor(ms / 0x1_0000_0000);
  const lo = ms >>> 0;
  bytes[0] = (hi >>> 8) & 0xff;
  bytes[1] = hi & 0xff;
  bytes[2] = (lo >>> 24) & 0xff;
  bytes[3] = (lo >>> 16) & 0xff;
  bytes[4] = (lo >>> 8) & 0xff;
  bytes[5] = lo & 0xff;
  // version 7 + counter high nibble, then counter low byte.
  bytes[6] = 0x70 | ((counter >>> 8) & 0x0f);
  bytes[7] = counter & 0xff;
  // RFC 4122 variant on the two top bits of byte 8; the remaining bits stay random.
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);
  return bytes;
}

/** Formats 16 bytes as a canonical lower-case UUID string. */
export function formatUuid(bytes: Uint8Array): string {
  if (bytes.length !== 16) {
    throw new RangeError(`formatUuid expects 16 bytes, received ${String(bytes.length)}`);
  }
  let out = "";
  for (let i = 0; i < 16; i += 1) {
    if (i === 4 || i === 6 || i === 8 || i === 10) {
      out += "-";
    }
    out += HEX[bytes[i] ?? 0];
  }
  return out;
}

/**
 * Generates a time-ordered UUIDv7 string (RFC 9562). Successive calls within one process
 * return strictly increasing strings, even inside a single millisecond and across clock
 * steps backwards, so they can be used as Postgres `uuid` primary keys that cluster by time.
 */
export function uuidv7(nowMs: number = Date.now()): string {
  return formatUuid(uuidv7Bytes(nowMs));
}

/** True when `value` is a canonical lower-case UUID string of any version 1–8. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** True when `value` is a canonical lower-case UUIDv7 string. */
export function isUuidv7(value: unknown): value is string {
  return typeof value === "string" && UUID_V7_RE.test(value);
}

/**
 * Extracts the millisecond Unix timestamp embedded in a UUIDv7. Throws a `TypeError` for
 * anything that is not a canonical UUIDv7 string.
 */
export function uuidv7Timestamp(id: string): number {
  if (!UUID_V7_RE.test(id)) {
    throw new TypeError(`Not a UUIDv7: ${id}`);
  }
  const hex = id.slice(0, 8) + id.slice(9, 13);
  return Number.parseInt(hex, 16);
}
