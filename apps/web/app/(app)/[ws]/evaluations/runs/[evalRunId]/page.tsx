"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useMemo, useState } from "react";
import { Square } from "lucide-react";
import { Badge, Button, ProgressBar, Select, SelectItem } from "@flowaid/ui/primitives";
import { EvaluationReport } from "@flowaid/ui/builder";
import { CalibrationChart, ConfusionMatrix } from "@flowaid/ui/decision";
import { MetricTile, MetricsGrid } from "@flowaid/ui/observability";
import { RelativeTime } from "@flowaid/ui/data";
import type { WorkflowVersionView } from "@flowaid/ui";
import { PageHeader } from "@flowaid/ui/shell";
import { get, getAll, post, qs } from "~/api/client";
import type { Page, VersionSummary } from "~/api/types";
import {
  calibrationNote,
  caseResultViews,
  gateOf,
  runTone,
  summaryMetrics,
  toCalibrationBins,
  versionView,
} from "~/admin/logic";
import type {
  CaseResultRow,
  EvaluationCase,
  EvaluationRun,
  EvaluationSet,
  RegressionReport,
} from "~/admin/types";
import { Notice, QueryView, Section, useMutate } from "~/admin/ui";
import { checksOnlyCompletion, reportReading } from "~/evaluations/logic";
import { confusionByDecision } from "~/evaluations/report";
import { GuidePanel, Tips, toChecks } from "~/evaluations/SetGuide";
import { CheckList } from "~/guide/Readiness";
import { useSession } from "~/session";
import { AppFrame, PageBody } from "~/shell/AppFrame";

const NONE = "__none";
const ACTIVE = new Set(["queued", "running"]);

const vsBase = (previous: number | undefined) =>
  previous === undefined ? {} : { delta: { previous, periodLabel: "vs baseline" } };

function draftView(r: EvaluationRun): WorkflowVersionView {
  return {
    id: `draft:${r.id}`,
    version: 0,
    status: "draft",
    createdAt: r.createdAt,
    message: "Draft",
    nodeCount: 0,
  };
}

export default function EvaluationRunPage({ params }: { params: Promise<{ evalRunId: string }> }) {
  const { evalRunId } = use(params);
  const s = useSession();
  const router = useRouter();
  const [baselineId, setBaselineId] = useState<string | null>(null);
  const run = useQuery({
    queryKey: ["evaluation-run", s.ws, evalRunId],
    queryFn: () => get<EvaluationRun>(`/v1/evaluations/runs/${evalRunId}`),
    refetchInterval: (q) => (q.state.data && ACTIVE.has(q.state.data.status) ? 2000 : false),
  });
  const r = run.data;
  const done = r !== undefined && !ACTIVE.has(r.status);
  const set = useQuery({
    queryKey: ["evaluation-set", s.ws, r?.setId],
    queryFn: () => get<EvaluationSet>(`/v1/evaluations/sets/${r?.setId ?? ""}`),
    enabled: Boolean(r),
  });
  const cases = useQuery({
    queryKey: ["evaluation-cases", s.ws, r?.setId],
    queryFn: () =>
      get<Page<EvaluationCase>>(`/v1/evaluations/sets/${r?.setId ?? ""}/cases?limit=200`),
    enabled: Boolean(r),
  });
  const results = useQuery({
    queryKey: ["evaluation-results", s.ws, evalRunId, r?.completed],
    queryFn: () => get<CaseResultRow[]>(`/v1/evaluations/runs/${evalRunId}/results`),
    enabled: Boolean(r),
  });
  const siblings = useQuery({
    queryKey: ["evaluation-runs", s.ws, r?.setId],
    queryFn: () =>
      get<Page<EvaluationRun>>(`/v1/evaluations/runs${qs({ setId: r?.setId, limit: 50 })}`),
    enabled: Boolean(r),
  });
  const versions = useQuery({
    queryKey: ["versions", s.ws, r?.workflowId],
    queryFn: () => getAll<VersionSummary>(`/v1/workflows/${r?.workflowId ?? ""}/versions`),
    enabled: Boolean(r),
  });
  const chosenBaseline = baselineId ?? r?.baselineEvaluationRunId ?? null;
  const compared = useQuery({
    queryKey: ["evaluation-compare", s.ws, evalRunId, chosenBaseline],
    queryFn: () =>
      get<RegressionReport>(`/v1/evaluations/runs/${evalRunId}/compare/${chosenBaseline ?? ""}`),
    enabled: done && Boolean(chosenBaseline),
  });
  const baselineResults = useQuery({
    queryKey: ["evaluation-results", s.ws, chosenBaseline],
    queryFn: () => get<CaseResultRow[]>(`/v1/evaluations/runs/${chosenBaseline ?? ""}/results`),
    enabled: done && Boolean(chosenBaseline),
  });
  const cancel = useMutate(() => post(`/v1/evaluations/runs/${evalRunId}/cancel`), {
    success: "Cancelling",
    invalidate: [["evaluation-run", s.ws, evalRunId]],
  });

  const report: RegressionReport | null = compared.data ?? r?.report ?? null;
  const summary = report?.summary ?? r?.summary ?? null;
  const baseSummary = report?.baseline ?? null;
  const caseRows = useMemo(() => cases.data?.items ?? [], [cases.data]);
  const versionOf = (vid: string | null): WorkflowVersionView | undefined => {
    const v = versions.data?.find((x) => x.id === vid);
    return v ? versionView(v, [], 0) : undefined;
  };
  const confusion = useMemo(
    () => confusionByDecision(results.data ?? [], caseRows),
    [results.data, caseRows],
  );
  const baselineRun = siblings.data?.items.find((x) => x.id === chosenBaseline);
  const candidate = r ? (versionOf(r.workflowVersionId) ?? draftView(r)) : undefined;
  const base = baselineRun
    ? (versionOf(baselineRun.workflowVersionId) ?? draftView(baselineRun))
    : undefined;
  const flips = report?.flips ?? [];
  const weakCases = useMemo(
    () => new Set(caseRows.filter((c) => checksOnlyCompletion(c.expected)).map((c) => c.id)),
    [caseRows],
  );
  const reading = summary ? reportReading(summary, results.data ?? [], weakCases) : [];
  const caseLabel = (id: string) => {
    const c = caseRows.find((x) => x.id === id);
    return c ? `Case ${c.ordinal + 1}` : id.slice(0, 8);
  };

  return (
    <AppFrame
      crumbs={[
        { label: s.workspaceName },
        { label: "Evaluations", href: `/${s.ws}/evaluations` },
        ...(set.data
          ? [{ label: set.data.name, href: `/${s.ws}/evaluations/sets/${set.data.id}` }]
          : []),
        { label: "Report" },
      ]}
    >
      <PageBody>
        <QueryView query={run}>
          {(x) => (
            <>
              <PageHeader
                title={`${set.data?.name ?? "Evaluation"} · ${candidate && candidate.version ? `v${candidate.version}` : "draft"}`}
                description={
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge tone={runTone(x.status)} dot className="capitalize">
                      {x.status}
                    </Badge>
                    started <RelativeTime date={x.createdAt} />
                    {x.endedAt ? (
                      <>
                        · finished <RelativeTime date={x.endedAt} />
                      </>
                    ) : null}
                    · {x.completed}/{x.total} cases
                  </span>
                }
                actions={
                  ACTIVE.has(x.status) && s.can("evaluations:write") ? (
                    <Button
                      variant="danger"
                      leadingIcon={<Square strokeWidth={1.75} />}
                      loading={cancel.isPending}
                      onClick={() => cancel.mutate(undefined)}
                    >
                      Cancel
                    </Button>
                  ) : (
                    <Button
                      onClick={() => router.push(`/${s.ws}/workflows/${x.workflowId}/versions`)}
                    >
                      Workflow versions
                    </Button>
                  )
                }
              />
              <div className="mt-5 flex flex-col gap-5">
                {ACTIVE.has(x.status) ? (
                  <Section
                    title="Running"
                    description="Cases run as real workflow runs; results appear as they finish."
                  >
                    <ProgressBar
                      value={x.total ? x.completed / x.total : 0}
                      aria-label="Evaluation progress"
                    />
                  </Section>
                ) : null}
                {x.status === "failed" ? (
                  <Notice tone="danger">
                    The evaluation failed before scoring every case. Partial results are shown
                    below.
                  </Notice>
                ) : null}
                {summary ? (
                  <MetricsGrid maxColumns={4}>
                    <MetricTile
                      label="Pass rate"
                      value={summary.passRate}
                      unit="percent"
                      {...vsBase(baseSummary?.passRate)}
                    />
                    <MetricTile
                      label="Latency p95"
                      value={summary.latency.p95}
                      unit="ms"
                      lowerIsBetter
                      {...vsBase(baseSummary?.latency.p95)}
                    />
                    <MetricTile
                      label="Cost per case"
                      value={summary.costUsd.perCase}
                      unit="usd"
                      lowerIsBetter
                      {...vsBase(baseSummary?.costUsd.perCase)}
                    />
                    <MetricTile
                      label="Human review rate"
                      value={summary.humanReviewRate}
                      unit="percent"
                      lowerIsBetter
                      {...vsBase(baseSummary?.humanReviewRate)}
                    />
                  </MetricsGrid>
                ) : null}
                {done && summary ? (
                  <GuidePanel
                    id="evaluation-report"
                    title="How to read this report"
                    defaultOpen={summary.passed < summary.cases}
                  >
                    <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
                      <div className="flex flex-col gap-1.5">
                        <p className="m-0 text-xs font-semibold text-ink">This run</p>
                        <CheckList checks={toChecks(reading)} aria-label="What this report says" />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <p className="m-0 text-xs font-semibold text-ink">Reading it</p>
                        <Tips
                          items={[
                            "A pass means every expectation of the case held; it is only as strict as the case. It does not show the answer is good in ways the case does not check.",
                            "Select a failed case to open its run: the trace shows the step and value behind the failed check.",
                            "Latency and cost are this run's own. Human steps were answered by the evaluation, so waiting time for people is not in them.",
                            report?.gate
                              ? `Gate: this run was held to ${Math.round(report.gate.minPassRate * 100)}% of cases passing. Publishing checks its own gate when you publish.`
                              : "No gate was set for this run. Publishing can require a pass rate on this set; it checks that when you publish.",
                            "Calibration (for Decision steps): ECE is the average gap between stated confidence and how often the decision was right; 0 is perfect. A few cases per step make it noisy.",
                          ]}
                        />
                      </div>
                    </div>
                  </GuidePanel>
                ) : null}
                {done && summary && candidate ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-ink-2">
                      Compare with
                      <Select
                        size="sm"
                        aria-label="Baseline run"
                        value={chosenBaseline ?? NONE}
                        className="w-64"
                        onValueChange={(v) => setBaselineId(v === NONE ? null : v)}
                      >
                        <SelectItem value={NONE}>No baseline</SelectItem>
                        {(siblings.data?.items ?? [])
                          .filter((o) => o.id !== x.id && o.status === "completed")
                          .map((o) => (
                            <SelectItem key={o.id} value={o.id}>
                              {versionOf(o.workflowVersionId)
                                ? `v${versionOf(o.workflowVersionId)?.version}`
                                : "draft"}{" "}
                              · {new Date(o.createdAt).toLocaleString()}
                            </SelectItem>
                          ))}
                      </Select>
                    </div>
                    <EvaluationReport
                      datasetName={set.data?.name ?? "Evaluation set"}
                      candidate={candidate}
                      {...(base ? { base } : {})}
                      metrics={summaryMetrics(summary, baseSummary)}
                      cases={caseResultViews(
                        results.data ?? [],
                        caseRows,
                        chosenBaseline ? (baselineResults.data ?? null) : null,
                      )}
                      gate={gateOf(report)}
                      {...(calibrationNote(summary, baseSummary)
                        ? { calibrationNote: calibrationNote(summary, baseSummary) }
                        : {})}
                      {...(s.can("workflows:publish")
                        ? {
                            onPublish: () =>
                              router.push(
                                x.workflowVersionId
                                  ? `/${s.ws}/workflows/${x.workflowId}/deployments?version=${x.workflowVersionId}`
                                  : `/${s.ws}/workflows/${x.workflowId}`,
                              ),
                          }
                        : {})}
                      onFocusCase={(caseId) => {
                        const res = results.data?.find((c) => c.caseId === caseId);
                        if (res?.runId && s.features.runs)
                          router.push(`/${s.ws}/runs/${res.runId}`);
                      }}
                    />
                    {report?.warnings.length ? (
                      <Notice>
                        {report.warnings.map((w) => (
                          <p key={w.message}>{w.message}</p>
                        ))}
                      </Notice>
                    ) : null}
                    {Object.keys(summary.calibration).length > 0 ? (
                      <Section
                        title="Calibration"
                        description="Predicted confidence against observed accuracy, per Decision step, and per question for a step that asks several (triage.topic). Points on the diagonal are well calibrated; ECE is the average gap (lower is better), and bins with few decisions move a lot between runs."
                      >
                        <div className="grid gap-4 lg:grid-cols-2">
                          {Object.entries(summary.calibration).map(([node, c]) => (
                            <div key={node}>
                              <p className="mb-1 font-mono text-xs text-ink">
                                {node} <span className="text-ink-3">ECE {c.ece.toFixed(3)}</span>
                              </p>
                              <CalibrationChart bins={toCalibrationBins(c.bins)} height={200} />
                            </div>
                          ))}
                        </div>
                      </Section>
                    ) : null}
                    {Object.keys(confusion).length > 0 ? (
                      <Section
                        title="Confusion"
                        description="Expected against actual decision values, per Decision step and per question of a step that asks several."
                      >
                        <div className="grid gap-4 lg:grid-cols-2">
                          {Object.entries(confusion).map(([node, pairs]) => (
                            <ConfusionMatrix key={node} title={node} pairs={pairs} />
                          ))}
                        </div>
                      </Section>
                    ) : null}
                    {flips.length > 0 ? (
                      <Section
                        title={`Flips (${flips.length})`}
                        description="Values that changed between the baseline and this run."
                      >
                        <ul
                          className="flex flex-col divide-y divide-border rounded-md border border-border"
                          role="list"
                        >
                          {flips.map((f) => (
                            <li
                              key={`${f.caseId}:${f.field}`}
                              className="grid grid-cols-[8rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 px-3 py-1.5 text-xs"
                            >
                              <span className="text-ink-2">{caseLabel(f.caseId)}</span>
                              <code className="truncate font-mono text-ink-3">{f.field}</code>
                              <code className="truncate font-mono text-danger-text">
                                {JSON.stringify(f.before)}
                              </code>
                              <code className="truncate font-mono text-ok-text">
                                {JSON.stringify(f.after)}
                              </code>
                            </li>
                          ))}
                        </ul>
                      </Section>
                    ) : null}
                  </>
                ) : null}
                {done && !summary ? (
                  <Notice tone="info">No summary was produced for this run.</Notice>
                ) : null}
                <p className="text-2xs text-ink-3">
                  <Link
                    className="text-accent-text hover:underline"
                    href={`/${s.ws}/evaluations/sets/${x.setId}`}
                  >
                    Back to the set
                  </Link>
                </p>
              </div>
            </>
          )}
        </QueryView>
      </PageBody>
    </AppFrame>
  );
}
