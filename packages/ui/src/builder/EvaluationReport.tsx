import { forwardRef, useMemo, type HTMLAttributes, type ReactNode } from "react";
import { CircleAlert, CircleCheck, FlaskConical, ShieldBan, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatCost, formatMs } from "@/lib/format";
import { Badge, Button, Panel } from "@/primitives";
import type { EvaluationCaseResultView, EvaluationMetricView, WorkflowVersionView } from "@/types";
import { MetricsDeltaStrip } from "./MetricsDeltaStrip";
import { VersionBadge } from "./VersionCompare";

export type EvaluationGate = "pass" | "warn" | "fail";

export interface EvaluationReportProps extends HTMLAttributes<HTMLDivElement> {
  datasetName: string;
  base?: WorkflowVersionView;
  candidate: WorkflowVersionView;
  metrics: EvaluationMetricView[];
  cases: EvaluationCaseResultView[];
  gate: EvaluationGate;
  /** One line about calibration, e.g. "ECE 0.031 (was 0.052): confidence tracks accuracy within 3 points." */
  calibrationNote?: string;
  onPublish?: () => void;
  onBlock?: () => void;
  onFocusCase?: (caseId: string) => void;
  /** Cap on rows in the per-case table; the rest is summarised. */
  maxRows?: number;
  flush?: boolean;
}

function compact(value: unknown): string {
  if (value === undefined) return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

const GATE: Record<EvaluationGate, { tone: string; icon: ReactNode; title: string }> = {
  pass: {
    tone: "border-ok/30 bg-ok-soft",
    icon: <CircleCheck className="size-4 text-ok-text" strokeWidth={1.75} aria-hidden="true" />,
    title: "Gate passed",
  },
  warn: {
    tone: "border-warn/30 bg-warn-soft",
    icon: <TriangleAlert className="size-4 text-warn-text" strokeWidth={1.75} aria-hidden="true" />,
    title: "Gate passed with regressions",
  },
  fail: {
    tone: "border-danger/30 bg-danger-soft",
    icon: <CircleAlert className="size-4 text-danger-text" strokeWidth={1.75} aria-hidden="true" />,
    title: "Gate failed",
  },
};

/**
 * Dataset evaluation report: metric deltas against the baseline, the
 * regressions with expected vs actual, a per-case table and the publish
 * gate. `gate` decides which actions are offered: pass publishes normally,
 * warn and fail offer "Publish anyway" (danger) next to "Block publish".
 */
export const EvaluationReport = forwardRef<HTMLDivElement, EvaluationReportProps>(
  function EvaluationReport(
    {
      datasetName,
      base,
      candidate,
      metrics,
      cases,
      gate,
      calibrationNote,
      onPublish,
      onBlock,
      onFocusCase,
      maxRows = 50,
      flush = false,
      className,
      ...rest
    },
    ref,
  ) {
    const regressions = useMemo(() => cases.filter((c) => c.regression), [cases]);
    const passed = cases.filter((c) => c.passed).length;
    const rows = cases.slice(0, maxRows);
    const g = GATE[gate];
    const versions = (
      <span className="flex flex-wrap items-center gap-2 text-2xs text-ink-3">
        {base ? (
          <>
            <VersionBadge version={base} />
            <span aria-hidden="true">vs</span>
          </>
        ) : null}
        <VersionBadge version={candidate} />
      </span>
    );

    return (
      <Panel
        ref={ref}
        title={datasetName}
        icon={<FlaskConical strokeWidth={1.75} aria-hidden="true" />}
        meta={`${cases.length} cases`}
        padded={false}
        flush={flush}
        className={cn("[&>footer]:flex-wrap", className)}
        data-gate={gate}
        toolbar={<span className="hidden sm:inline-flex">{versions}</span>}
        footer={
          <>
            <span className="inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
              {g.icon}
              <span className="whitespace-nowrap font-medium text-ink">{g.title}</span>
              <span className="whitespace-nowrap font-mono text-2xs tabular">
                {passed}/{cases.length} passed · {regressions.length}{" "}
                {regressions.length === 1 ? "regression" : "regressions"}
              </span>
            </span>
            <span className="ml-auto flex items-center gap-1.5">
              {gate === "pass" ? (
                <Button size="sm" variant="primary" onClick={onPublish}>
                  Publish
                </Button>
              ) : (
                <>
                  <Button size="sm" variant="danger" onClick={onPublish}>
                    Publish anyway
                  </Button>
                  <Button
                    size="sm"
                    variant={gate === "fail" ? "primary" : "secondary"}
                    onClick={onBlock}
                    leadingIcon={<ShieldBan strokeWidth={1.75} aria-hidden="true" />}
                  >
                    Block publish
                  </Button>
                </>
              )}
            </span>
          </>
        }
        {...rest}
      >
        <div className="flex flex-col gap-4 p-3">
          <div className="sm:hidden">{versions}</div>
          <MetricsDeltaStrip metrics={metrics} />

          {calibrationNote ? (
            <p className={cn("rounded-md border px-3 py-2 text-xs text-ink-2", g.tone)}>
              <span className="font-medium text-ink">Calibration. </span>
              {calibrationNote}
            </p>
          ) : null}

          <section className="flex flex-col gap-2">
            <header className="flex items-center gap-2">
              <h3 className="text-eyebrow">Regressions</h3>
              <span className="font-mono text-2xs text-ink-3 tabular">{regressions.length}</span>
            </header>
            {regressions.length === 0 ? (
              <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-ink-3">
                No case that passed on the baseline fails on the candidate.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {regressions.map((c) => (
                  <li key={c.id} className="rounded-md border border-danger/30 bg-surface">
                    <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
                      <Badge tone="danger" dot>
                        regression
                      </Badge>
                      <button
                        type="button"
                        onClick={() => onFocusCase?.(c.id)}
                        className="line-clamp-2 min-w-0 text-left text-xs font-medium text-ink hover:underline"
                      >
                        {c.name}
                      </button>
                      <span className="ml-auto whitespace-nowrap font-mono text-2xs text-ink-3 tabular">
                        {c.durationMs !== undefined ? formatMs(c.durationMs) : ""}
                        {c.costUsd !== undefined ? ` · ${formatCost(c.costUsd)}` : ""}
                      </span>
                    </div>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-3 py-2 font-mono text-2xs">
                      <dt className="text-ink-3">expected</dt>
                      <dd className="min-w-0 break-words text-ink">{compact(c.expected)}</dd>
                      <dt className="text-ink-3">actual</dt>
                      <dd className="min-w-0 break-words text-danger-text">{compact(c.actual)}</dd>
                      {c.branch ? (
                        <>
                          <dt className="text-ink-3">branch</dt>
                          <dd className="min-w-0 text-ink-2">
                            <span className="text-ink">{c.branch.expected ?? "—"}</span>
                            <span className="mx-1.5 text-ink-3" aria-hidden="true">
                              →
                            </span>
                            <span
                              className={
                                c.branch.expected === c.branch.actual
                                  ? "text-ink"
                                  : "text-danger-text"
                              }
                            >
                              {c.branch.actual ?? "—"}
                            </span>
                          </dd>
                        </>
                      ) : null}
                    </dl>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <header className="flex items-center gap-2">
              <h3 className="text-eyebrow">Cases</h3>
              <span className="font-mono text-2xs text-ink-3 tabular">
                {passed} passed · {cases.length - passed} failed
              </span>
            </header>
            <div className="contain-inline-size overflow-x-auto rounded-md border border-border">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="h-7 border-b border-border bg-surface-2 text-left text-2xs font-medium text-ink-3">
                    <th scope="col" className="w-full pl-3 font-medium">
                      Case
                    </th>
                    <th scope="col" className="whitespace-nowrap pr-3 font-medium">
                      Result
                    </th>
                    <th
                      scope="col"
                      className="hidden whitespace-nowrap pr-3 font-medium sm:table-cell"
                    >
                      Branch
                    </th>
                    <th scope="col" className="whitespace-nowrap pr-3 text-right font-medium">
                      Duration
                    </th>
                    <th
                      scope="col"
                      className="hidden whitespace-nowrap pr-3 text-right font-medium sm:table-cell"
                    >
                      Cost
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((c) => (
                    <tr key={c.id} data-passed={c.passed} className="h-7">
                      <td className="w-full max-w-0 pl-3 pr-3">
                        <button
                          type="button"
                          onClick={() => onFocusCase?.(c.id)}
                          className="block max-w-full truncate text-left text-ink hover:underline"
                        >
                          {c.name}
                        </button>
                      </td>
                      <td className="whitespace-nowrap pr-3">
                        <Badge tone={c.passed ? "ok" : "danger"} size="sm" dot>
                          {c.passed ? "pass" : "fail"}
                        </Badge>
                        {c.regression ? (
                          <span className="ml-1.5 font-mono text-2xs text-danger-text">
                            regression
                          </span>
                        ) : null}
                      </td>
                      <td className="hidden whitespace-nowrap pr-3 font-mono text-2xs text-ink-2 sm:table-cell">
                        {c.branch ? (
                          <>
                            {c.branch.actual ?? "—"}
                            {c.branch.expected !== undefined &&
                            c.branch.expected !== c.branch.actual ? (
                              <span className="text-ink-3"> (expected {c.branch.expected})</span>
                            ) : null}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="whitespace-nowrap pr-3 text-right font-mono text-2xs tabular text-ink-2">
                        {c.durationMs !== undefined ? formatMs(c.durationMs) : "—"}
                      </td>
                      <td className="hidden whitespace-nowrap pr-3 text-right font-mono text-2xs tabular text-ink-2 sm:table-cell">
                        {c.costUsd !== undefined ? formatCost(c.costUsd) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {cases.length > rows.length ? (
                <p className="border-t border-border bg-surface-2 px-3 py-1.5 font-mono text-2xs text-ink-3 tabular">
                  {cases.length - rows.length} more cases not shown
                </p>
              ) : null}
            </div>
          </section>
        </div>
      </Panel>
    );
  },
);
