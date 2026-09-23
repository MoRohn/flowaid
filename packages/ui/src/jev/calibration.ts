/**
 * Calibration helpers for the calibration panel (JEV_ENGINEERING.md §7): the
 * adapter from `ReliabilityBin` to the decision group's `CalibrationBin`, the
 * status of ECE against the recommendation target and alarm tones.
 */
import type { CalibrationBin } from "@/decision/CalibrationChart";
import type { JevDriftAlarm, JevReliabilityBin } from "./types";
import type { JevTone } from "./vocabulary";

/** Recommendation and promotion target (§7.6, §11.4): segment ECE ≤ 0.05. */
export const ECE_TARGET = 0.05;

/** Reliability bins → `CalibrationChart` bins; bins without labels become empty bins. */
export function toCalibrationBins(bins: readonly JevReliabilityBin[]): CalibrationBin[] {
  return bins.map((b) => {
    const mid = (b.lo + b.hi) / 2;
    const empty = b.labeled <= 0 || b.meanConfidence === null || b.accuracy === null;
    return {
      lower: b.lo,
      upper: b.hi,
      predicted: empty ? mid : (b.meanConfidence ?? mid),
      observed: empty ? mid : (b.accuracy ?? mid),
      count: empty ? 0 : b.labeled,
    };
  });
}

/** ok at or below the target, warn up to 1.6× (the +0.03 alarm band), danger above. */
export function eceTone(ece: number | null): JevTone {
  if (ece === null) return "neutral";
  if (ece <= ECE_TARGET) return "ok";
  if (ece <= ECE_TARGET + 0.03) return "warn";
  return "danger";
}

export const ALARM_TONE: Record<JevDriftAlarm["severity"], JevTone> = {
  info: "info",
  warning: "warn",
  critical: "danger",
};

/** Alarms most severe first. */
export function sortAlarms(alarms: readonly JevDriftAlarm[]): JevDriftAlarm[] {
  const rank = { critical: 0, warning: 1, info: 2 } as const;
  return alarms.slice().sort((a, b) => rank[a.severity] - rank[b.severity]);
}
