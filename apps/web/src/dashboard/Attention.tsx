"use client";
/**
 * The top of the Overview (FLOWAID_V2_ROADMAP 3.2): "Needs attention" (open approvals, workflows
 * with failed runs) and "What changed" (significant regressions from `GET /v1/insights`), each
 * row a link to where a person acts, each insight with the evidence it rests on.
 */
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ChevronRight, Hourglass, TriangleAlert } from "lucide-react";
import { Badge, Panel, Skeleton } from "@flowaid/ui/primitives";
import { get, qs } from "~/api/client";
import {
  ago,
  evidenceLines,
  isInsightsReport,
  runsHref,
  type Insight,
  type InsightWindow,
  type InsightsReport,
} from "./insights";

const SEVERITY_TONE = { critical: "danger", warning: "warn", info: "info" } as const;
const SEVERITY_LABEL = { critical: "Critical", warning: "Warning", info: "Notice" } as const;
const BASELINE_LABEL: Record<InsightWindow, string> = {
  "24h": "the 4 days before",
  "7d": "the 4 weeks before",
  "30d": "the 4 months before",
};
const WINDOW_LABEL: Record<InsightWindow, string> = {
  "24h": "the last 24 hours",
  "7d": "the last 7 days",
  "30d": "the last 30 days",
};

export interface AttentionProps {
  ws: string;
  window: InsightWindow;
  workflowId?: string | undefined;
  environmentId?: string | undefined;
  now?: () => number;
}

export function Attention({
  ws,
  window,
  workflowId,
  environmentId,
  now = Date.now,
}: AttentionProps) {
  const q = useQuery({
    queryKey: ["insights", ws, window, workflowId, environmentId],
    queryFn: () => get<InsightsReport>(`/v1/insights${qs({ window, workflowId, environmentId })}`),
    refetchInterval: 60_000,
  });
  // Insights are an addition to the Overview: when they cannot load, the metrics still show.
  if (q.isError || (q.data !== undefined && !isInsightsReport(q.data))) return null;
  const r = q.data;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <NeedsAttention ws={ws} report={r} window={window} now={now()} />
      <WhatChanged ws={ws} report={r} window={window} now={now()} />
    </div>
  );
}

function NeedsAttention({
  ws,
  report,
  window,
  now,
}: {
  ws: string;
  report: InsightsReport | undefined;
  window: InsightWindow;
  now: number;
}) {
  const a = report?.attention;
  const empty = a !== undefined && a.openApprovals.count === 0 && a.failingWorkflows.length === 0;
  return (
    <Panel title="Needs attention" scroll={false} padded={false} aria-busy={!report}>
      {!a ? (
        <RowSkeletons />
      ) : empty ? (
        <p className="flex items-center gap-2 px-3 py-4 text-sm text-ink-2">
          <CheckCircle2 className="size-4 text-ok" strokeWidth={1.75} aria-hidden />
          Nothing is waiting for you, and no runs failed in {WINDOW_LABEL[window]}.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border" aria-label="Needs attention">
          {a.openApprovals.count > 0 ? (
            <Row
              href={`/${ws}/human-tasks`}
              icon={<Hourglass className="size-4 text-warn" strokeWidth={1.75} aria-hidden />}
              title={`${a.openApprovals.count} ${a.openApprovals.count === 1 ? "approval is" : "approvals are"} waiting`}
              detail={[
                a.openApprovals.oldestAt ? `oldest ${ago(a.openApprovals.oldestAt, now)}` : null,
                a.openApprovals.expiringSoon > 0
                  ? `${a.openApprovals.expiringSoon} ${a.openApprovals.expiringSoon === 1 ? "expires" : "expire"} within a day`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            />
          ) : null}
          {a.failingWorkflows.map((w) => (
            <Row
              key={w.workflowId}
              href={runsHref(ws, w.workflowId, report.window, true)}
              icon={<TriangleAlert className="size-4 text-danger" strokeWidth={1.75} aria-hidden />}
              title={w.workflowName}
              detail={`${w.failed} of ${w.finished} finished runs failed in ${WINDOW_LABEL[window]}`}
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function WhatChanged({
  ws,
  report,
  window,
  now,
}: {
  ws: string;
  report: InsightsReport | undefined;
  window: InsightWindow;
  now: number;
}) {
  return (
    <Panel title="What changed" scroll={false} padded={false} aria-busy={!report}>
      {!report ? (
        <RowSkeletons />
      ) : report.insights.length === 0 ? (
        <p className="px-3 py-4 text-sm text-ink-2">
          No significant change in failure rate, latency, cost or decision confidence. Changes are
          reported only when they are both statistically significant and large enough to matter.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border" aria-label="What changed">
          {report.insights.map((i) => (
            <InsightRow key={i.id} ws={ws} insight={i} window={report.window} />
          ))}
        </ul>
      )}
      {report ? (
        <p className="border-t border-border px-3 py-2 text-2xs text-ink-3">
          {WINDOW_LABEL[window].replace(/^the l/, "L")} against {BASELINE_LABEL[window]} ·
          production runs only · computed {ago(report.computedAt, now)}
        </p>
      ) : null}
    </Panel>
  );
}

function InsightRow({
  ws,
  insight: i,
  window,
}: {
  ws: string;
  insight: Insight;
  window: { from: string; to: string };
}) {
  return (
    <li className="flex flex-col gap-1.5 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={SEVERITY_TONE[i.severity]}>{SEVERITY_LABEL[i.severity]}</Badge>
        <span className="text-sm font-medium text-ink">{i.title}</span>
      </div>
      <p className="text-sm text-ink-2">{i.summary}</p>
      {i.attribution ? (
        <p className="text-xs text-ink-3">
          {i.attribution.version !== null
            ? `Version ${i.attribution.version}`
            : "A version new to this window"}{" "}
          ran {Math.round(i.attribution.share * 100)}% of the recent runs and none before. It
          coincides with the change; it is not proven to cause it.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <Link
          className="text-accent-text underline-offset-2 hover:underline focus-visible:underline"
          href={runsHref(
            ws,
            i.workflowId,
            window,
            i.kind === "failure_rate" || i.kind === "new_error",
          )}
        >
          View runs
        </Link>
        {i.attribution ? (
          <Link
            className="text-accent-text underline-offset-2 hover:underline focus-visible:underline"
            href={`/${ws}/workflows/${i.workflowId}/versions`}
          >
            Versions
          </Link>
        ) : null}
        <details className="group text-ink-3">
          <summary className="cursor-pointer select-none rounded-xs hover:text-ink-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
            Evidence
          </summary>
          <ul className="mt-1 flex flex-col gap-0.5 font-mono text-2xs tabular">
            {evidenceLines(i.evidence).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>
      </div>
    </li>
  );
}

function Row({
  href,
  icon,
  title,
  detail,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none"
      >
        {icon}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium text-ink">{title}</span>
          {detail ? <span className="text-xs text-ink-3">{detail}</span> : null}
        </span>
        <ChevronRight className="size-4 shrink-0 text-ink-3" strokeWidth={1.75} aria-hidden />
      </Link>
    </li>
  );
}

function RowSkeletons() {
  return (
    <div className="flex flex-col gap-2 p-3">
      <Skeleton className="h-9" />
      <Skeleton className="h-9" />
    </div>
  );
}
