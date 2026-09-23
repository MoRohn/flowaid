/**
 * `@flowaid/shared` — browser-safe primitives used by every other flowaid package. The only
 * runtime dependency is `@noble/hashes` (pure-JS SHA-256); no Node built-ins anywhere.
 *
 * Nothing here knows about workflows, runs or providers; it is the vocabulary the rest of
 * the platform is written in: JSON values, `Result`, time-ordered ids, content hashes,
 * deterministic serialisation, time and a few bounded async helpers.
 */

export type { JsonArray, JsonObject, JsonPrimitive, JsonValue } from "./json.js";
export {
  canonicalize,
  cloneJson,
  deepEqual,
  isJsonObject,
  isJsonValue,
  isPlainObject,
} from "./json.js";

export type { Err, Ok, Result } from "./result.js";
export {
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

export {
  UUID_RE,
  UUID_V7_RE,
  formatUuid,
  isUuid,
  isUuidv7,
  uuidv7,
  uuidv7Bytes,
  uuidv7Timestamp,
} from "./ids.js";

export { StableStringifyError, stableStringify } from "./stringify.js";

export { sha256Bytes, sha256Hex, sha256Json, sha256JsonRef } from "./hash.js";

export type { Clock } from "./time.js";
export { ISO_UTC_RE, elapsedMs, isIsoUtc, nowIso, parseIso, systemClock, toIso } from "./time.js";

export { InvariantError, assertDefined, assertNever, invariant } from "./assert.js";

export type { Limiter } from "./async.js";
export { AbortError, TimeoutError, isAbortError, pLimit, sleep, withTimeout } from "./async.js";
