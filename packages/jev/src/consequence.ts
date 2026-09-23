/**
 * Consequence classes (JEV_ENGINEERING.md §6.1): ordered `low < medium < high < irreversible`.
 * The handbook never enumerates them; flowaid defines four and orders them so that every
 * routing step can only raise the class (and so only lower authority).
 */
import type { ConsequenceClass } from "./wire.js";

/** Classes in ascending order of stakes. */
export const CONSEQUENCE_ORDER: readonly ConsequenceClass[] = Object.freeze([
  "low",
  "medium",
  "high",
  "irreversible",
]);

/** Rank of a class (0 = low … 3 = irreversible). */
export function consequenceRank(cc: ConsequenceClass): number {
  switch (cc) {
    case "low":
      return 0;
    case "medium":
      return 1;
    case "high":
      return 2;
    case "irreversible":
      return 3;
  }
}

/** Negative when `a` is lower than `b`, 0 when equal, positive when higher. */
export function compareConsequence(a: ConsequenceClass, b: ConsequenceClass): number {
  return consequenceRank(a) - consequenceRank(b);
}

/** The highest of the given classes (nullish entries ignored); `low` when none is given. */
export function maxConsequence(
  ...classes: ReadonlyArray<ConsequenceClass | null | undefined>
): ConsequenceClass {
  let best: ConsequenceClass = "low";
  for (const cc of classes) {
    if (cc !== null && cc !== undefined && consequenceRank(cc) > consequenceRank(best)) best = cc;
  }
  return best;
}
