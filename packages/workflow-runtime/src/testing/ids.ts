/** Deterministic ids and randomness for tests and golden traces. */
import type { IdSource } from "../step.js";

/** mulberry32: a tiny, well-distributed seeded PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** UUIDs `00000000-0000-4000-8000-<prefix><counter>` and a seeded `random()`. */
export function seededIds(seed = 1, prefix = 0): IdSource {
  let n = 0;
  const random = mulberry32(seed);
  return {
    uuid: () => {
      n += 1;
      const tail = `${prefix.toString(16).padStart(4, "0")}${n.toString(16).padStart(8, "0")}`;
      return `00000000-0000-4000-8000-${tail}`;
    },
    random,
  };
}
