"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo } from "react";
import { FlaskConical, Plus } from "lucide-react";
import { Badge, Button, Card, EmptyState } from "@flowaid/ui/primitives";
import { RelativeTime } from "@flowaid/ui/data";
import { formatPercent } from "@flowaid/ui/lib";
import { PageHeader } from "@flowaid/ui/shell";
import { get, getAll, qs } from "~/api/client";
import type { Page, WorkflowSummary } from "~/api/types";
import { runTone } from "~/admin/logic";
import type { EvaluationRun, EvaluationSet } from "~/admin/types";
import { QueryView, useOpenFromQuery } from "~/admin/ui";
import { NewSetDialog } from "~/evaluations/NewSetDialog";
import { EVALUATIONS } from "~/guide/capabilities/evaluations";
import { PageIntro } from "~/guide/PageIntro";
import type { Check } from "~/guide/Readiness";
import { useSession } from "~/session";
import { AppFrame, PageBody } from "~/shell/AppFrame";
import { HELP } from "~/shell/help";
import { LearnMore } from "~/shell/LearnMore";

export default function EvaluationsPage() {
  const s = useSession();
  const [creating, setCreating] = useOpenFromQuery();
  const canWrite = s.can("evaluations:write");
  const sets = useQuery({
    queryKey: ["evaluation-sets", s.ws],
    queryFn: () => getAll<EvaluationSet>("/v1/evaluations/sets"),
  });
  const runs = useQuery({
    queryKey: ["evaluation-runs", s.ws, "all"],
    queryFn: () => get<Page<EvaluationRun>>(`/v1/evaluations/runs${qs({ limit: 200 })}`),
  });
  const workflows = useQuery({
    queryKey: ["workflow-names", s.ws],
    queryFn: () => get<Page<WorkflowSummary>>("/v1/workflows?limit=200"),
    select: (p) => p.items,
  });
  const latest = useMemo(() => {
    const m = new Map<string, EvaluationRun>();
    for (const r of runs.data?.items ?? []) {
      const cur = m.get(r.setId);
      if (!cur || r.createdAt > cur.createdAt) m.set(r.setId, r);
    }
    return m;
  }, [runs.data]);
  const wfName = (id: string | null) =>
    id ? (workflows.data?.find((w) => w.id === id)?.name ?? "a workflow") : null;
  const checks: Check[] = [
    workflows.isPending
      ? { id: "workflow", label: "A workflow to test", state: "checking" }
      : workflows.data?.length
        ? {
            id: "workflow",
            label: `${workflows.data.length} workflow${workflows.data.length === 1 ? "" : "s"} to test`,
            state: "ok",
          }
        : {
            id: "workflow",
            label: "A workflow to test",
            state: "blocker",
            detail: "A set can be created now, but running it needs a workflow.",
            fix: (
              <Link className="text-accent-text hover:underline" href={`/${s.ws}/workflows`}>
                Create a workflow
              </Link>
            ),
          },
    {
      id: "cost",
      label: "Running a set runs the workflow once per case",
      state: "info",
      detail:
        "Its steps call their models and tools for real, with the keys of the environment you choose. Nothing runs until you press Start evaluation.",
    },
    ...(canWrite
      ? []
      : [
          {
            id: "role",
            label: "Your role can read sets and reports but not create or run them",
            state: "info",
          } satisfies Check,
        ]),
  ];
  const newButton = canWrite ? (
    <Button
      variant="primary"
      leadingIcon={<Plus strokeWidth={1.75} />}
      onClick={() => setCreating(true)}
      disabled={!workflows.data}
    >
      New set
    </Button>
  ) : null;

  return (
    <AppFrame crumbs={[{ label: s.workspaceName }, { label: "Evaluations" }]}>
      <PageBody>
        <PageHeader
          title="Evaluations"
          description={
            <>
              Regression sets that score runs on outputs, decisions and calibration, and can gate
              publishing. <LearnMore href={HELP.evaluations} />
            </>
          }
          actions={newButton}
        />
        <PageIntro
          guide={EVALUATIONS}
          checks={checks}
          defaultCollapsed={(sets.data?.length ?? 0) > 0}
        />
        <div className="mt-4">
          <QueryView query={sets}>
            {(rows) =>
              rows.length === 0 ? (
                <EmptyState
                  icon={<FlaskConical strokeWidth={1.5} />}
                  title="No evaluation sets"
                  description="Create a set, add cases (or add finished runs as cases from the run page), then run it against a version. New set walks through the choices."
                  primaryAction={newButton}
                />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {rows.map((x) => {
                    const run = latest.get(x.id);
                    return (
                      <Card key={x.id} interactive className="relative flex flex-col gap-2 p-4">
                        <Link
                          href={`/${s.ws}/evaluations/sets/${x.id}`}
                          className="font-medium text-ink after:absolute after:inset-0 hover:underline"
                        >
                          {x.name}
                        </Link>
                        {x.description ? (
                          <p className="line-clamp-2 text-xs text-ink-3">{x.description}</p>
                        ) : null}
                        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1 text-2xs text-ink-3">
                          {wfName(x.workflowId) ? (
                            <Badge>{wfName(x.workflowId)}</Badge>
                          ) : (
                            <Badge tone="outline">Any workflow</Badge>
                          )}
                          {run ? (
                            <>
                              <Badge tone={runTone(run.status)} dot className="capitalize">
                                {run.status}
                              </Badge>
                              {run.summary ? (
                                <span className="font-mono text-ink-2">
                                  {formatPercent(run.summary.passRate)} pass
                                </span>
                              ) : null}
                              <span>
                                · <RelativeTime date={run.createdAt} />
                              </span>
                            </>
                          ) : (
                            <span>Never run</span>
                          )}
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )
            }
          </QueryView>
        </div>
      </PageBody>
      {creating && workflows.data ? (
        <NewSetDialog
          open
          onOpenChange={setCreating}
          workflows={workflows.data}
          existingNames={(sets.data ?? []).map((x) => x.name)}
        />
      ) : null}
    </AppFrame>
  );
}
