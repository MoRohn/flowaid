"use client";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, use, useMemo } from "react";
import { Select, SelectItem } from "@flowaid/ui/primitives";
import { VersionCompare } from "@flowaid/ui/builder";
import { DiffView } from "@flowaid/ui/data";
import type { WorkflowDiff } from "@flowaid/ui";
import { get, qs } from "~/api/client";
import type { Deployment, Page, VersionDetail, VersionSummary } from "~/api/types";
import { WorkflowFrame } from "~/admin/WorkflowFrame";
import { summaryMetrics, versionView } from "~/admin/logic";
import type { EvaluationRun } from "~/admin/types";
import { Notice, QueryView, Section, useMembers } from "~/admin/ui";
import { useSession } from "~/session";

/** The latest completed evaluation of a version, if any. */
function latestEvaluation(
  runs: readonly EvaluationRun[],
  versionId: string,
): EvaluationRun | undefined {
  return runs
    .filter((r) => r.workflowVersionId === versionId && r.status === "completed" && r.summary)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

function Compare({ id }: { id: string }) {
  const s = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const a = params.get("a") ?? "";
  const b = params.get("b") ?? "";
  const versions = useQuery({
    queryKey: ["versions", s.ws, id],
    queryFn: () => get<VersionSummary[]>(`/v1/workflows/${id}/versions`),
  });
  const deployments = useQuery({
    queryKey: ["deployments", s.ws, id],
    queryFn: () => get<Deployment[]>(`/v1/workflows/${id}/deployments`),
  });
  const base = useQuery({
    queryKey: ["version", s.ws, a],
    queryFn: () => get<VersionDetail>(`/v1/workflow-versions/${a}`),
    enabled: Boolean(a),
  });
  const cand = useQuery({
    queryKey: ["version", s.ws, b],
    queryFn: () => get<VersionDetail>(`/v1/workflow-versions/${b}`),
    enabled: Boolean(b),
  });
  const diff = useQuery({
    queryKey: ["version-diff", s.ws, a, b],
    queryFn: () => get<WorkflowDiff>(`/v1/workflow-versions/${b}/diff/${a}`),
    enabled: Boolean(a && b && a !== b),
  });
  const evals = useQuery({
    queryKey: ["evaluation-runs", s.ws, id],
    queryFn: () =>
      get<Page<EvaluationRun>>(`/v1/evaluations/runs${qs({ workflowId: id, limit: 200 })}`),
    enabled: s.features.evaluations === true && s.can("evaluations:read"),
  });
  const set = (key: "a" | "b", value: string) => {
    const u = new URLSearchParams(params.toString());
    u.set(key, value);
    router.replace(`/${s.ws}/workflows/${id}/versions/compare?${u.toString()}`);
  };
  const published = (versions.data ?? [])
    .filter((v) => v.kind === "published")
    .sort((x, y) => (y.version ?? 0) - (x.version ?? 0));
  const deployedTo = (vid: string) =>
    (deployments.data ?? [])
      .filter((d) => d.versionId === vid)
      .map((d) => ({
        protected: s.environments.find((e) => e.id === d.environmentId)?.protected ?? false,
      }));

  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of [base.data, cand.data])
      for (const n of v?.definition.nodes ?? []) m.set(n.id, n.name ?? n.id);
    return m;
  }, [base.data, cand.data]);
  const members = useMembers();
  const withAuthor = <T extends { createdBy?: string }>(v: T): T =>
    v.createdBy ? { ...v, createdBy: members.get(v.createdBy) ?? v.createdBy } : v;
  const evalA = evals.data ? latestEvaluation(evals.data.items, a) : undefined;
  const evalB = evals.data ? latestEvaluation(evals.data.items, b) : undefined;
  const metrics = evalB?.summary
    ? summaryMetrics(evalB.summary, evalA?.summary ?? null)
    : undefined;

  const picker = (key: "a" | "b", value: string, label: string) => (
    <label className="flex items-center gap-2 text-xs text-ink-2">
      {label}
      <Select
        aria-label={label}
        size="sm"
        value={value}
        onValueChange={(v) => set(key, v)}
        className="w-28"
        mono
      >
        {published.map((v) => (
          <SelectItem key={v.id} value={v.id}>
            v{v.version}
          </SelectItem>
        ))}
      </Select>
    </label>
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-4">
        {picker("a", a, "Base")}
        <span className="text-ink-3" aria-hidden="true">
          →
        </span>
        {picker("b", b, "Candidate")}
      </div>
      {!a || !b ? (
        <Notice tone="info">Choose two versions to compare.</Notice>
      ) : a === b ? (
        <Notice tone="info">Both sides are the same version.</Notice>
      ) : (
        <QueryView query={diff}>
          {(d) =>
            base.data && cand.data ? (
              <>
                <VersionCompare
                  base={withAuthor(
                    versionView(
                      base.data,
                      deployedTo(base.data.id),
                      base.data.definition.nodes.length,
                    ),
                  )}
                  candidate={withAuthor(
                    versionView(
                      cand.data,
                      deployedTo(cand.data.id),
                      cand.data.definition.nodes.length,
                    ),
                  )}
                  {...(s.can("workflows:publish")
                    ? {
                        onRollback: (v: { id: string }) =>
                          router.push(`/${s.ws}/workflows/${id}/deployments?version=${v.id}`),
                      }
                    : {})}
                  diff={d}
                  nodeName={(nid) => names.get(nid)}
                  {...(metrics ? { metrics } : {})}
                  onOpen={(v) => router.push(`/${s.ws}/workflows/${id}/versions?focus=${v.id}`)}
                  {...(s.can("workflows:publish")
                    ? {
                        onPromote: (v: { id: string }) =>
                          router.push(`/${s.ws}/workflows/${id}/deployments?version=${v.id}`),
                      }
                    : {})}
                />
                {!metrics && s.features.evaluations ? (
                  <Notice tone="info">
                    No completed evaluation of v{cand.data.version} yet: run the workflow's
                    evaluation set on both versions to see metric deltas here.
                  </Notice>
                ) : null}
                <Section
                  title="Definition diff"
                  description="The full JSON definitions, side by side."
                >
                  <DiffView
                    oldValue={base.data.definition}
                    newValue={cand.data.definition}
                    oldLabel={`v${base.data.version}`}
                    newLabel={`v${cand.data.version}`}
                    defaultMode="split"
                    maxHeight={560}
                  />
                </Section>
              </>
            ) : null
          }
        </QueryView>
      )}
    </div>
  );
}

export default function ComparePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <WorkflowFrame id={id} tab="versions">
      {() => (
        <Suspense>
          <Compare id={id} />
        </Suspense>
      )}
    </WorkflowFrame>
  );
}
