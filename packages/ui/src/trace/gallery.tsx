import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { RunStatus } from "@/lib/categories";
import type { LogLineView, NodeRunView, RunEvent, RunView } from "@/types";
import { Badge, Button, Switch } from "@/primitives";
import { EventLog } from "./EventLog";
import { LogViewer } from "./LogViewer";
import { ProviderFailoverNotice } from "./ProviderFailoverNotice";
import { RetryAttempts } from "./RetryAttempts";
import { RunHeader } from "./RunHeader";
import { RunStatusTimeline } from "./RunStatusTimeline";
import { ToolCallCard } from "./ToolCallCard";
import { TraceDecisionDetail } from "./TraceDecisionDetail";
import { TraceJsonBlock } from "./TraceJsonBlock";
import { TraceTimeRuler } from "./TraceTimeRuler";
import { TraceTimeline } from "./TraceTimeline";
import { UsageSummary, summarizeUsage } from "./UsageSummary";
import {
  SAMPLE_LIVE_TRANSITIONS,
  SAMPLE_LOOP_TOTALS,
  SAMPLE_NODES,
  SAMPLE_NODE_NAMES,
  SAMPLE_T0,
  SAMPLE_TRANSITIONS,
  buildSampleCompletionEvents,
  buildSampleEvents,
  buildLongLogs,
  buildSampleLogs,
  buildSampleRun,
} from "./sampleRun";

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

/** Snapshot clock so relative times in the gallery are stable: 6 minutes after the run started. */
const SNAPSHOT_NOW = SAMPLE_T0 + 6 * 60_000;

const shift = (iso: string | undefined, delta: number): string | undefined =>
  iso === undefined ? undefined : new Date(Date.parse(iso) + delta).toISOString();

/**
 * Projects the canonical run onto the live clock: node runs are shifted so
 * the run starts at `t0`, only those that have started by `nowMs` are kept,
 * and the ones still in flight are marked running. Events and logs are
 * sliced the same way, so every viewer tails the same simulated run.
 */
function projectLive(
  full: RunView,
  events: RunEvent[],
  logs: LogLineView[],
  t0: number,
  nowMs: number,
): { run: RunView; events: RunEvent[]; logs: LogLineView[] } {
  const delta = t0 - SAMPLE_T0;
  const nodeRuns: NodeRunView[] = [];
  for (const n of full.nodeRuns) {
    const start = n.startedAt ? Date.parse(n.startedAt) + delta : undefined;
    if (start === undefined || start > nowMs) continue;
    const end = n.endedAt ? Date.parse(n.endedAt) + delta : undefined;
    if (end !== undefined && end <= nowMs) {
      nodeRuns.push({
        ...n,
        startedAt: shift(n.startedAt, delta),
        endedAt: shift(n.endedAt, delta),
      });
    } else if (n.status === "waiting") {
      nodeRuns.push({ ...n, startedAt: shift(n.startedAt, delta) });
    } else {
      const {
        endedAt: _e,
        durationMs: _d,
        output: _o,
        error: _err,
        decision: _dec,
        toolCall: _tc,
        ...rest
      } = n;
      nodeRuns.push({ ...rest, status: "running", startedAt: shift(n.startedAt, delta) });
    }
  }
  const last = nodeRuns[nodeRuns.length - 1];
  const waiting = last?.status === "waiting";
  const anyRunning = nodeRuns.some((n) => n.status === "running");
  const status: RunStatus = waiting && !anyRunning ? "waiting_for_human" : "running";
  const run: RunView = {
    ...full,
    status,
    createdAt: shift(full.createdAt, delta) ?? full.createdAt,
    startedAt: shift(full.startedAt, delta),
    endedAt: undefined,
    durationMs: undefined,
    nodeRuns,
    pendingApproval: waiting ? full.pendingApproval : undefined,
  };
  const liveEvents = events
    .filter((e) => Date.parse(e.at) + delta <= nowMs)
    .map((e) => ({ ...e, at: shift(e.at, delta) ?? e.at }));
  const liveLogs = logs
    .filter((l) => Date.parse(l.at) + delta <= nowMs)
    .map((l) => ({ ...l, at: shift(l.at, delta) ?? l.at }));
  return { run, events: liveEvents, logs: liveLogs };
}

/** Slow-motion factor: the 4.5 s run plays out over ~40 s so follow mode is visible. */
const SLOW_MO = 9;

/**
 * Replays the sample run from t=0 while live. The start time is taken in the toggle's event
 * handler; the effect only runs the timer, so state never changes synchronously in it.
 */
function useLiveSimulation() {
  const [t0, setT0] = useState<number | undefined>(undefined);
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    if (t0 === undefined) return;
    const id = window.setInterval(() => setNowMs(t0 + (Date.now() - t0) / SLOW_MO), 200);
    return () => window.clearInterval(id);
  }, [t0]);
  const setLive = useCallback((on: boolean) => {
    if (!on) {
      setT0(undefined);
      return;
    }
    const start = Date.now();
    setT0(start);
    setNowMs(start);
  }, []);
  return { live: t0 !== undefined, t0, nowMs, setLive };
}

const HEADER_STATUSES: RunStatus[] = [
  "waiting_for_human",
  "running",
  "completed",
  "failed",
  "cancelled",
  "queued",
];

export default function TraceGallery() {
  const waitingRun = useMemo(() => buildSampleRun("waiting_for_human"), []);
  const completedRun = useMemo(() => buildSampleRun("completed"), []);
  const baseEvents = useMemo(() => buildSampleEvents(), []);
  const completedEvents = useMemo(
    () => [...buildSampleEvents(), ...buildSampleCompletionEvents()],
    [],
  );
  const baseLogs = useMemo(() => buildSampleLogs(), []);
  const longLogs = useMemo(() => buildLongLogs(10_000), []);

  const { live, t0, nowMs, setLive } = useLiveSimulation();
  const projected = useMemo(
    () =>
      live && t0 !== undefined
        ? projectLive(waitingRun, baseEvents, baseLogs, t0, nowMs)
        : undefined,
    [live, t0, nowMs, waitingRun, baseEvents, baseLogs],
  );
  const run = projected?.run ?? waitingRun;
  const events = projected?.events ?? baseEvents;
  const logs = projected?.logs ?? baseLogs;
  const clock = projected ? nowMs : SNAPSHOT_NOW;

  const [selected, setSelected] = useState<string | undefined>("nr_03");
  const [lastAction, setLastAction] = useState<string>("none yet");
  const act = (label: string) => () => setLastAction(label);

  const lookupAttempts = useMemo(
    () => waitingRun.nodeRuns.filter((n) => n.nodeId === "lookup_account"),
    [waitingRun],
  );
  const usageRows = useMemo(
    () =>
      summarizeUsage(completedRun.nodeRuns, {
        providerFor: (n) =>
          n.decision?.provider ??
          (n.category === "generation" ? "openai" : n.toolCall ? "tools" : "other"),
      }),
    [completedRun],
  );
  const decisionRuns = ["nr_03", "nr_04", "nr_05"].map((id) =>
    waitingRun.nodeRuns.find((n) => n.id === id),
  );
  const lookupOk = lookupAttempts.find((n) => n.attempt === 2)?.toolCall;
  const lookupFailed = lookupAttempts.find((n) => n.attempt === 1);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 p-6 sm:p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold tracking-tight">Trace</h1>
        <p className="max-w-2xl text-xs text-ink-2">
          The run viewer: a distributed-trace timeline of one Support triage run, its event stream
          and logs. Every number here is the run's own; the live toggle replays the run in slow
          motion to exercise follow and tail.
        </p>
      </header>

      <Section
        id="run"
        title="Run viewer"
        caption="RunHeader, TraceTimeline, EventLog and LogViewer sharing one run. Toggle Simulate live to replay it from t=0 at 1/9 speed; new spans grow to now, Follow and Tail keep the newest row in view."
      >
        <div className="flex flex-wrap items-center gap-4 rounded-md border border-border bg-surface-2 px-3 py-2 text-xs">
          <label className="flex cursor-pointer items-center gap-2 text-ink">
            <Switch checked={live} onCheckedChange={setLive} aria-label="Simulate live run" />
            Simulate live run
          </label>
          <span className="font-mono text-2xs text-ink-3 tabular">
            {run.nodeRuns.length} node runs · {events.length} events · {logs.length} log lines
          </span>
          <span className="ml-auto font-mono text-2xs text-ink-3">
            selected: {selected ?? "—"} · last action: {lastAction}
          </span>
        </div>
        <RunHeader
          run={run}
          now={clock}
          onReplay={act("replay")}
          onFork={act("fork")}
          onCancel={act("cancel")}
          onOpenInBuilder={act("open in builder")}
          onOpenReview={act("open review")}
        />
        <TraceTimeline
          run={run}
          now={clock}
          loopTotals={SAMPLE_LOOP_TOTALS}
          selectedNodeRunId={selected}
          onSelectNode={(n) => setSelected(n.id)}
          defaultExpandedIds={["nr_03", "nr_07b"]}
          className="h-[520px]"
        />
        <div className="grid gap-4 xl:grid-cols-2">
          <EventLog
            events={events}
            nodes={SAMPLE_NODES}
            live={run.status === "running"}
            className="h-[420px]"
          />
          <LogViewer
            lines={logs}
            nodeNames={SAMPLE_NODE_NAMES}
            live={run.status === "running"}
            className="h-[420px]"
          />
        </div>
      </Section>

      <Section
        id="header-states"
        title="RunHeader · every status"
        caption="Replay is disabled while a run is active; Cancel appears only then. Waiting runs get the inline banner with Open review; failed runs show the error with the next step."
      >
        <div className="flex flex-col gap-3">
          {HEADER_STATUSES.map((s) => (
            <RunHeader
              key={s}
              run={buildSampleRun(s)}
              now={SNAPSHOT_NOW}
              onReplay={act(`replay ${s}`)}
              onFork={act(`fork ${s}`)}
              onCancel={act(`cancel ${s}`)}
              onOpenInBuilder={act(`builder ${s}`)}
              onOpenReview={act("open review")}
            />
          ))}
        </div>
      </Section>

      <Section
        id="status-timeline"
        title="RunStatusTimeline"
        caption="State transitions with wall-clock times and the time spent in each state. The live variant ends in a pulsing dot and keeps counting."
      >
        <div className="flex flex-col gap-4 rounded-md border border-border bg-surface p-4 shadow-1">
          <RunStatusTimeline transitions={SAMPLE_TRANSITIONS} now={SNAPSHOT_NOW} />
          <RunStatusTimeline transitions={SAMPLE_LIVE_TRANSITIONS} live now={SNAPSHOT_NOW} />
        </div>
      </Section>

      <Section
        id="completed"
        title="TraceTimeline · completed run with a 4-minute review"
        caption="The scale stretches to the whole run, so the 4.5 s of automation compresses against the approval wait. Retry segments stay visible at minimum width."
      >
        <TraceTimeline
          run={completedRun}
          now={SNAPSHOT_NOW}
          loopTotals={SAMPLE_LOOP_TOTALS}
          defaultExpandedIds={["nr_15"]}
          className="h-[360px]"
        />
      </Section>

      <Section
        id="narrow"
        title="TraceTimeline · 400px"
        caption="Under 640px of container width the span column folds away and the row keeps start time, name, kind, duration and status."
      >
        <div className="w-[400px] max-w-full">
          <TraceTimeline
            run={waitingRun}
            now={SNAPSHOT_NOW}
            loopTotals={SAMPLE_LOOP_TOTALS}
            defaultExpandedIds={["nr_03"]}
            className="h-[320px]"
            noToolbar
          />
        </div>
      </Section>

      <Section
        id="events-completed"
        title="EventLog · completed run, virtualization threshold lowered"
        caption="The same list rendered through the virtualizer (threshold 20) to prove the two code paths match. Family chips filter; search matches type, summary, node and payload."
      >
        <EventLog
          events={completedEvents}
          nodes={SAMPLE_NODES}
          virtualizeThreshold={20}
          defaultFamilies={["decision", "tool", "human"]}
          className="h-[320px]"
        />
      </Section>

      <Section
        id="logs-filtered"
        title="LogViewer · search and level filter"
        caption="Search highlights matches; the level chips carry counts; the node select narrows to one node; wrap off gives a horizontal scroll for long lines."
      >
        <LogViewer
          lines={baseLogs}
          nodeNames={SAMPLE_NODE_NAMES}
          defaultQuery="503"
          defaultLevels={["warn", "error"]}
          defaultWrap={false}
        />
      </Section>

      <Section
        id="logs-long"
        title="LogViewer · 10 000 lines, virtualized"
        caption="Above 200 lines (the EventLog threshold) only the rows in view are mounted; rows are measured, so wrapped lines and opened data keep their height. Filters and search run over all 10 000 lines."
      >
        <LogViewer lines={longLogs} nodeNames={SAMPLE_NODE_NAMES} className="h-[360px]" />
      </Section>

      <Section
        id="json-block"
        title="TraceJsonBlock"
        caption="The compact mono payload block used inside the trace: pretty-printed objects, raw strings, a Show all toggle past maxChars (copy always copies the full value), and a scroll past maxHeight."
      >
        <div className="grid items-start gap-4 xl:grid-cols-3">
          <TraceJsonBlock label="args" value={{ id: "cus_9Yt3LqA8", expand: ["devices", "mfa"] }} />
          <TraceJsonBlock
            label="result · truncated"
            value={{
              items: Array.from({ length: 24 }, (_, i) => ({
                id: `dev_${i}`,
                trusted: i % 3 === 0,
              })),
            }}
            maxChars={240}
            maxHeight={180}
          />
          <TraceJsonBlock
            label="raw string · no copy"
            value="503 Service Unavailable (upstream: accounts-api)"
            noCopy
          />
        </div>
      </Section>

      <Section
        id="time-ruler"
        title="TraceTimeRuler"
        caption="The span-column tick track: nice 1/2/5 × 10ⁿ steps under maxTicks, a hairline per tick, and the live now marker at the right edge."
      >
        <div className="flex flex-col gap-3 rounded-md border border-border bg-surface p-3">
          <TraceTimeRuler totalMs={840} />
          <TraceTimeRuler totalMs={12_400} maxTicks={8} />
          <TraceTimeRuler totalMs={6 * 60_000} live />
        </div>
      </Section>

      <Section
        id="tool-call"
        title="ToolCallCard"
        caption="A successful call and the failed first attempt. Status codes use the status tones (2xx ok, 4xx warn, 5xx danger); the idempotency key is a mono chip with copy."
      >
        <div className="grid items-start gap-4 xl:grid-cols-2">
          {lookupOk ? (
            <ToolCallCard
              call={{
                name: lookupOk.name,
                target: "GET /v1/customers/cus_9Yt3LqA8",
                args: lookupOk.args,
                result: lookupOk.result,
                statusCode: lookupOk.statusCode,
                durationMs: lookupOk.durationMs,
                idempotencyKey: "run_01J8Q4Z6:lookup_account:1",
              }}
            />
          ) : null}
          {lookupFailed?.toolCall ? (
            <ToolCallCard
              call={{
                name: lookupFailed.toolCall.name,
                target: "GET /v1/customers/cus_9Yt3LqA8",
                args: lookupFailed.toolCall.args,
                statusCode: lookupFailed.toolCall.statusCode,
                durationMs: lookupFailed.toolCall.durationMs,
                idempotencyKey: "run_01J8Q4Z6:lookup_account:1",
                error: lookupFailed.error
                  ? { code: lookupFailed.error.code, message: lookupFailed.error.message }
                  : undefined,
              }}
              defaultOpenArgs={false}
            />
          ) : null}
        </div>
      </Section>

      <Section
        id="retries"
        title="RetryAttempts"
        caption="One tab per attempt with the outcome and the back-off delay since the previous attempt."
      >
        <div className="max-w-2xl rounded-md border border-border bg-surface p-4 shadow-1">
          <RetryAttempts attempts={lookupAttempts} />
        </div>
      </Section>

      <Section
        id="usage"
        title="UsageSummary"
        caption="Per-provider calls, tokens and cost for the completed run, with totals. Zero cells fade so the eye lands on the numbers that matter."
      >
        <div className="max-w-3xl">
          <UsageSummary rows={usageRows} />
        </div>
      </Section>

      <Section
        id="failover"
        title="ProviderFailoverNotice"
        caption="Full and compact variants for a PROVIDER_FAILOVER event."
      >
        <div className="flex max-w-3xl flex-col gap-3">
          <ProviderFailoverNotice
            failover={{
              from: "openai:eu-west",
              to: "openai:us-east",
              reason: "429 rate limited; retry-after 30 s exceeds the node's 2 s latency budget.",
              at: new Date(SAMPLE_T0 + 3402).toISOString(),
              nodeName: "Draft reply",
              latencyMs: 248,
            }}
            action={
              <Button variant="ghost" size="sm" onClick={act("provider health")}>
                Provider health
              </Button>
            }
          />
          <ProviderFailoverNotice
            compact
            failover={{
              from: "jev-latest",
              to: "jev-preview",
              reason: "timeout",
              nodeName: "Classify severity",
            }}
          />
        </div>
      </Section>

      <Section
        id="decision-detail"
        title="TraceDecisionDetail"
        caption="The inline decision block used by expanded rows: choice ruler + list, boolean gauge, score scale. Cobalt only ever means decision."
      >
        <div className="grid gap-4 md:grid-cols-3">
          {decisionRuns.map((n) =>
            n?.decision ? (
              <div
                key={n.id}
                className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4 shadow-1"
              >
                <Badge tone="accent" mono size="sm" className="self-start">
                  {n.decision.kind}
                </Badge>
                <TraceDecisionDetail decision={n.decision} question={n.decisionQuestion} />
              </div>
            ) : null,
          )}
        </div>
      </Section>
    </div>
  );
}
