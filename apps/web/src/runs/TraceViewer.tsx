"use client";
/**
 * The trace viewer (UI.md §7): RunHeader, then Timeline · Graph · Events · Output · Logs · Cost
 * over one folded RunView, with node selection shared by every tab and a node-run detail panel.
 * The initial state is the stored run (node runs + every durable event); while the run is
 * active, new events arrive over the SSE stream (or by polling while it waits; `useRunStream`)
 * and the fold re-derives the view.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { FlaskConical, WifiOff } from "lucide-react";
import type { NodeRunView, RunView } from "@flowaid/ui";
import type { WorkflowDefinition } from "@flowaid/workflow-core";
import {
  Button,
  EmptyState,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from "@flowaid/ui/primitives";
import { JsonView } from "@flowaid/ui/data";
import { EventLog, LogViewer, RunHeader, TraceTimeline } from "@flowaid/ui/trace";
import { get, getAll, post } from "~/api/client";
import type { VersionSummary } from "~/api/types";
import { RUN_DETAIL } from "~/guide/capabilities/runs";
import { explainRun } from "~/guide/explain";
import { PageIntro } from "~/guide/PageIntro";
import { useGuideContext } from "~/guide/GuideProvider";
import { useSession } from "~/session";
import { ErrorPanel, errorMessage } from "~/shell/states";
import { AddToEvaluationDialog } from "./AddToEvaluationDialog";
import { fetchAllEvents, useCatalog, useWorkflowNames } from "./api";
import { CostPanel } from "./CostPanel";
import { nodeCategory } from "./graph";
import { NodeRunAside } from "./NodeRunAside";
import { NodeRunPanel } from "./NodeRunPanel";
import { RunActionDialog, type RunAction, type RunActionRequest } from "./RunActionDialog";
import { RunGraph } from "./RunGraph";
import type { HumanTaskDetail, RunDetail, VersionDetail } from "./types";
import { useRunStream } from "./useRunStream";
import {
  durableEvents,
  environmentView,
  isActiveRun,
  lastDurableSeq,
  mergeEvents,
  nodeIndex,
  runCancelReason,
  runTimeoutMs,
  taskToApproval,
  toLiveRunView,
} from "./views";

const TABS = ["timeline", "graph", "events", "output", "logs", "cost"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = {
  timeline: "Timeline",
  graph: "Graph",
  events: "Events",
  output: "Output",
  logs: "Logs",
  cost: "Cost",
};

export function TraceViewer({ runId }: { runId: string }) {
  const s = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("timeline");
  const [selected, setSelected] = useState<string | undefined>();
  const [live, setLive] = useState<unknown[]>([]);
  const [evalOpen, setEvalOpen] = useState(false);
  const [action, setAction] = useState<RunAction | null>(null);

  const detail = useQuery({
    queryKey: ["run", s.ws, runId],
    queryFn: () => get<RunDetail>(`/v1/runs/${runId}?include=node_runs`),
  });
  const events = useQuery({
    queryKey: ["run-events", s.ws, runId],
    queryFn: ({ signal }) => fetchAllEvents(runId, signal),
    staleTime: Infinity,
  });
  const versionId = detail.data?.workflowVersionId;
  const version = useQuery({
    queryKey: ["version", s.ws, versionId],
    queryFn: () => get<VersionDetail>(`/v1/workflow-versions/${versionId as string}`),
    enabled: Boolean(versionId),
    staleTime: Infinity,
  });
  const workflowId = detail.data?.workflowId;
  const published = useQuery({
    queryKey: ["versions", s.ws, workflowId],
    queryFn: () => getAll<VersionSummary>(`/v1/workflows/${workflowId as string}/versions`),
    enabled: Boolean(workflowId),
    staleTime: 60_000,
  });
  const catalog = useCatalog(s.ws);
  const names = useWorkflowNames(s.ws);

  const allEvents = useMemo(() => mergeEvents(events.data ?? [], live), [events.data, live]);
  const definition = version.data?.definition;
  const cat = catalog.data;

  const live0 = useMemo(() => {
    if (!detail.data || !cat) return null;
    const env = environmentView(s.environments, detail.data.environmentId);
    return toLiveRunView({
      run: detail.data,
      nodeRuns: detail.data.node_runs,
      events: allEvents,
      ...(definition ? { definition } : {}),
      catalog: cat,
      workflowName: names.data?.get(detail.data.workflowId) ?? "Workflow",
      version: version.data
        ? version.data.kind === "draft" || version.data.version === null
          ? "draft"
          : version.data.version
        : "draft",
      ...(env ? { environment: env } : {}),
    });
  }, [detail.data, cat, allEvents, definition, names.data, version.data, s.environments]);

  // Streams while the run moves and the tab is visible; polls while it waits for a person.
  const stream = useRunStream(runId, {
    enabled: events.isSuccess,
    status: live0?.view.status,
    afterSeq: lastDurableSeq(allEvents),
    onEvents: (batch) => setLive((l) => [...l, ...batch]),
    // the stream ended or a poll found events: reload the stored run for inputs and outputs
    onSettled: () => void qc.invalidateQueries({ queryKey: ["run", s.ws, runId] }),
  });

  const openTaskId = live0 ? Object.values(live0.folded.openHumanTasks)[0] : undefined;
  const task = useQuery({
    queryKey: ["human-task", s.ws, openTaskId],
    queryFn: () => get<HumanTaskDetail>(`/v1/human-tasks/${openTaskId as string}`),
    enabled: Boolean(openTaskId),
  });

  const cancel = useMutation({
    mutationFn: (body: Record<string, unknown>) => post(`/v1/runs/${runId}/cancel`, body),
    onSuccess: () => toast.success("Cancel requested; running nodes finish their current step"),
    onError: (e) => toast.error(errorMessage(e)),
  });
  // Replay, fork and restart open the new run; retry-node reopens this one in place; cancel
  // (confirmed in the same dialog) stops this one.
  const runAction = async ({ path, body }: RunActionRequest) => {
    if (path.endsWith("/cancel")) {
      await cancel.mutateAsync(body ?? {});
      return;
    }
    try {
      const r = await post<{ run_id: string; status?: string }>(path, body ?? {});
      if (r.run_id === runId) {
        toast.success("Retrying the node; the run continues from its result");
        setLive([]);
        await Promise.all([
          qc.invalidateQueries({ queryKey: ["run", s.ws, runId] }),
          qc.invalidateQueries({ queryKey: ["run-events", s.ws, runId] }),
        ]);
      } else router.push(`/${s.ws}/runs/${r.run_id}`);
    } catch (e) {
      toast.error(errorMessage(e));
      throw e;
    }
  };

  if (detail.isError)
    return (
      <ErrorPanel
        error={detail.error}
        onRetry={() => void detail.refetch()}
        back={{ href: `/${s.ws}/runs`, label: "All runs" }}
      />
    );
  if (events.isError)
    return <ErrorPanel error={events.error} onRetry={() => void events.refetch()} />;
  if (!live0) return <TraceSkeleton />;

  const run = { ...live0.view };
  if (task.data && openTaskId) {
    const node = nodeIndex(definition).get(task.data.task.nodeId);
    run.pendingApproval = taskToApproval(
      task.data.task,
      node?.name ?? task.data.task.nodeId,
      run.nodeRuns,
    );
  }
  const isLive = isActiveRun(run.status);
  const timeoutMs = run.status === "timed_out" ? runTimeoutMs(allEvents) : undefined;
  const cancelReason = run.status === "cancelled" ? runCancelReason(allEvents) : undefined;
  const byId = new Map(run.nodeRuns.map((n) => [n.id, n]));
  const current = selected ? byId.get(selected) : undefined;
  const attempts = current
    ? run.nodeRuns
        .filter((n) => n.nodeId === current.nodeId && (n.scope ?? "") === (current.scope ?? ""))
        .sort((a, b) => a.attempt - b.attempt)
    : [];
  const selectNodeId = (nodeId: string) => {
    const latest = [...run.nodeRuns].reverse().find((n) => n.nodeId === nodeId);
    setSelected(latest?.id);
  };
  const defs = nodeIndex(definition);
  const nodeInfo = Object.fromEntries(
    [...defs.values()].map((n) => [
      n.id,
      { name: n.name, category: nodeCategory(n, cat ?? new Map()) },
    ]),
  );
  const nodeNames = Object.fromEntries([...defs.values()].map((n) => [n.id, n.name]));
  const logs = run.nodeRuns.flatMap((n) => n.logs ?? []).sort((a, b) => a.at.localeCompare(b.at));
  const streamed = current ? live0.folded.streams[current.id] : undefined;

  const canReplay = s.can("runs:replay");
  const panel = current ? (
    <NodeRunAside label={`Node run ${current.nodeName}`} onClose={() => setSelected(undefined)}>
      <NodeRunPanel
        nodeRun={current}
        attempts={attempts}
        {...(streamed ? { streamed } : {})}
        partial={stream.resumed && current.status === "running"}
        onClose={() => setSelected(undefined)}
        {...(canReplay && !isLive && current.status !== "running"
          ? {
              onRestart: () =>
                setAction({
                  kind: "restart",
                  nodeId: current.nodeId,
                  nodeName: current.nodeName,
                  ...(current.scope ? { scope: current.scope } : {}),
                }),
            }
          : {})}
        {...(canReplay && run.status === "failed" && current.status === "failed" && !current.scope
          ? {
              onRetry: () =>
                setAction({ kind: "retry", nodeRunId: current.id, nodeName: current.nodeName }),
            }
          : {})}
      />
    </NodeRunAside>
  ) : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-3 border-b border-border px-6 py-4">
        <RunHeader
          run={run}
          {...(isLive && s.can("runs:cancel")
            ? {
                onCancel: () =>
                  setAction({
                    kind: "cancel",
                    ...(run.pendingApproval ? { waitingFor: run.pendingApproval.nodeName } : {}),
                  }),
              }
            : {})}
          {...(canReplay
            ? {
                onReplay: () => setAction({ kind: "replay" }),
                onFork: () =>
                  setAction({
                    kind: "fork",
                    versionId: version.data?.kind === "draft" ? null : (versionId ?? null),
                    input: run.input,
                    versions: (published.data ?? [])
                      .filter((v) => v.kind === "published" && v.version !== null)
                      .map((v) => ({ id: v.id, version: v.version as number }))
                      .sort((a, b) => b.version - a.version),
                  }),
              }
            : {})}
          onOpenInBuilder={() => router.push(`/${s.ws}/workflows/${run.workflowId}`)}
          onShowFailedNode={(n: NodeRunView) => {
            setTab("timeline");
            setSelected(n.id);
          }}
          {...(canReplay && run.status === "failed"
            ? {
                onRetryFailedNode: (n: NodeRunView) => {
                  // a node inside a loop retries from its own panel (the scope decides which)
                  if (n.scope) setSelected(n.id);
                  else setAction({ kind: "retry", nodeRunId: n.id, nodeName: n.nodeName });
                },
              }
            : {})}
          {...(openTaskId
            ? { onOpenReview: () => router.push(`/${s.ws}/human-tasks/${openTaskId}`) }
            : {})}
          cancelling={cancel.isPending}
          {...(timeoutMs !== undefined ? { timeoutMs } : {})}
          onOpenSettings={() => router.push(`/${s.ws}/workflows/${run.workflowId}`)}
          actions={
            s.features.evaluations && s.can("evaluations:write") && !isLive ? (
              <Button
                variant="secondary"
                size="sm"
                leadingIcon={<FlaskConical strokeWidth={1.75} />}
                onClick={() => setEvalOpen(true)}
              >
                Add to evaluation
              </Button>
            ) : undefined
          }
        />
        <RunStory
          run={run}
          {...(definition ? { definition } : {})}
          {...(timeoutMs !== undefined ? { timeoutMs } : {})}
          {...(cancelReason ? { cancelReason } : {})}
        />
        <PageIntro guide={RUN_DETAIL} defaultCollapsed className="" />
        {isLive && (stream.fallback || stream.pollError) ? (
          <p className="flex flex-wrap items-center gap-2 text-xs text-warn-text" role="status">
            <WifiOff className="size-3.5" strokeWidth={1.75} />
            {stream.pollError
              ? `Can't reach FlowAId (${stream.pollError}). Trying again every 10 seconds.`
              : "Live updates interrupted. This page checks for changes every 10 seconds."}
            <Button variant="secondary" size="sm" onClick={stream.reconnect}>
              Reconnect
            </Button>
          </p>
        ) : isLive && stream.mode === "stream" && stream.status === "reconnecting" ? (
          <p className="flex items-center gap-2 text-xs text-warn-text" role="status">
            <WifiOff className="size-3.5" strokeWidth={1.75} />
            {`Live updates interrupted, reconnecting (attempt ${stream.attempt} of 5)…`}
          </p>
        ) : stream.resumed && isLive ? (
          <p className="text-xs text-ink-3" role="status">
            Stream resumed, partial text unavailable for nodes that were generating.
          </p>
        ) : null}
      </div>
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as Tab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList className="px-6">
          {TABS.map((t) => (
            <TabsTrigger key={t} value={t}>
              {TAB_LABEL[t]}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="timeline" className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1 p-4">
            <TraceTimeline
              run={run}
              live={isLive}
              {...(selected ? { selectedNodeRunId: selected } : {})}
              onSelectNode={(n: NodeRunView) => setSelected(n.id)}
              className="h-full"
            />
          </div>
          {panel}
        </TabsContent>
        <TabsContent value="graph" className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1">
            {definition && cat ? (
              <RunGraph
                definition={definition}
                {...(version.data?.plan ? { plan: version.data.plan } : {})}
                catalog={cat}
                run={run}
                follow={isLive}
                onSelectNode={selectNodeId}
              />
            ) : version.isError ? (
              <ErrorPanel error={version.error} />
            ) : (
              <Skeleton className="m-6 h-[420px]" />
            )}
          </div>
          {panel}
        </TabsContent>
        <TabsContent value="events" className="min-h-0 flex-1 p-4">
          <EventLog
            events={durableEvents(allEvents)}
            nodes={nodeInfo}
            live={isLive}
            className="h-full"
          />
        </TabsContent>
        <TabsContent value="output" className="min-h-0 flex-1 overflow-auto p-6">
          {run.error ? (
            <div
              className="mb-4 rounded-md border border-danger bg-danger-soft px-4 py-3 text-sm text-danger-text"
              role="alert"
            >
              <p className="font-mono text-xs font-semibold">{run.error.code}</p>
              <p className="mt-1">{run.error.message}</p>
            </div>
          ) : null}
          {run.output !== undefined && run.output !== null ? (
            <JsonView value={run.output} expandDepth={3} toolbar />
          ) : !run.error ? (
            <EmptyState
              size="sm"
              title={isLive ? "No output yet" : "This run produced no output"}
              description={isLive ? "The output appears when an output node completes." : undefined}
            />
          ) : null}
          <h3 className="mb-2 mt-8 text-2xs font-semibold uppercase tracking-wide text-ink-3">
            Input
          </h3>
          <JsonView value={run.input ?? null} expandDepth={2} />
        </TabsContent>
        <TabsContent value="logs" className="min-h-0 flex-1 p-4">
          <LogViewer lines={logs} nodeNames={nodeNames} live={isLive} className="h-full" />
        </TabsContent>
        <TabsContent value="cost" className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1 overflow-auto p-6">
            <CostPanel run={run} onSelect={(n) => setSelected(n.id)} />
          </div>
          {panel}
        </TabsContent>
      </Tabs>
      <RunActionDialog
        runId={runId}
        action={action}
        onOpenChange={(open) => {
          if (!open) setAction(null);
        }}
        onSubmit={runAction}
      />
      {evalOpen ? (
        <AddToEvaluationDialog
          open={evalOpen}
          onOpenChange={setEvalOpen}
          ws={s.ws}
          runId={runId}
          workflowId={run.workflowId}
          output={run.output}
        />
      ) : null}
    </div>
  );
}

export function TraceSkeleton() {
  return (
    <div className="flex flex-col gap-4 px-6 py-5" aria-busy="true" aria-label="Loading run">
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-8 w-80" />
      <Skeleton className="h-[420px] w-full" />
    </div>
  );
}

/** What happened, in plain words, under the header; the Guide shows the same story. */
function RunStory({
  run,
  definition,
  timeoutMs,
  cancelReason,
}: {
  run: RunView;
  definition?: WorkflowDefinition;
  timeoutMs?: number;
  cancelReason?: string;
}) {
  useGuideContext(
    useMemo(
      () => ({ kind: "run" as const, run, ...(definition ? { definition } : {}) }),
      [run, definition],
    ),
  );
  const story = explainRun(run, definition, {
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(cancelReason ? { cancelReason } : {}),
  });
  if (!story.length) return null;
  return (
    <details open className="rounded-sm border border-border bg-surface-2 px-3 py-2">
      <summary className="cursor-pointer text-xs font-medium text-ink">
        What happened, in plain words
      </summary>
      <ol className="m-0 mt-1.5 flex list-decimal flex-col gap-0.5 pl-5 text-sm text-ink-2">
        {story.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ol>
    </details>
  );
}
