"use client";
/**
 * The workspace dashboard (UI.md §1 `page.tsx`, P6-04): metric tiles with 24-point trends, runs
 * and failures over time, AI cost, decision confidence against the gate, and provider failures,
 * for a time range, workflow and environment.
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Layers, Workflow } from "lucide-react";
import {
  ChartFrame,
  ConfidenceHistogram,
  MetricTile,
  MetricsGrid,
  TIME_RANGE_PRESETS,
  TimeSeriesChart,
  seriesColor,
  type TimeRangePreset,
} from "@flowaid/ui/observability";
import { DEFAULT_CONFIDENCE_THRESHOLDS } from "@flowaid/ui/data";
import {
  EmptyState,
  Select,
  SelectItem,
  ToggleGroup,
  ToggleGroupItem,
} from "@flowaid/ui/primitives";
import { PageHeader } from "@flowaid/ui/shell";
import { get, qs } from "~/api/client";
import type { Environment, Page, WorkflowSummary } from "~/api/types";
import { ErrorPanel } from "~/shell/states";
import {
  carryForward,
  confidenceSamples,
  percent,
  rangeFor,
  type DashboardMetrics,
  type MetricsSeries,
} from "./logic";

const ALL = "__all__";
const RUNS_COLOR = seriesColor(0);
const FAILED_COLOR = "var(--danger)";

export interface DashboardProps {
  ws: string;
  environments: readonly Environment[];
  now?: () => number;
}

export function Dashboard({ ws, environments, now = Date.now }: DashboardProps) {
  const [preset, setPreset] = useState<TimeRangePreset>("24h");
  const [workflowId, setWorkflowId] = useState<string | undefined>();
  const [environmentId, setEnvironmentId] = useState<string | undefined>();
  const { from, to, bucket } = rangeFor(preset, now());
  const filters = qs({ from, to, workflowId, environmentId });

  const workflows = useQuery({
    queryKey: ["workflows", ws, "dashboard"],
    queryFn: () => get<Page<WorkflowSummary>>("/v1/workflows?limit=200"),
  });
  const overview = useQuery({
    queryKey: ["metrics", ws, "overview", filters],
    queryFn: () => get<DashboardMetrics>(`/v1/metrics/overview${filters}`),
    refetchInterval: 60_000,
  });
  const series = useQuery({
    queryKey: ["metrics", ws, "series", filters, bucket],
    queryFn: () => get<MetricsSeries>(`/v1/metrics/timeseries${filters}&bucket=${bucket}`),
    refetchInterval: 60_000,
  });

  const m = overview.data;
  const s = series.data;
  const times = s?.timestamps.map((t) => Date.parse(t)) ?? [];
  const loading = overview.isPending;
  const empty = !loading && m !== undefined && m.runs.total === 0;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Overview" description="How this workspace's workflows are running." />
      <div
        role="group"
        aria-label="Dashboard filters"
        className="flex flex-wrap items-center gap-2"
      >
        <ToggleGroup
          type="single"
          value={preset}
          onValueChange={(v) => {
            const p = TIME_RANGE_PRESETS.find((x) => x.id === v);
            if (p) setPreset(p.id);
          }}
          aria-label="Time range"
        >
          {TIME_RANGE_PRESETS.map((p) => (
            <ToggleGroupItem key={p.id} value={p.id} className="font-mono tabular">
              {p.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Select
          value={workflowId ?? ALL}
          onValueChange={(v) => setWorkflowId(v === ALL ? undefined : v)}
          aria-label="Workflow"
          leading={<Workflow strokeWidth={1.75} />}
          className="w-56"
          contentWidth="auto"
        >
          <SelectItem value={ALL}>All workflows</SelectItem>
          {(workflows.data?.items ?? []).map((w) => (
            <SelectItem key={w.id} value={w.id}>
              {w.name}
            </SelectItem>
          ))}
        </Select>
        <Select
          value={environmentId ?? ALL}
          onValueChange={(v) => setEnvironmentId(v === ALL ? undefined : v)}
          aria-label="Environment"
          leading={<Layers strokeWidth={1.75} />}
          className="w-44"
          contentWidth="auto"
        >
          <SelectItem value={ALL}>All environments</SelectItem>
          {environments.map((e) => (
            <SelectItem key={e.id} value={e.id}>
              {e.name}
            </SelectItem>
          ))}
        </Select>
      </div>

      {overview.isError ? (
        <ErrorPanel error={overview.error} onRetry={() => void overview.refetch()} />
      ) : empty ? (
        <EmptyState
          title="No runs in this range"
          description="Runs appear here as soon as workflows start: from the builder, the API, triggers or evaluations."
        />
      ) : (
        <>
          <MetricsGrid minWidth={180} aria-label="Key metrics">
            <MetricTile
              label="Runs"
              value={m?.runs.total ?? 0}
              unit="count"
              loading={loading}
              {...(s ? { trend: s.series.runs } : {})}
            />
            <MetricTile
              label="Success rate"
              value={percent(m?.successRate ?? null)}
              loading={loading}
              hint={m ? `${m.runs.byStatus.failed ?? 0} failed` : undefined}
            />
            <MetricTile
              label="Latency p95"
              value={m?.latencyMs.p95 ?? "—"}
              unit="ms"
              lowerIsBetter
              loading={loading}
              hint={
                m?.latencyMs.p50 !== null && m
                  ? `p50 ${Math.round(m.latencyMs.p50 ?? 0)} ms`
                  : undefined
              }
              {...(s ? { trend: carryForward(s.series.p95LatencyMs) } : {})}
            />
            <MetricTile
              label="AI cost"
              value={m?.aiCostUsd ?? 0}
              unit="usd"
              lowerIsBetter
              loading={loading}
              {...(s ? { trend: s.series.costUsd } : {})}
            />
            <MetricTile
              label="Human review rate"
              value={percent(m?.humanReviewRate ?? null)}
              loading={loading}
              {...(s ? { trend: s.series.humanReviews } : {})}
            />
            <MetricTile
              label="Retry rate"
              value={percent(m?.retryRate ?? null)}
              lowerIsBetter
              loading={loading}
              hint={
                m?.toolLatencyMs.p95 !== null && m
                  ? `tools p95 ${Math.round(m.toolLatencyMs.p95 ?? 0)} ms`
                  : undefined
              }
            />
          </MetricsGrid>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartFrame
              title="Runs"
              unit={`per ${bucket === "1m" ? "minute" : bucket === "1h" ? "hour" : "day"}`}
              height={220}
              loading={series.isPending}
              empty={!s || s.series.runs.every((v) => v === 0)}
              legend={[
                { id: "runs", label: "Runs", color: RUNS_COLOR },
                { id: "failed", label: "Failed", color: FAILED_COLOR },
              ]}
            >
              {(size) =>
                s && size.width > 0 ? (
                  <TimeSeriesChart
                    timestamps={times}
                    width={size.width}
                    height={size.height}
                    series={[
                      { id: "runs", label: "Runs", values: s.series.runs, color: RUNS_COLOR },
                      {
                        id: "failed",
                        label: "Failed",
                        values: s.series.failed,
                        color: FAILED_COLOR,
                      },
                    ]}
                    unit="count"
                    label="Runs and failures over time"
                  />
                ) : null
              }
            </ChartFrame>
            <ChartFrame
              title="AI cost"
              unit="USD"
              height={220}
              loading={series.isPending}
              empty={!s || s.series.costUsd.every((v) => v === 0)}
            >
              {(size) =>
                s && size.width > 0 ? (
                  <TimeSeriesChart
                    timestamps={times}
                    width={size.width}
                    height={size.height}
                    series={[{ id: "cost", label: "Cost", values: s.series.costUsd }]}
                    unit="usd"
                    area
                    label="AI cost over time"
                  />
                ) : null
              }
            </ChartFrame>
            <ChartFrame
              title="Decision confidence"
              subtitle={
                m?.decisionConfidence.mean !== null && m
                  ? `mean ${(m.decisionConfidence.mean ?? 0).toFixed(2)}`
                  : undefined
              }
              height={220}
              loading={loading}
              empty={!m || m.decisionConfidence.histogram.every((b) => b.count === 0)}
              emptyTitle="No decisions in this range"
            >
              {(size) =>
                m && size.width > 0 ? (
                  <ConfidenceHistogram
                    confidences={confidenceSamples(m.decisionConfidence.histogram)}
                    thresholds={DEFAULT_CONFIDENCE_THRESHOLDS}
                    width={size.width}
                    height={size.height}
                    bins={10}
                    summary
                    label="Decision confidence distribution"
                  />
                ) : null
              }
            </ChartFrame>
            <ChartFrame
              title="Provider failures"
              subtitle="Failovers from one provider to the next"
              height={220}
              loading={loading}
              empty={!m || m.providerFailures.length === 0}
              emptyTitle="No provider failures"
              emptyDescription="Every model and decision call succeeded on its first provider."
            >
              {m ? (
                <ul
                  className="flex flex-col divide-y divide-border text-sm"
                  aria-label="Provider failures"
                >
                  {m.providerFailures.map((f) => (
                    <li
                      key={`${f.provider}|${f.code}`}
                      className="flex items-center justify-between py-2"
                    >
                      <span className="font-mono">{f.provider}</span>
                      <span className="text-ink-3">{f.code}</span>
                      <span className="font-mono tabular">{f.count}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </ChartFrame>
          </div>
        </>
      )}
    </div>
  );
}
