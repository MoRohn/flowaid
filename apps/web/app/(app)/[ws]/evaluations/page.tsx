"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { FlaskConical, Plus } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  FieldRow,
  Input,
  Select,
  SelectItem,
  Textarea,
} from "@flowaid/ui/primitives";
import { RelativeTime } from "@flowaid/ui/data";
import { formatPercent } from "@flowaid/ui/lib";
import { PageHeader } from "@flowaid/ui/shell";
import { get, post, qs } from "~/api/client";
import type { Page, WorkflowSummary } from "~/api/types";
import { runTone } from "~/admin/logic";
import type { EvaluationRun, EvaluationSet } from "~/admin/types";
import { QueryView, useMutate, useOpenFromQuery } from "~/admin/ui";
import { useSession } from "~/session";
import { AppFrame, PageBody } from "~/shell/AppFrame";
import { HELP } from "~/shell/help";
import { LearnMore } from "~/shell/LearnMore";

const ANY = "__any";

function NewSetDialog({
  open,
  onOpenChange,
  workflows,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  workflows: WorkflowSummary[];
}) {
  const s = useSession();
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [workflowId, setWorkflowId] = useState(ANY);
  const create = useMutate(
    () =>
      post<EvaluationSet>("/v1/evaluations/sets", {
        name: name.trim(),
        description,
        ...(workflowId !== ANY ? { workflowId } : {}),
      }),
    {
      success: (x) => `Created ${x.name}`,
      invalidate: [["evaluation-sets", s.ws]],
      onSuccess: (x) => router.push(`/${s.ws}/evaluations/sets/${x.id}`),
    },
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate(undefined);
          }}
        >
          <DialogHeader>
            <DialogTitle>New evaluation set</DialogTitle>
            <DialogDescription>
              Cases pair an input with what the run must produce: outputs, decisions, branches,
              tools, latency and cost.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <FieldRow label="Name" htmlFor="set-name" required>
              <Input
                id="set-name"
                value={name}
                maxLength={200}
                onChange={(e) => setName(e.target.value)}
                placeholder="Refund routing regression"
              />
            </FieldRow>
            <FieldRow label="Description" htmlFor="set-desc">
              <Textarea
                id="set-desc"
                rows={2}
                maxLength={2000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </FieldRow>
            <FieldRow
              label="Workflow"
              htmlFor="set-wf"
              hint="Tie the set to one workflow, or keep it reusable"
            >
              <Select id="set-wf" value={workflowId} onValueChange={setWorkflowId}>
                <SelectItem value={ANY}>Any workflow</SelectItem>
                {workflows.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </Select>
            </FieldRow>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={create.isPending}
              disabled={!name.trim()}
            >
              Create set
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function EvaluationsPage() {
  const s = useSession();
  const [creating, setCreating] = useOpenFromQuery();
  const canWrite = s.can("evaluations:write");
  const sets = useQuery({
    queryKey: ["evaluation-sets", s.ws],
    queryFn: () => get<EvaluationSet[]>("/v1/evaluations/sets"),
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
              Regression sets that score runs on outputs, decisions and calibration, and gate
              publishing. <LearnMore href={HELP.evaluations} />
            </>
          }
          actions={newButton}
        />
        <div className="mt-4">
          <QueryView query={sets}>
            {(rows) =>
              rows.length === 0 ? (
                <EmptyState
                  icon={<FlaskConical strokeWidth={1.5} />}
                  title="No evaluation sets"
                  description="Create a set, add cases (or add finished runs as cases from the run page), then run it against a version."
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
      {workflows.data ? (
        <NewSetDialog open={creating} onOpenChange={setCreating} workflows={workflows.data} />
      ) : null}
    </AppFrame>
  );
}
