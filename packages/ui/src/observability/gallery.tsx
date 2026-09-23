import { useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  CircleDollarSign,
  Clock,
  Download,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { formatMs } from "@/lib/format";
import { Button, IconButton, ToggleGroup, ToggleGroupItem } from "@/primitives";
import {
  BarChart,
  CalibrationMini,
  ChartFrame,
  ConfidenceHistogram,
  DashboardFilters,
  Heatmap,
  LatencyHistogram,
  Legend,
  MetricTile,
  MetricsGrid,
  ProviderHealthCard,
  Sparkline,
  StackedAreaChart,
  StackedBarChart,
  TimeSeriesChart,
  seriesColor,
  type DashboardFilterState,
  type LegendItem,
} from "./index";
import { buildOverviewSample } from "./sampleData";

// ---------------------------------------------------------------------------
// Gallery scaffolding
// ---------------------------------------------------------------------------

function Section({
  id,
  title,
  caption,
  children,
}: {
  id: string;
  title: string;
  caption?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="flex flex-col gap-4 border-t border-border pt-6 first:border-t-0 first:pt-0"
    >
      <header className="flex flex-col gap-1">
        <h2 className="text-eyebrow">{title}</h2>
        {caption ? <p className="max-w-2xl text-xs text-ink-3">{caption}</p> : null}
      </header>
      {children}
    </section>
  );
}

function Row({
  label,
  children,
  className,
}: {
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      {label ? <p className="text-2xs font-medium text-ink-3">{label}</p> : null}
      <div className={cn("flex flex-wrap items-start gap-3", className)}>{children}</div>
    </div>
  );
}

const WORKFLOWS = [
  { id: "wf_support_triage", name: "Support triage" },
  { id: "wf_refund_review", name: "Refund review" },
  { id: "wf_lead_scoring", name: "Lead scoring" },
];

const THRESHOLDS = { review: 0.7, auto: 0.9 };

// ---------------------------------------------------------------------------
// Gallery
// ---------------------------------------------------------------------------

export default function ObservabilityGallery() {
  const sample = useMemo(() => buildOverviewSample(), []);
  const [filters, setFilters] = useState<DashboardFilterState>({
    range: "7d",
    workflowId: "wf_support_triage",
  });
  const [hiddenRuns, setHiddenRuns] = useState<string[]>([]);
  const [hiddenCost, setHiddenCost] = useState<string[]>([]);
  const [hiddenStatus, setHiddenStatus] = useState<string[]>([]);
  const [latencyScale, setLatencyScale] = useState<"linear" | "log">("log");
  const [barOrientation, setBarOrientation] = useState<"vertical" | "horizontal">("horizontal");

  const toggle = (set: (fn: (prev: string[]) => string[]) => void) => (id: string) =>
    set((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const runsSeries = [
    { id: "runs", label: "Runs", values: sample.runs, color: "var(--ink-2)" },
    { id: "errors", label: "Errors", values: sample.errors, color: "var(--danger)" },
  ];
  const runsLegend: LegendItem[] = runsSeries.map((s) => ({
    id: s.id,
    label: s.label,
    color: s.color,
    shape: "line",
  }));
  const costLegend: LegendItem[] = sample.costByProvider.map((s, i) => ({
    id: s.id,
    label: s.label,
    color: seriesColor(i),
    shape: "rect",
  }));
  const statusLegend: LegendItem[] = sample.runsByStatus.map((s) => ({
    id: s.id,
    label: s.label,
    color: s.color ?? "var(--ink-3)",
    shape: "rect",
  }));

  const nodeLatency = [
    { id: "intent", label: "Intent (choice)", value: 212 },
    { id: "urgency", label: "Urgency (score)", value: 188 },
    { id: "escalation", label: "Escalation (boolean)", value: 164 },
    { id: "router", label: "Router", value: 3 },
    { id: "crm", label: "CRM lookup (HTTP)", value: 342 },
    { id: "reply", label: "Draft reply (generation)", value: 2140 },
    { id: "safety", label: "Safety check (boolean)", value: 176 },
    { id: "gate", label: "Confidence gate", value: 2 },
  ];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 p-6 sm:p-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold tracking-tight">Observability</h1>
        <p className="max-w-2xl text-xs text-ink-3">
          Dashboard metrics and charts for the support-triage workflow. SVG built on d3-scale and
          d3-shape, one y axis per chart, a shared tooltip, keyboard-walkable marks. Series colours
          are fixed category slots; status hues appear only when the series means a state.
        </p>
      </div>

      {/* ---------------------------------------------------------------- */}
      <Section
        id="overview"
        title="Overview dashboard"
        caption="The one filter row above scopes everything below it. Tiles lead with the number; charts carry the shape."
      >
        <DashboardFilters
          value={filters}
          onChange={setFilters}
          workflows={WORKFLOWS}
          trailing={
            <>
              <IconButton label="Refresh">
                <RefreshCw strokeWidth={1.75} />
              </IconButton>
              <Button leadingIcon={<Download strokeWidth={1.75} />}>Export</Button>
            </>
          }
        />
        <MetricsGrid minWidth={156} maxColumns={6}>
          <MetricTile
            label="Runs"
            icon={<Activity strokeWidth={1.75} />}
            value={sample.tiles.runs.value}
            delta={{ previous: sample.tiles.runs.previous, periodLabel: "vs previous 7d" }}
            trend={sample.tiles.runs.trend}
          />
          <MetricTile
            label="Success rate"
            icon={<ShieldCheck strokeWidth={1.75} />}
            unit="percent"
            value={sample.tiles.successRate.value}
            delta={{ previous: sample.tiles.successRate.previous, periodLabel: "vs previous 7d" }}
            trend={sample.tiles.successRate.trend}
            trendDomain={[0.94, 1]}
          />
          <MetricTile
            label="P95 latency"
            icon={<Clock strokeWidth={1.75} />}
            unit="ms"
            value={sample.tiles.p95.value}
            delta={{ previous: sample.tiles.p95.previous, periodLabel: "vs previous 7d" }}
            lowerIsBetter
            trend={sample.tiles.p95.trend}
          />
          <MetricTile
            label="AI cost"
            icon={<CircleDollarSign strokeWidth={1.75} />}
            unit="usd"
            value={sample.tiles.cost.value}
            delta={{ previous: sample.tiles.cost.previous, periodLabel: "vs previous 7d" }}
            lowerIsBetter
            trend={sample.tiles.cost.trend}
          />
          <MetricTile
            label="Human review rate"
            icon={<UserCheck strokeWidth={1.75} />}
            unit="percent"
            value={sample.tiles.reviewRate.value}
            delta={{ previous: sample.tiles.reviewRate.previous, periodLabel: "vs previous 7d" }}
            lowerIsBetter
            trend={sample.tiles.reviewRate.trend}
          />
          <MetricTile
            label="Retry rate"
            icon={<RotateCcw strokeWidth={1.75} />}
            unit="percent"
            value={sample.tiles.retryRate.value}
            delta={{ previous: sample.tiles.retryRate.previous, periodLabel: "vs previous 7d" }}
            lowerIsBetter
            trend={sample.tiles.retryRate.trend}
          />
        </MetricsGrid>

        <div className="grid gap-3 lg:grid-cols-2">
          <ChartFrame
            title="Runs and errors"
            unit="runs / h"
            subtitle="Hourly, last 7 days"
            legend={runsLegend}
            hiddenSeries={hiddenRuns}
            onToggleSeries={toggle(setHiddenRuns)}
            height={220}
          >
            {({ width, height }) => (
              <TimeSeriesChart
                timestamps={sample.hourly}
                series={runsSeries}
                hiddenSeries={hiddenRuns}
                width={width}
                height={height}
                unit="count"
                label="Runs and errors per hour over the last 7 days"
              />
            )}
          </ChartFrame>
          <ChartFrame
            title="AI cost by provider"
            unit="USD / h"
            subtitle="Generation moved from OpenAI to Anthropic on Thursday"
            legend={costLegend}
            hiddenSeries={hiddenCost}
            onToggleSeries={toggle(setHiddenCost)}
            height={220}
          >
            {({ width, height }) => (
              <StackedAreaChart
                timestamps={sample.hourly}
                series={sample.costByProvider}
                hiddenSeries={hiddenCost}
                width={width}
                height={height}
                unit="usd"
                label="AI cost per hour by provider"
              />
            )}
          </ChartFrame>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <ChartFrame
            title="Runs by status"
            unit="runs / day"
            legend={statusLegend}
            hiddenSeries={hiddenStatus}
            onToggleSeries={toggle(setHiddenStatus)}
            height={220}
          >
            {({ width, height }) => (
              <StackedBarChart
                categories={sample.days}
                series={sample.runsByStatus}
                hiddenSeries={hiddenStatus}
                width={width}
                height={height}
                label="Runs by status per day"
              />
            )}
          </ChartFrame>
          <ChartFrame
            title="Run latency"
            unit="ms"
            subtitle={`${sample.latencies.length.toLocaleString("en")} runs · end to end`}
            controls={
              <ToggleGroup
                type="single"
                size="sm"
                value={latencyScale}
                onValueChange={(v) => {
                  if (v === "linear" || v === "log") setLatencyScale(v);
                }}
                aria-label="Latency axis scale"
              >
                <ToggleGroupItem value="linear">Linear</ToggleGroupItem>
                <ToggleGroupItem value="log">Log</ToggleGroupItem>
              </ToggleGroup>
            }
            height={220}
          >
            {({ width, height }) => (
              <LatencyHistogram
                values={sample.latencies}
                width={width}
                height={height}
                log={latencyScale === "log"}
                bins={28}
              />
            )}
          </ChartFrame>
        </div>

        <div className="grid gap-3 lg:grid-cols-[3fr_2fr]">
          <ChartFrame
            title="Decision confidence"
            subtitle="Intent · Urgency · Escalation · Safety, last 7 days"
            unit="gate 0.70 / 0.90"
            height={200}
          >
            {({ width, height }) => (
              <ConfidenceHistogram
                confidences={sample.confidences}
                thresholds={THRESHOLDS}
                width={width}
                height={height}
              />
            )}
          </ChartFrame>
          <ChartFrame title="Runs by hour" subtitle="Weekday × hour, last 7 days" height={168}>
            {({ width }) => (
              <Heatmap
                rows={sample.heatRows}
                columns={sample.heatColumns}
                values={sample.heatValues}
                width={width}
                cellHeight={16}
                formatCell={(r, c) => `${r} ${c}:00`}
              />
            )}
          </ChartFrame>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-2xs font-medium text-ink-3">Provider health</p>
          <MetricsGrid minWidth={240} maxColumns={4}>
            {sample.providers.map((p) => (
              <ProviderHealthCard key={p.id} provider={p} dayLabels={sample.dayLabels30} />
            ))}
          </MetricsGrid>
        </div>
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section
        id="tiles"
        title="MetricTile"
        caption="Delta tone follows direction and lowerIsBetter: a falling P95 is green, a falling success rate is red, a flat value is neutral. Sizes sm / md / lg."
      >
        <MetricsGrid minWidth={200} maxColumns={4}>
          <MetricTile
            size="sm"
            label="Runs"
            value={12840}
            delta={{ previous: 11420, periodLabel: "vs previous 24h" }}
            trend={[410, 520, 610, 590, 640, 705, 690, 720]}
          />
          <MetricTile
            size="sm"
            label="Success rate"
            unit="percent"
            value={0.972}
            delta={{ previous: 0.981, periodLabel: "vs previous 24h" }}
            trend={[0.98, 0.983, 0.979, 0.975, 0.977, 0.971, 0.972]}
            trendDomain={[0.95, 1]}
          />
          <MetricTile
            size="sm"
            label="P95 latency"
            unit="ms"
            value={1310}
            lowerIsBetter
            delta={{ previous: 1480, periodLabel: "vs previous 24h" }}
            trend={[1480, 1420, 1510, 1690, 1390, 1310]}
          />
          <MetricTile
            size="sm"
            label="Retry rate"
            unit="percent"
            value={0.031}
            lowerIsBetter
            delta={{ previous: 0.031, periodLabel: "vs previous 24h" }}
            trend={[0.03, 0.033, 0.031, 0.031, 0.031]}
          />
        </MetricsGrid>
        <MetricsGrid minWidth={240} maxColumns={3}>
          <MetricTile
            size="md"
            label="AI cost"
            unit="usd"
            value={184.21}
            lowerIsBetter
            delta={{ previous: 173.9, periodLabel: "vs previous 7d" }}
            trend={sample.tiles.cost.trend}
          />
          <MetricTile size="md" label="Decisions" value={31_204} hint="4 decision nodes" />
          <MetricTile size="md" label="Queued" value="—" hint="no data in range" />
        </MetricsGrid>
        <MetricsGrid minWidth={280} maxColumns={3}>
          <MetricTile
            size="lg"
            label="Auto-resolved"
            unit="percent"
            value={0.812}
            delta={{ previous: 0.774, periodLabel: "vs previous 30d" }}
            trend={[0.74, 0.76, 0.77, 0.79, 0.78, 0.8, 0.81, 0.812]}
            trendDomain={[0.7, 0.85]}
          />
          <MetricTile size="lg" label="Loading tile" value={0} loading trend={[1, 2, 3]} />
          <MetricTile
            size="lg"
            label="Selected tile"
            value={2_418}
            selected
            onClick={() => undefined}
            delta={{ previous: 2_390, periodLabel: "vs previous 7d" }}
          />
        </MetricsGrid>
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section
        id="sparkline"
        title="Sparkline"
        caption="Shape only, no axes. Graphite by default; line, area, baseline, custom colour, a flat series, and cobalt only for decision data."
      >
        <Row>
          <Sparkline data={[3, 5, 4, 7, 6, 9, 8, 11]} label="Rising trend" />
          <Sparkline data={[3, 5, 4, 7, 6, 9, 8, 11]} area label="Rising trend, area" />
          <Sparkline
            data={[9, 7, 8, 6, 7, 5, 4, 3]}
            baseline={6}
            color="var(--danger)"
            label="Falling below baseline"
          />
          <Sparkline data={[4, 4, 4, 4, 4, 4]} color="var(--ink-3)" label="Flat" />
          <Sparkline
            data={[0.82, 0.86, 0.84, 0.9, 0.88, 0.93]}
            domain={[0, 1]}
            color={seriesColor("decision")}
            label="Mean decision confidence (the explicit decision slot)"
          />
          <Sparkline
            data={[0.2, 0.4, 0.3, 0.9, 0.7, 0.8]}
            curve="linear"
            width={140}
            height={36}
            color="var(--ok)"
            label="Linear curve"
          />
        </Row>
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section
        id="bars"
        title="BarChart"
        caption="Single series, one hue. Bars cap at 24px with a rounded data end; the value sits at the tip. Emphasis: colour the one that matters and grey the rest."
      >
        <Row>
          <ToggleGroup
            type="single"
            size="sm"
            value={barOrientation}
            onValueChange={(v) => {
              if (v === "vertical" || v === "horizontal") setBarOrientation(v);
            }}
            aria-label="Orientation"
          >
            <ToggleGroupItem value="horizontal">Horizontal</ToggleGroupItem>
            <ToggleGroupItem value="vertical">Vertical</ToggleGroupItem>
          </ToggleGroup>
        </Row>
        <div className="grid gap-3 lg:grid-cols-2">
          <ChartFrame
            title="P50 latency by node"
            unit="ms"
            height={barOrientation === "horizontal" ? 240 : 200}
          >
            {({ width, height }) => (
              <BarChart
                data={nodeLatency}
                width={width}
                height={height}
                unit="ms"
                orientation={barOrientation}
                formatValue={formatMs}
                label="P50 latency by node"
              />
            )}
          </ChartFrame>
          <ChartFrame
            title="Runs by workflow"
            unit="runs"
            subtitle="Support triage highlighted"
            height={barOrientation === "horizontal" ? 240 : 200}
          >
            {({ width, height }) => (
              <BarChart
                data={[
                  { id: "triage", label: "Support triage", value: 24_910, color: "var(--ink-2)" },
                  { id: "refund", label: "Refund review", value: 8_120, color: "var(--ink-4)" },
                  { id: "lead", label: "Lead scoring", value: 6_480, color: "var(--ink-4)" },
                  { id: "kyc", label: "KYC check", value: 3_905, color: "var(--ink-4)" },
                  { id: "churn", label: "Churn outreach", value: 1_260, color: "var(--ink-4)" },
                ]}
                width={width}
                height={height}
                orientation={barOrientation}
                label="Runs by workflow"
              />
            )}
          </ChartFrame>
        </div>
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section
        id="calibration"
        title="CalibrationMini"
        caption="Predicted confidence against observed accuracy per bucket. Dots under the diagonal are over-confident; dot size is the bucket's sample size."
      >
        <Row>
          <CalibrationMini points={sample.calibration} ece={0.021} />
          <CalibrationMini
            size={160}
            ece={0.084}
            color="var(--cat-generation)"
            points={[
              { predicted: 0.4, observed: 0.3, count: 40 },
              { predicted: 0.6, observed: 0.44, count: 90 },
              { predicted: 0.8, observed: 0.66, count: 160 },
              { predicted: 0.95, observed: 0.85, count: 300 },
            ]}
          />
        </Row>
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section
        id="legend"
        title="Legend and ChartTooltip"
        caption="Legends mirror the mark shape and are always present for two or more series; with onToggleItem each entry hides its series. The tooltip is shared by every chart."
      >
        <Row>
          <Legend items={runsLegend} />
          <Legend items={costLegend} hiddenIds={["ollama"]} onToggleItem={() => undefined} />
          <Legend
            size="md"
            items={statusLegend.map((l, i) => ({ ...l, value: [7_402, 618, 132, 44][i] }))}
          />
        </Row>
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section
        id="states"
        title="Loading and empty"
        caption="First load shows a skeleton. A refetch keeps the previous render at reduced opacity. Empty offers the next action."
      >
        <div className="grid gap-3 lg:grid-cols-3">
          <ChartFrame title="Runs and errors" unit="runs / h" loading empty height={160} />
          <ChartFrame
            title="Runs and errors"
            unit="runs / h"
            loading
            legend={runsLegend}
            height={160}
          >
            {({ width, height }) => (
              <TimeSeriesChart
                timestamps={sample.hourly.slice(-48)}
                series={runsSeries.map((s) => ({ ...s, values: s.values.slice(-48) }))}
                width={width}
                height={height}
              />
            )}
          </ChartFrame>
          <ChartFrame
            title="Runs and errors"
            unit="runs / h"
            empty
            height={160}
            emptyAction={
              <Button size="sm" variant="primary">
                Widen range
              </Button>
            }
          />
        </div>
      </Section>
    </div>
  );
}
