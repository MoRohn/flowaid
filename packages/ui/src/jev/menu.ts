/**
 * Live option-menu helpers (JEV_ENGINEERING.md §10): escapes are always
 * visible (the shortlist must preserve an escape hatch), live options fold into
 * an overflow past the visible limit, and the candidate funnel explains where
 * options were removed so a failure can be assigned to filtering, shortlisting
 * or the semantic choice.
 */
import type { JevOptionCounts, JevOptionEntry } from "./types";
import { JEV_LIMITS } from "./vocabulary";

export interface MenuSplit {
  visible: JevOptionEntry[];
  overflow: JevOptionEntry[];
  escapes: JevOptionEntry[];
}

export function splitMenu(entries: readonly JevOptionEntry[], visibleLimit: number): MenuSplit {
  const live = entries.filter((e) => e.escape === undefined);
  const escapes = entries.filter((e) => e.escape !== undefined);
  const limit = Math.max(0, Math.floor(visibleLimit));
  return { visible: live.slice(0, limit), overflow: live.slice(limit), escapes };
}

export interface FunnelStep {
  key: keyof JevOptionCounts;
  label: string;
  hint: string;
  value: number;
  /** Removed by this step (0 for the first). */
  removed: number;
}

const FUNNEL: { key: keyof JevOptionCounts; label: string; hint: string }[] = [
  { key: "original", label: "Candidates", hint: "All candidates from the binding or live catalog" },
  {
    key: "kept",
    label: "Kept",
    hint: "Deterministic exclusion: availability, enabled, permissions",
  },
  { key: "eligible", label: "Eligible", hint: "Data-class eligibility and budget (code)" },
  { key: "shortlisted", label: "Shortlisted", hint: "Shortlist by score, capped at maxOptions" },
  { key: "final", label: "Sent", hint: "Options sent to Jev, escapes included" },
];

export function menuFunnel(counts: JevOptionCounts): FunnelStep[] {
  return FUNNEL.map((step, i) => {
    const prev = i > 0 ? FUNNEL[i - 1] : undefined;
    const value = counts[step.key];
    return {
      ...step,
      value,
      removed: prev && step.key !== "final" ? Math.max(0, counts[prev.key] - value) : 0,
    };
  });
}

export interface MenuFreshness {
  ageMs: number | null;
  stale: boolean;
}

/** An option set older than the contract's `maxAgeMs` is stale ⇒ the route is capped at improve (rebuild). */
export function menuFreshness(builtAt: string, now: number, maxAgeMs: number): MenuFreshness {
  const t = Date.parse(builtAt);
  if (!Number.isFinite(t)) return { ageMs: null, stale: false };
  const ageMs = Math.max(0, now - t);
  return { ageMs, stale: ageMs > maxAgeMs };
}

/** Room left under TypeSafe's 255-option limit. */
export function menuHeadroom(size: number): number {
  return JEV_LIMITS.maxChoiceOptions - size;
}
