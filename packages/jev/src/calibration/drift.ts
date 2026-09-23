/**
 * Drift alarms (JEV_ENGINEERING.md §7.5). The handbook gives no numbers; these are flowaid's
 * defaults, and `inspectFirst` follows handbook Table IX: most drift is a state, menu or contract
 * problem before it is a model problem.
 */
import type { CalibrationMetrics, DriftAlarm, InspectFirst } from "./schemas.js";

export interface DriftWindow {
  metrics: CalibrationMetrics;
  resolvedModel?: string | null;
}

export interface DriftOptions {
  /** Share of adjacent fixture-ladder pairs with a monotonicity violation in the last contract test. */
  monotonicityViolationShare?: number | null;
}

const INSPECT: Record<DriftAlarm["kind"], InspectFirst[]> = {
  ece_rise: ["evidence", "menu_completeness", "calibration"],
  review_rate_rise: ["state_freshness", "new_option_class"],
  escape_rate_rise: ["new_option_class"],
  near_threshold_mass: ["calibration", "contract_wording"],
  confidence_shift: ["state_freshness"],
  override_rate: ["evidence", "calibration", "policy_order"],
  model_version_changed: ["calibration"],
  label_disagreement: ["contract_wording"],
  stale_options: ["menu_completeness"],
  monotonicity: ["contract_wording", "evidence"],
};

function alarm(
  kind: DriftAlarm["kind"],
  severity: DriftAlarm["severity"],
  value: number,
  baseline: number | null,
  threshold: number,
  message: string,
): DriftAlarm {
  return { kind, severity, value, baseline, threshold, message, inspectFirst: INSPECT[kind] };
}

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

/** Evaluates every §7.5 alarm for a window against an optional baseline. */
export function driftAlarms(
  window: DriftWindow,
  baseline: DriftWindow | null,
  options: DriftOptions = {},
): DriftAlarm[] {
  const m = window.metrics;
  const b = baseline?.metrics ?? null;
  const out: DriftAlarm[] = [];

  if (b !== null && m.ece !== null && b.ece !== null && m.labeled >= 50) {
    const rise = m.ece - b.ece;
    if (rise >= 0.03) {
      out.push(
        alarm(
          "ece_rise",
          rise >= 0.06 ? "critical" : "warning",
          m.ece,
          b.ece,
          0.03,
          `ECE rose from ${b.ece.toFixed(3)} to ${m.ece.toFixed(3)} on ${m.labeled} labeled decisions`,
        ),
      );
    }
  }
  if (
    b !== null &&
    m.decisions >= 200 &&
    b.routeShare.human > 0 &&
    m.routeShare.human >= 1.5 * b.routeShare.human
  ) {
    out.push(
      alarm(
        "review_rate_rise",
        "warning",
        m.routeShare.human,
        b.routeShare.human,
        1.5,
        `Human-review share rose from ${pct(b.routeShare.human)} to ${pct(m.routeShare.human)}`,
      ),
    );
  }
  if (
    b !== null &&
    m.decisions >= 200 &&
    b.rates.escape > 0 &&
    m.rates.escape >= 2 * b.rates.escape
  ) {
    out.push(
      alarm(
        "escape_rate_rise",
        "warning",
        m.rates.escape,
        b.rates.escape,
        2,
        `Escape-outcome share doubled from ${pct(b.rates.escape)} to ${pct(m.rates.escape)}; a new option class may be missing`,
      ),
    );
  }
  if (m.nearThreshold.above >= 0.15) {
    out.push(
      alarm(
        "near_threshold_mass",
        "warning",
        m.nearThreshold.above,
        null,
        0.15,
        `${pct(m.nearThreshold.above)} of decisions sit just above the automation threshold; improve the contract or widen the review zone before increasing autonomy`,
      ),
    );
  }
  if (m.psi !== null && m.psi >= 0.2) {
    out.push(
      alarm(
        "confidence_shift",
        m.psi >= 0.3 ? "critical" : "warning",
        m.psi,
        null,
        0.2,
        `Confidence distribution shifted (PSI ${m.psi.toFixed(3)})`,
      ),
    );
  }
  const autoDecisions = Math.round(m.routeShare.auto * m.decisions);
  if (autoDecisions >= 50 && m.rates.override >= 0.05) {
    out.push(
      alarm(
        "override_rate",
        "critical",
        m.rates.override,
        b?.rates.override ?? null,
        0.05,
        `${pct(m.rates.override)} of automated decisions were overridden by people`,
      ),
    );
  }
  const now = window.resolvedModel ?? null;
  const then = baseline?.resolvedModel ?? null;
  if (now !== null && then !== null && now !== then) {
    out.push(
      alarm(
        "model_version_changed",
        "info",
        1,
        null,
        1,
        `Resolved model changed from ${then} to ${now}; recompute segments`,
      ),
    );
  }
  const ird = m.rates.interRaterDisagreement;
  if (ird !== null && ird >= 0.2) {
    out.push(
      alarm(
        "label_disagreement",
        "warning",
        ird,
        null,
        0.2,
        `Labelers disagree on ${pct(ird)} of multiply-labeled decisions; the contract wording is ambiguous`,
      ),
    );
  }
  if (m.rates.staleOption >= 0.01) {
    out.push(
      alarm(
        "stale_options",
        "warning",
        m.rates.staleOption,
        null,
        0.01,
        `${pct(m.rates.staleOption)} of decisions picked an option that was stale at action time`,
      ),
    );
  }
  const mono = options.monotonicityViolationShare ?? null;
  if (mono !== null && mono > 0.1) {
    out.push(
      alarm(
        "monotonicity",
        "warning",
        mono,
        null,
        0.1,
        `Confidence fell as evidence improved in ${pct(mono)} of fixture ladder steps`,
      ),
    );
  }
  return out;
}
