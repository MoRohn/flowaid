import { forwardRef, useMemo, type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { formatCost, formatMs, formatPercent, formatProbability } from "@/lib/format";
import { Badge } from "@/primitives/Badge";
import { BlockTitle, ContractRefChip, RouteChip, Stat } from "./badges";
import { compareEconomics, matrixCount, summarizeShadowComparisons } from "./shadow";
import type {
  JevContractRef,
  JevPathEconomics,
  JevShadowComparison,
  ProductionSource,
} from "./types";
import { shortHash } from "./vocabulary";

export interface ShadowModeReportProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  comparisons: JevShadowComparison[];
  /** The shadow contract version; read from the first comparison when omitted. */
  contract?: JevContractRef;
  /** e.g. "Aug 1 – Aug 29, 2026". */
  window?: string;
  /** Measured cost and latency of both paths over the same window. */
  economics?: { production: JevPathEconomics; shadow: JevPathEconomics };
  /** Display labels for outcome keys. */
  labels?: Record<string, string>;
  maxDisagreements?: number;
}

const SOURCE_LABEL: Record<ProductionSource, string> = {
  llm: "LLM classifier",
  rule: "rule",
  code: "code",
  human: "human",
  jev: "Jev (active version)",
};

function signedMs(ms: number): string {
  return `${ms > 0 ? "+" : ms < 0 ? "−" : "±"}${formatMs(Math.abs(ms))}`;
}

/**
 * Shadow-mode evidence for a contract version (JEV_ENGINEERING.md §11, §IX.D):
 * agreement with the authoritative path, a production × shadow confusion
 * matrix, accuracy of both sides against human labels, the route mix the
 * shadow would have taken, measured cost and latency, and disagreement
 * samples for labeling. Agreement is not accuracy.
 */
export const ShadowModeReport = forwardRef<HTMLDivElement, ShadowModeReportProps>(
  function ShadowModeReport(
    { comparisons, contract, window, economics, labels, maxDisagreements = 5, className, ...rest },
    ref,
  ) {
    const s = useMemo(() => summarizeShadowComparisons(comparisons), [comparisons]);
    const ref0 = contract ?? comparisons[0]?.contract;
    const source = comparisons[0]?.production.source;
    const label = (k: string) => labels?.[k] ?? k;
    const rowTotals = s.outcomes.map((p) =>
      s.outcomes.reduce((n, sh) => n + matrixCount(s, p, sh), 0),
    );
    const max = Math.max(
      1,
      ...s.outcomes.flatMap((p) => s.outcomes.map((sh) => matrixCount(s, p, sh))),
    );
    const econ = economics ? compareEconomics(economics.production, economics.shadow) : null;

    return (
      <div ref={ref} className={cn("flex min-w-0 flex-col gap-5", className)} {...rest}>
        <header className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="accent">Shadow</Badge>
            {ref0 ? <ContractRefChip contract={ref0} /> : null}
            <span className="text-xs text-ink-3">
              vs production {source ? SOURCE_LABEL[source] : "path"}
            </span>
            {window ? (
              <span className="ml-auto font-mono text-2xs text-ink-4">{window}</span>
            ) : null}
          </div>
          <p className="m-0 text-xs text-ink-3">
            The production path stays authoritative; no shadow answer acted. Agreement is not
            accuracy: the production path can be wrong.
          </p>
        </header>

        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Stat
            label="Agreement"
            value={s.agreementRate === null ? "—" : formatPercent(s.agreementRate, 1)}
            hint={`${s.agreed.toLocaleString("en")} / ${s.comparable.toLocaleString("en")}${s.unmappable ? ` · ${s.unmappable} unmapped` : ""}`}
          />
          <Stat
            label="Shadow accuracy"
            value={s.shadow.rate === null ? "—" : formatPercent(s.shadow.rate, 1)}
            hint={`${s.shadow.labeled} human labels`}
            tone={
              s.shadow.rate !== null && s.production.rate !== null
                ? s.shadow.rate >= s.production.rate
                  ? "ok"
                  : "warn"
                : undefined
            }
          />
          <Stat
            label="Production accuracy"
            value={s.production.rate === null ? "—" : formatPercent(s.production.rate, 1)}
            hint={`${s.production.labeled} human labels`}
          />
          <Stat
            label="Would auto-route"
            value={formatPercent(s.wouldRoute.auto, 1)}
            hint={`improve ${formatPercent(s.wouldRoute.improve)} · human ${formatPercent(s.wouldRoute.human)}`}
          />
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <section className="flex min-w-0 flex-col gap-2" aria-label="Confusion matrix">
            <BlockTitle meta="rows production · columns shadow">Confusion matrix</BlockTitle>
            <div className="overflow-x-auto">
              <table className="border-collapse font-mono text-2xs tabular">
                <thead>
                  <tr>
                    <th scope="col" className="p-1 text-left font-normal text-ink-4">
                      prod ↓ / shadow →
                    </th>
                    {s.outcomes.map((o) => (
                      <th
                        key={o}
                        scope="col"
                        className="max-w-[88px] truncate p-1 text-center font-medium text-ink-2"
                      >
                        {label(o)}
                      </th>
                    ))}
                    <th scope="col" className="p-1 text-right font-normal text-ink-4">
                      n
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {s.outcomes.map((p, i) => (
                    <tr key={p}>
                      <th
                        scope="row"
                        className="max-w-[112px] truncate p-1 text-left font-medium text-ink-2"
                      >
                        {label(p)}
                      </th>
                      {s.outcomes.map((sh) => {
                        const n = matrixCount(s, p, sh);
                        const diag = p === sh;
                        return (
                          <td
                            key={sh}
                            data-diagonal={diag || undefined}
                            aria-label={`production ${p}, shadow ${sh}: ${n}`}
                            className={cn(
                              "h-8 min-w-10 border border-surface p-1 text-center",
                              diag ? "font-semibold text-ink" : n > 0 ? "text-warn" : "text-ink-4",
                            )}
                            style={{
                              backgroundColor:
                                n > 0
                                  ? `color-mix(in srgb, var(--p-1) ${Math.round(8 + 52 * (n / max))}%, transparent)`
                                  : "var(--surface-2)",
                            }}
                          >
                            {n}
                          </td>
                        );
                      })}
                      <td className="p-1 text-right text-ink-3">{rowTotals[i] ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {economics && econ ? (
            <section className="flex min-w-0 flex-col gap-2" aria-label="Cost and latency">
              <BlockTitle meta="measured in this window">Cost and latency</BlockTitle>
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="text-left text-2xs text-ink-3">
                    <th scope="col" className="py-1 pr-2 font-medium">
                      Path
                    </th>
                    <th scope="col" className="py-1 pr-2 text-right font-medium">
                      Cost / decision
                    </th>
                    <th scope="col" className="py-1 pr-2 text-right font-medium">
                      p50
                    </th>
                    <th scope="col" className="py-1 text-right font-medium">
                      p95
                    </th>
                  </tr>
                </thead>
                <tbody className="font-mono tabular">
                  <tr className="border-t border-border">
                    <th
                      scope="row"
                      className="py-1.5 pr-2 text-left font-sans font-normal text-ink-2"
                    >
                      Production {source ? `(${source})` : ""}
                    </th>
                    <td className="py-1.5 pr-2 text-right text-ink">
                      {formatCost(economics.production.costUsdPerDecision)}
                    </td>
                    <td className="py-1.5 pr-2 text-right text-ink">
                      {formatMs(economics.production.p50Ms)}
                    </td>
                    <td className="py-1.5 text-right text-ink">
                      {formatMs(economics.production.p95Ms)}
                    </td>
                  </tr>
                  <tr className="border-t border-border">
                    <th
                      scope="row"
                      className="py-1.5 pr-2 text-left font-sans font-normal text-ink-2"
                    >
                      Jev shadow
                    </th>
                    <td className="py-1.5 pr-2 text-right text-ink">
                      {formatCost(economics.shadow.costUsdPerDecision)}
                    </td>
                    <td className="py-1.5 pr-2 text-right text-ink">
                      {formatMs(economics.shadow.p50Ms)}
                    </td>
                    <td className="py-1.5 text-right text-ink">
                      {formatMs(economics.shadow.p95Ms)}
                    </td>
                  </tr>
                  <tr className="border-t border-border text-2xs">
                    <th
                      scope="row"
                      className="py-1.5 pr-2 text-left font-sans font-normal text-ink-3"
                    >
                      Difference
                    </th>
                    <td
                      className={cn(
                        "py-1.5 pr-2 text-right",
                        econ.costRatio !== null && econ.costRatio < 1 ? "text-ok" : "text-warn",
                      )}
                    >
                      {econ.costRatio === null
                        ? "—"
                        : `${econ.costRatio < 0.01 ? econ.costRatio.toFixed(4) : econ.costRatio.toFixed(2)}×`}
                    </td>
                    <td
                      className={cn(
                        "py-1.5 pr-2 text-right",
                        econ.p50DeltaMs <= 0 ? "text-ok" : "text-warn",
                      )}
                    >
                      {signedMs(econ.p50DeltaMs)}
                    </td>
                    <td
                      className={cn(
                        "py-1.5 text-right",
                        econ.p95DeltaMs <= 0 ? "text-ok" : "text-warn",
                      )}
                    >
                      {signedMs(econ.p95DeltaMs)}
                    </td>
                  </tr>
                </tbody>
              </table>
              <p className="m-0 text-2xs text-ink-4">
                {economics.shadow.decisions.toLocaleString("en")} shadow and{" "}
                {economics.production.decisions.toLocaleString("en")} production decisions. Per-call
                price is one component: a rollout completes on end-to-end task outcomes, not
                classifier agreement.
              </p>
            </section>
          ) : null}
        </div>

        <section className="flex min-w-0 flex-col gap-2" aria-label="Disagreements">
          <BlockTitle meta={`${s.disagreements.length} total · oversampled for labeling`}>
            Disagreements
          </BlockTitle>
          {s.disagreements.length === 0 ? (
            <p className="m-0 text-xs text-ink-3">No disagreements in this window.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col divide-y divide-border rounded-sm border border-border p-0">
              {s.disagreements.slice(0, maxDisagreements).map((c) => {
                const right =
                  c.humanLabel === null
                    ? null
                    : c.humanLabel === c.shadow.outcome
                      ? "shadow"
                      : c.humanLabel === c.production.answer
                        ? "production"
                        : "neither";
                return (
                  <li
                    key={c.id}
                    className="grid gap-2 px-3 py-2 text-xs sm:grid-cols-[1fr_1fr_auto]"
                    data-right={right ?? undefined}
                  >
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-2xs text-ink-4">production</span>
                      <span className="font-mono text-ink">
                        {c.production.answer === null ? "unmapped" : label(c.production.answer)}
                        {c.production.confidence !== null ? (
                          <span className="text-ink-3">
                            {" "}
                            {formatProbability(c.production.confidence)}
                          </span>
                        ) : null}
                      </span>
                    </div>
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-2xs text-ink-4">shadow</span>
                      <span className="flex items-center gap-1.5 font-mono text-ink">
                        {label(c.shadow.outcome)}{" "}
                        <span className="text-ink-3">{formatProbability(c.shadow.confidence)}</span>
                        <RouteChip route={c.shadow.wouldRoute} />
                      </span>
                    </div>
                    <div className="flex flex-col items-start gap-0.5 sm:items-end">
                      {c.humanLabel === null ? (
                        <Badge tone="outline">unlabeled</Badge>
                      ) : (
                        <Badge
                          tone={
                            right === "shadow" ? "ok" : right === "production" ? "warn" : "neutral"
                          }
                        >
                          label {label(c.humanLabel)} ·{" "}
                          {right === "neither" ? "both wrong" : `${right} right`}
                        </Badge>
                      )}
                      <span className="font-mono text-2xs text-ink-4">
                        state #{shortHash(c.stateHash)} · {c.jevModel}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    );
  },
);
