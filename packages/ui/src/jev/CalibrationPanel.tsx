import { forwardRef, useMemo, type HTMLAttributes } from "react";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatPercent, formatProbability } from "@/lib/format";
import { CalibrationChart } from "@/decision/CalibrationChart";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { BlockTitle, ContractRefChip, Stat } from "./badges";
import { ALARM_TONE, ECE_TARGET, eceTone, sortAlarms, toCalibrationBins } from "./calibration";
import type {
  JevCalibrationMetrics,
  JevCalibrationSegment,
  JevContractRef,
  JevDriftAlarm,
  JevThresholdRecommendation,
  JevZoneThresholds,
} from "./types";
import { DRIFT_ALARM_LABEL, INSPECT_FIRST_LABEL } from "./vocabulary";

export interface CalibrationPanelProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  metrics: JevCalibrationMetrics;
  /** The primitive decides the headline metric: Brier for noul, RPS for score, classwise ECE for choice. */
  kind: "choice" | "score" | "boolean";
  contract?: JevContractRef;
  segment?: JevCalibrationSegment;
  /** e.g. "rolling 7d · Sep 16 – Sep 23". */
  window?: string;
  alarms?: JevDriftAlarm[];
  recommendation?: JevThresholdRecommendation | null;
  /** Accepting creates a new contract draft (never applies thresholds directly). */
  onAcceptRecommendation?: (r: JevThresholdRecommendation) => void;
  /** Labels for outcome keys in the classwise table. */
  labels?: Record<string, string>;
}

function zonesText(z: JevZoneThresholds | null): string {
  if (!z) return "no auto";
  return `auto ${z.autoAt === null ? "never" : formatProbability(z.autoAt)} · improve ${z.improveAt === null ? "none" : formatProbability(z.improveAt)}`;
}

function nullable(v: number | null, digits = 3): string {
  return v === null ? "—" : formatProbability(v, digits);
}

/**
 * Production calibration of one contract version and segment
 * (JEV_ENGINEERING.md §7): the reliability diagram (decision group's
 * `CalibrationChart`), ECE / Brier / auto-precision tiles, the per-outcome
 * breakdown a global average hides, drift alarms with Table IX's "inspect
 * first", and the threshold recommendation — which is never applied
 * automatically.
 */
export const CalibrationPanel = forwardRef<HTMLDivElement, CalibrationPanelProps>(
  function CalibrationPanel(
    {
      metrics,
      kind,
      contract,
      segment,
      window,
      alarms = [],
      recommendation,
      onAcceptRecommendation,
      labels,
      className,
      ...rest
    },
    ref,
  ) {
    const bins = useMemo(() => toCalibrationBins(metrics.bins), [metrics.bins]);
    const sorted = useMemo(() => sortAlarms(alarms), [alarms]);
    const classwise = metrics.classwise
      ? Object.entries(metrics.classwise).sort((a, b) => b[1].support - a[1].support)
      : [];
    const worst = classwise.reduce<{ key: string; ece: number } | null>((w, [k, c]) => {
      if (c.ece === null) return w;
      return !w || c.ece > w.ece ? { key: k, ece: c.ece } : w;
    }, null);
    const segmentChips: [string, string][] = [];
    if (segment) {
      const pairs: [string, string | null][] = [
        ["env", segment.environment],
        ["class", segment.consequenceClass],
        ["language", segment.language],
        ["outcome", segment.outcome],
        ["model", segment.resolvedModel],
        ["mode", segment.mode],
      ];
      for (const [k, v] of pairs) if (v !== null) segmentChips.push([k, v]);
    }

    return (
      <div ref={ref} className={cn("flex min-w-0 flex-col gap-5", className)} {...rest}>
        <header className="flex flex-wrap items-center gap-2">
          {contract ? <ContractRefChip contract={contract} /> : null}
          {segmentChips.map(([k, v]) => (
            <Badge key={k} tone="outline">
              <span className="text-ink-4">{k}</span> {v}
            </Badge>
          ))}
          {window ? <span className="ml-auto font-mono text-2xs text-ink-4">{window}</span> : null}
        </header>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <section className="flex min-w-0 flex-col gap-2" aria-label="Reliability diagram">
            <BlockTitle
              meta={`${metrics.labeled.toLocaleString("en")} labeled of ${metrics.decisions.toLocaleString("en")}`}
            >
              Reliability
            </BlockTitle>
            <CalibrationChart bins={bins} height={240} />
          </section>
          <section
            className="grid min-w-0 grid-cols-2 content-start gap-2"
            aria-label="Calibration metrics"
          >
            <Stat
              label={`ECE (target ≤ ${formatProbability(ECE_TARGET)})`}
              value={nullable(metrics.ece)}
              hint={`MCE ${nullable(metrics.mce)} · ACE ${nullable(metrics.ace)}`}
              tone={eceTone(metrics.ece)}
            />
            {kind === "boolean" ? (
              <Stat
                label="Brier (raw P(yes))"
                value={nullable(metrics.brier)}
                hint="lower is better"
              />
            ) : kind === "score" ? (
              <Stat label="RPS" value={nullable(metrics.rps)} hint="ranked probability score" />
            ) : (
              <Stat
                label="Worst classwise ECE"
                value={worst ? formatProbability(worst.ece, 3) : "—"}
                hint={worst ? (labels?.[worst.key] ?? worst.key) : "no classwise data"}
                tone={worst ? (worst.ece > ECE_TARGET ? "warn" : "ok") : undefined}
              />
            )}
            <Stat
              label="Auto precision"
              value={metrics.autoPrecision ? formatPercent(metrics.autoPrecision.value, 1) : "—"}
              hint={
                metrics.autoPrecision
                  ? `Wilson 95% ≥ ${formatPercent(metrics.autoPrecision.lower95, 1)} · n=${metrics.autoPrecision.n}`
                  : "no labeled auto receipts"
              }
            />
            <Stat
              label="Accuracy"
              value={metrics.accuracy === null ? "—" : formatPercent(metrics.accuracy, 1)}
              hint={
                metrics.routeCorrectness === null
                  ? "route correctness —"
                  : `route correct ${formatPercent(metrics.routeCorrectness, 1)}`
              }
            />
            <Stat
              label={`Near threshold (±${formatProbability(metrics.nearThreshold.band)})`}
              value={formatPercent(metrics.nearThreshold.above, 1)}
              hint={`above · ${formatPercent(metrics.nearThreshold.below, 1)} below`}
              tone={metrics.nearThreshold.above >= 0.15 ? "warn" : undefined}
            />
            <Stat
              label="Confidence shift (PSI)"
              value={nullable(metrics.psi, 2)}
              hint={`override ${formatPercent(metrics.rates.override, 1)} · escape ${formatPercent(metrics.rates.escape, 1)}`}
              tone={metrics.psi !== null && metrics.psi >= 0.2 ? "warn" : undefined}
            />
          </section>
        </div>

        {classwise.length > 0 ? (
          <section className="flex min-w-0 flex-col gap-2" aria-label="Per outcome">
            <BlockTitle meta="a global average can hide the branch that matters most">
              Per outcome
            </BlockTitle>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] border-collapse text-xs">
                <thead>
                  <tr className="text-left text-2xs text-ink-3">
                    <th scope="col" className="py-1 pr-2 font-medium">
                      Outcome
                    </th>
                    <th scope="col" className="py-1 pr-2 text-right font-medium">
                      Support
                    </th>
                    <th scope="col" className="py-1 pr-2 text-right font-medium">
                      Accuracy
                    </th>
                    <th scope="col" className="py-1 pr-2 text-right font-medium">
                      Mean conf.
                    </th>
                    <th scope="col" className="py-1 text-right font-medium">
                      ECE
                    </th>
                  </tr>
                </thead>
                <tbody className="font-mono tabular">
                  {classwise.map(([k, c]) => (
                    <tr key={k} className="border-t border-border">
                      <th scope="row" className="py-1 pr-2 text-left font-normal text-ink">
                        {labels?.[k] ?? k}
                      </th>
                      <td
                        className={cn(
                          "py-1 pr-2 text-right",
                          c.support < 30 ? "text-warn" : "text-ink-2",
                        )}
                      >
                        {c.support}
                      </td>
                      <td className="py-1 pr-2 text-right text-ink-2">
                        {c.accuracy === null ? "—" : formatPercent(c.accuracy, 1)}
                      </td>
                      <td className="py-1 pr-2 text-right text-ink-2">
                        {nullable(c.meanConfidence, 2)}
                      </td>
                      <td
                        className={cn(
                          "py-1 text-right",
                          c.ece !== null && c.ece > ECE_TARGET ? "text-warn" : "text-ink-2",
                        )}
                      >
                        {nullable(c.ece)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        <div className="grid gap-5 lg:grid-cols-2">
          <section className="flex min-w-0 flex-col gap-2" aria-label="Drift alarms">
            <BlockTitle meta={`${sorted.length} open`}>Drift alarms</BlockTitle>
            {sorted.length === 0 ? (
              <p className="m-0 text-xs text-ok">No drift alarms against the baseline.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {sorted.map((a, i) => (
                  <li
                    key={`${a.kind}-${i}`}
                    role={a.severity === "critical" ? "alert" : undefined}
                    data-severity={a.severity}
                    className={cn(
                      "flex flex-col gap-1 rounded-sm border px-3 py-2",
                      a.severity === "critical"
                        ? "border-danger bg-danger-soft"
                        : a.severity === "warning"
                          ? "border-warn bg-warn-soft"
                          : "border-border bg-surface-2",
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <AlertTriangle
                        className="size-3.5 shrink-0"
                        style={{ color: `var(--${ALARM_TONE[a.severity]})` }}
                        aria-hidden="true"
                      />
                      <span className="text-xs font-medium text-ink">
                        {DRIFT_ALARM_LABEL[a.kind]}
                      </span>
                      <Badge tone={ALARM_TONE[a.severity]}>{a.severity}</Badge>
                      <span className="ml-auto font-mono text-2xs text-ink-3 tabular">
                        {formatProbability(a.value, 3)}
                        {a.baseline !== null ? ` vs ${formatProbability(a.baseline, 3)}` : ""} ·
                        limit {formatProbability(a.threshold, 3)}
                      </span>
                    </div>
                    <p className="m-0 text-xs text-ink-2">{a.message}</p>
                    {a.inspectFirst.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="text-2xs text-ink-4">inspect first</span>
                        {a.inspectFirst.map((x) => (
                          <Badge key={x} tone="outline" size="sm">
                            {INSPECT_FIRST_LABEL[x]}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="flex min-w-0 flex-col gap-2" aria-label="Threshold recommendation">
            <BlockTitle meta={recommendation ? recommendation.consequenceClass : undefined}>
              Recommended threshold
            </BlockTitle>
            {!recommendation ? (
              <p className="m-0 text-xs text-ink-3">
                Not enough labeled receipts for a recommendation.
              </p>
            ) : (
              <div className="flex flex-col gap-2 rounded-sm border border-border bg-surface-2 px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2 font-mono text-xs tabular">
                  <span className="text-ink-3">{zonesText(recommendation.current)}</span>
                  <ArrowRight className="size-3.5 text-ink-4" aria-hidden="true" />
                  <span
                    className={recommendation.recommended ? "font-semibold text-ink" : "text-warn"}
                  >
                    {zonesText(recommendation.recommended)}
                  </span>
                </div>
                <dl className="m-0 grid grid-cols-[120px_1fr] gap-x-2 gap-y-1 text-xs">
                  <dt className="text-ink-3">Target</dt>
                  <dd className="m-0 font-mono text-ink tabular">
                    precision ≥ {formatPercent(recommendation.target.precision, 1)} · n ≥{" "}
                    {recommendation.target.minLabeled} · ECE ≤{" "}
                    {formatProbability(recommendation.target.maxEce)}
                  </dd>
                  <dt className="text-ink-3">Achieved</dt>
                  <dd className="m-0 font-mono text-ink tabular">
                    {recommendation.achieved
                      ? `${formatPercent(recommendation.achieved.precision, 1)} (≥ ${formatPercent(recommendation.achieved.lower95, 1)}) · coverage ${formatPercent(recommendation.achieved.coverage)} · n=${recommendation.achieved.n}`
                      : "—"}
                  </dd>
                  <dt className="text-ink-3">Near threshold</dt>
                  <dd
                    className={cn(
                      "m-0 font-mono tabular",
                      recommendation.nearThresholdMass > 0.15 ? "text-warn" : "text-ink",
                    )}
                  >
                    {formatPercent(recommendation.nearThresholdMass, 1)}
                  </dd>
                  <dt className="text-ink-3">Basis</dt>
                  <dd className="m-0 font-mono text-ink-2 tabular">
                    {recommendation.basis.labeled.toLocaleString("en")} labeled ·{" "}
                    {recommendation.basis.window}
                  </dd>
                </dl>
                {recommendation.warnings.map((w) => (
                  <p key={w} className="m-0 flex items-start gap-1 text-xs text-warn">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                    {w}
                  </p>
                ))}
                <p className="m-0 text-2xs text-ink-4">
                  Never applied automatically: accepting creates a contract draft with governance
                  prefilled, which goes through review and rollout.
                </p>
                {onAcceptRecommendation && recommendation.recommended ? (
                  <Button
                    size="sm"
                    className="self-start"
                    onClick={() => onAcceptRecommendation(recommendation)}
                  >
                    Create draft with these thresholds
                  </Button>
                ) : null}
              </div>
            )}
          </section>
        </div>
      </div>
    );
  },
);
