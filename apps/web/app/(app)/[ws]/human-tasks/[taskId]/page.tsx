"use client";
/** One human task with its run context: respond, escalate/reassign, or send an external link. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useMemo } from "react";
import { ArrowRight, CircleCheck, Inbox } from "lucide-react";
import { Button, Skeleton, toast } from "@flowaid/ui/primitives";
import { ReviewPage, type EscalationTarget } from "@flowaid/ui/human";
import type { HumanResponse } from "@flowaid/workflow-core";
import { get, post } from "~/api/client";
import { useSession } from "~/session";
import { AppFrame } from "~/shell/AppFrame";
import { ErrorPanel, errorMessage } from "~/shell/states";
import { useCatalog, useMembers, useWorkflowNames } from "~/runs/api";
import { humanizeId, respondedRecord } from "~/runs/humanTasks";
import { ReviewLinks } from "~/runs/ReviewLinks";
import { TaskGuidancePanel } from "~/runs/TaskGuidancePanel";
import type { HumanTask, Page } from "~/api/types";
import type { HumanTaskDetail, RunDetail, VersionDetail } from "~/runs/types";
import { nodeIndex, nodeRunViews, taskToApproval } from "~/runs/views";

const ROLE_TARGETS: EscalationTarget[] = [
  { id: "role:admin", name: "Admins", kind: "team", description: "Everyone with the admin role" },
  { id: "role:owner", name: "Owners", kind: "team", description: "Workspace owners" },
];

const STATUS_NOTE: Record<string, string> = {
  expired: "This task expired before anyone answered; the workflow took its expiry path.",
  cancelled: "The run was cancelled, so this task no longer needs an answer.",
};

export default function HumanTaskPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = use(params);
  const s = useSession();
  const router = useRouter();
  const qc = useQueryClient();

  const detail = useQuery({
    queryKey: ["human-task", s.ws, taskId],
    queryFn: () => get<HumanTaskDetail>(`/v1/human-tasks/${taskId}`),
  });
  const runId = detail.data?.task.runId;
  const run = useQuery({
    queryKey: ["run", s.ws, runId],
    queryFn: () => get<RunDetail>(`/v1/runs/${runId as string}?include=node_runs`),
    enabled: Boolean(runId),
  });
  const version = useQuery({
    queryKey: ["version", s.ws, run.data?.workflowVersionId],
    queryFn: () =>
      get<VersionDetail>(`/v1/workflow-versions/${run.data?.workflowVersionId as string}`),
    enabled: Boolean(run.data?.workflowVersionId),
    staleTime: Infinity,
  });
  // the inbox after this one: where "Next task" leads once this task is answered
  const open = useQuery({
    queryKey: ["human-tasks", s.ws, "open-next"],
    queryFn: () => get<Page<HumanTask>>("/v1/human-tasks?status=open&limit=20"),
  });
  const nextTask = open.data?.items.find((t) => t.id !== taskId);
  const catalog = useCatalog(s.ws);
  const names = useWorkflowNames(s.ws);
  const members = useMembers(s.ws, s.me.principal.workspaceId);

  const nodeRuns = useMemo(
    () =>
      run.data && catalog.data
        ? nodeRunViews(run.data.node_runs, version.data?.definition, catalog.data).filter(
            (n) => n.status !== "pending",
          )
        : [],
    [run.data, catalog.data, version.data],
  );

  const respond = useMutation({
    mutationFn: (response: HumanResponse) =>
      post(`/v1/human-tasks/${taskId}/respond`, { response }),
    onSuccess: (_r, response) => {
      toast.success(
        response.action === "escalate" ? "Task reassigned" : "Response recorded; the run resumes",
      );
      void qc.invalidateQueries({ queryKey: ["human-task", s.ws, taskId] });
      void qc.invalidateQueries({ queryKey: ["human-tasks", s.ws] });
      void qc.invalidateQueries({ queryKey: ["run", s.ws, runId] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const task = detail.data?.task;
  const workflowName = task ? (names.data?.get(task.workflowId) ?? "Workflow") : "";
  const crumbs = [
    { label: s.workspaceName },
    { label: "Human tasks", href: `/${s.ws}/human-tasks` },
    { label: task?.request.title ?? "Task" },
  ];

  let body;
  if (detail.isError)
    body = (
      <ErrorPanel
        error={detail.error}
        onRetry={() => void detail.refetch()}
        back={{ href: `/${s.ws}/human-tasks`, label: "All human tasks" }}
      />
    );
  else if (!task)
    body = (
      <div className="mx-auto flex max-w-[640px] flex-col gap-4 py-10" aria-busy="true">
        <Skeleton className="h-8 w-60" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  else {
    const node = nodeIndex(version.data?.definition).get(task.nodeId);
    const nodeName = node?.name ?? humanizeId(task.nodeId);
    const responded = respondedRecord(task, members.data ?? []);
    const targets: EscalationTarget[] = [
      ...(members.data ?? [])
        .filter((m) => m.userId !== s.me.user?.id)
        .map((m) => ({
          id: m.userId,
          name: m.name || m.email,
          kind: "person" as const,
          description: m.role,
        })),
      ...ROLE_TARGETS,
    ];
    const canAnswer = task.status === "open" && s.can("runs:approve");
    body = (
      <div className="flex flex-col gap-4 pb-10">
        {STATUS_NOTE[task.status] || (task.status === "open" && !s.can("runs:approve")) ? (
          <p
            className="mx-auto mt-6 w-full max-w-[640px] rounded-md border border-border bg-surface-2 px-4 py-3 text-sm text-ink-2"
            role="status"
          >
            {STATUS_NOTE[task.status] ??
              "You can see this task, but answering it needs the approve permission (runs:approve)."}
          </p>
        ) : null}
        {task.status === "responded" ? (
          <div
            role="status"
            className="mx-auto mt-6 flex w-full max-w-[640px] flex-wrap items-center gap-3 rounded-md border border-ok/30 bg-ok-soft px-4 py-3 text-sm text-ink"
          >
            <CircleCheck className="size-4 shrink-0 text-ok-text" strokeWidth={1.75} />
            <span className="min-w-0 flex-1">
              Answered. The run continues from here
              {nextTask ? "; more tasks are waiting." : ", and the inbox is clear."}
            </span>
            <Button asChild variant="ghost" size="sm" leadingIcon={<Inbox strokeWidth={1.75} />}>
              <Link href={`/${s.ws}/human-tasks`}>Inbox</Link>
            </Button>
            {nextTask ? (
              <Button
                asChild
                variant="primary"
                size="sm"
                trailingIcon={<ArrowRight strokeWidth={1.75} />}
              >
                <Link href={`/${s.ws}/human-tasks/${nextTask.id}`}>Next task</Link>
              </Button>
            ) : null}
          </div>
        ) : null}
        <TaskGuidancePanel task={task} node={node} className="mx-auto mt-6 w-full max-w-[640px]" />
        <ReviewPage
          card={{
            request: taskToApproval(task, nodeName, nodeRuns),
            workflowName,
            onRespond: (r) => {
              if (!canAnswer) return;
              return respond.mutateAsync(r).then(() => undefined);
            },
            submitting: respond.isPending,
            ...(responded ? { responded } : {}),
            escalationTargets: targets,
            hotkeys: canAnswer,
          }}
          nodeRuns={nodeRuns}
          runId={task.runId}
          onOpenRun={() => router.push(`/${s.ws}/runs/${task.runId}`)}
          defaultRunOpen
          className="min-h-0"
        />
        {canAnswer && task.request.externalReview ? <ReviewLinks taskId={task.id} /> : null}
      </div>
    );
  }

  return (
    <AppFrame crumbs={crumbs}>
      <div className="h-full overflow-auto">{body}</div>
    </AppFrame>
  );
}
