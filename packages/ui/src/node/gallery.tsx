import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  type Edge,
} from "@xyflow/react";
import "./node.css";
import { foldRunEvents } from "@/lib/adapters";
import { cn } from "@/lib/cn";
import { formatTokens } from "@/lib/format";
import { Toaster, toast } from "@/primitives";
import type { IterationView, NodeRunView, WorkflowNodeView } from "@/types";
import { ContainerFrame } from "./ContainerFrame";
import { AgentNodeCard } from "./AgentNodeCard";
import { BranchNodeCard } from "./BranchNodeCard";
import { CodeNodeCard } from "./CodeNodeCard";
import { ConfidenceGateNodeCard } from "./ConfidenceGateNodeCard";
import { DecisionNodeCard } from "./DecisionNodeCard";
import { EndNodeCard } from "./EndNodeCard";
import { GenerationNodeCard } from "./GenerationNodeCard";
import { HttpNodeCard } from "./HttpNodeCard";
import { HumanNodeCard } from "./HumanNodeCard";
import { JoinNodeCard } from "./JoinNodeCard";
import { LoopNodeCard } from "./LoopNodeCard";
import { NodeActionBar, type NodeActionHandlers } from "./NodeActionBar";
import { NodeCard } from "./NodeCard";
import { NodeRouteList } from "./NodeRouteList";
import { NodeTerminalPill } from "./NodeTerminalPill";
import { NoteCard } from "./NoteCard";
import { RetrievalNodeCard } from "./RetrievalNodeCard";
import { RouterNodeCard } from "./RouterNodeCard";
import { SafetyNodeCard } from "./SafetyNodeCard";
import { StartNodeCard } from "./StartNodeCard";
import { StateNodeCard } from "./StateNodeCard";
import { SubflowNodeCard } from "./SubflowNodeCard";
import { ToolNodeCard } from "./ToolNodeCard";
import { TypedHandle } from "./TypedHandle";
import { WaitNodeCard } from "./WaitNodeCard";
import { nodeTypes, orderParentsFirst, toFlowNode, type FlowNode } from "./nodeTypes";
import { minutesAgo, mkRun, sampleCode, sampleReply, triage, triageRuns } from "./fixtures";
import { cardVariantFor } from "./nodeUtils";
import {
  researchAgentEdges,
  researchAgentEvents,
  researchAgentLayout,
  researchAgentNodes,
} from "./researchAgent";

// ---------------------------------------------------------------------------
// helpers
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

/** Cards laid out on the dot grid, outside a ReactFlow instance. */
function Board({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "canvas-grid flex flex-wrap items-start gap-x-10 gap-y-8 rounded-md border border-border p-6",
        className,
      )}
    >
      {children}
    </div>
  );
}

function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="font-mono text-2xs uppercase tracking-[0.06em] text-ink-3">{label}</p>
      {children}
    </div>
  );
}

/** Reveals `text` word by word while `active`, like a streaming completion. */
function useStreamingText(text: string, active: boolean) {
  const words = useMemo(() => text.split(" "), [text]);
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => {
      setCount((c) => (c >= words.length ? 4 : c + 1));
    }, 180);
    return () => window.clearInterval(id);
  }, [active, words.length]);
  return useMemo(
    () => ({ text: words.slice(0, count).join(" "), outputTokens: Math.round(count * 1.3) }),
    [words, count],
  );
}

const actions: NodeActionHandlers = {
  onRunFromHere: (id) => toast.info(`Run from ${id}`),
  onDuplicate: (id) => toast.success(`Duplicated ${id}`),
  onToggleDisabled: (id) => toast(`Toggled ${id}`),
  onDelete: (id) => toast.error(`Deleted ${id}`),
  onOpenInspector: (id) => toast(`Inspector: ${id}`),
};

// ---------------------------------------------------------------------------
// canvas
// ---------------------------------------------------------------------------

const EDGE_STYLE = { stroke: "var(--border-strong)", strokeWidth: 1.5 };

function buildNodes(stream: { text: string; outputTokens: number }): FlowNode[] {
  const col = (i: number) => 40 + i * 280;
  const nodes: FlowNode[] = [
    toFlowNode(triage.start, { x: col(0), y: 88 }, triageRuns.start),
    toFlowNode(triage.intent, { x: col(1), y: 60 }, triageRuns.intent, { actions }),
    toFlowNode(triage.lookup, { x: col(2), y: 60 }, triageRuns.lookup, { actions }),
    toFlowNode(triage.router, { x: col(3), y: 60 }, triageRuns.router, { actions }),
    toFlowNode(triage.draft, { x: col(0), y: 320 }, triageRuns.draftRunning, { stream, actions }),
    toFlowNode(triage.safety, { x: col(1), y: 320 }, triageRuns.safety, { actions }),
    toFlowNode(triage.gate, { x: col(2), y: 320 }, triageRuns.gate, { actions }),
    toFlowNode(triage.approve, { x: col(3), y: 320 }, triageRuns.approveWaiting, {
      actions,
      onOpenReview: (id) => toast.info(`Open review for ${id}`),
    }),
    toFlowNode(triage.end, { x: col(1), y: 600 }, undefined),
    toFlowNode(triage.note, { x: col(2), y: 600 }),
  ];
  const intent = nodes[1];
  if (intent) intent.selected = true;
  return nodes;
}

const CONTROL_STYLE = { ...EDGE_STYLE, strokeDasharray: "5 4" };

/** Control edges (`ctl:<port>` → `ctl-in`) and a few data edges (`out:<port>` → `in:<port>`) with the prefixed handle ids. */
const EDGES: Edge[] = [
  ...[
    { id: "c-start-intent", source: "start", sourceHandle: "ctl:done", target: "intent" },
    { id: "c-intent-lookup", source: "intent", sourceHandle: "ctl:done", target: "lookup" },
    { id: "c-lookup-router", source: "lookup", sourceHandle: "ctl:done", target: "router" },
    { id: "c-router-draft", source: "router", sourceHandle: "ctl:billing", target: "draft" },
    { id: "c-draft-safety", source: "draft", sourceHandle: "ctl:done", target: "safety" },
    { id: "c-safety-gate", source: "safety", sourceHandle: "ctl:done", target: "gate" },
    { id: "c-gate-approve", source: "gate", sourceHandle: "ctl:review", target: "approve" },
    { id: "c-approve-end", source: "approve", sourceHandle: "ctl:approved", target: "end" },
  ].map((e) => ({ ...e, targetHandle: "ctl-in", style: CONTROL_STYLE })),
  ...[
    {
      id: "d-start-intent",
      source: "start",
      sourceHandle: "out:out",
      target: "intent",
      targetHandle: "in:in",
    },
    {
      id: "d-intent-lookup",
      source: "intent",
      sourceHandle: "out:out",
      target: "lookup",
      targetHandle: "in:in",
    },
    {
      id: "d-draft-safety",
      source: "draft",
      sourceHandle: "out:out",
      target: "safety",
      targetHandle: "in:in",
    },
    {
      id: "d-safety-gate",
      source: "safety",
      sourceHandle: "out:out",
      target: "gate",
      targetHandle: "in:in",
    },
    {
      id: "d-approve-end",
      source: "approve",
      sourceHandle: "out:out",
      target: "end",
      targetHandle: "in:in",
    },
  ].map((e) => ({ ...e, style: EDGE_STYLE })),
].map((e) => ({ ...e, type: "smoothstep", pathOptions: { borderRadius: 10 } }));

function TriageCanvas() {
  const stream = useStreamingText(sampleReply, true);
  const initial = useMemo(() => buildNodes({ text: "", outputTokens: 0 }), []);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(initial);
  useEffect(() => {
    setNodes((current) =>
      current.map((n) =>
        n.id === "draft" ? { ...n, data: { ...n.data, extras: { ...n.data.extras, stream } } } : n,
      ),
    );
  }, [stream, setNodes]);
  return (
    <div className="h-[600px] overflow-hidden rounded-md border border-border bg-canvas">
      <ReactFlow<FlowNode, Edge>
        nodes={nodes}
        edges={EDGES}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        fitView
        fitViewOptions={{ padding: 0.12 }}
        minZoom={0.4}
        maxZoom={1.5}
        attributionPosition="bottom-right"
        defaultEdgeOptions={{ type: "smoothstep", style: EDGE_STYLE }}
        nodesConnectable
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--grid)" />
      </ReactFlow>
    </div>
  );
}

// ---------------------------------------------------------------------------
// containers: the research agent's loop and foreach bodies
// ---------------------------------------------------------------------------

const RESEARCH_BY_ID = new Map(researchAgentNodes.map((n) => [n.id, n]));

/** The research agent's mid-run log folded into node runs: `research` 3/5, `search_all` 3/4. */
function researchRuns(): Map<string, NodeRunView> {
  const folded = foldRunEvents(researchAgentEvents(), {
    nodeNameFor: (id) => RESEARCH_BY_ID.get(id)?.name ?? id,
    categoryFor: (id) => RESEARCH_BY_ID.get(id)?.category ?? "flow",
  });
  const latest = new Map<string, NodeRunView>();
  for (const r of folded.nodeRuns) latest.set(r.nodeId, r);
  return latest;
}

/**
 * The research agent on a plain ReactFlow with the `nodeTypes` map: frames from
 * `researchAgentLayout` (children relative to their frame), resizable while selected.
 * The canvas gallery shows the same graph on `FlowCanvas` with drop-to-reparent and auto layout.
 */
function ResearchAgentFrames() {
  // Its own store: the page-level provider belongs to the triage canvas.
  return (
    <ReactFlowProvider>
      <ResearchAgentFlow />
    </ReactFlowProvider>
  );
}

function ResearchAgentFlow() {
  const [inspected, setInspected] = useState<string | undefined>(undefined);
  const initial = useMemo(() => {
    const runs = researchRuns();
    const extras = {
      onSelectIteration: (id: string, it: IterationView) =>
        setInspected(`${id} · ${it.scope} (${it.status})`),
    };
    return orderParentsFirst(
      researchAgentNodes.map((n) =>
        toFlowNode(
          n,
          researchAgentLayout.nodes[n.id] ?? { x: 0, y: 0 },
          runs.get(n.id),
          cardVariantFor(n) === "container" ? extras : undefined,
        ),
      ),
    );
  }, []);
  const [nodes, , onNodesChange] = useNodesState<FlowNode>(initial);
  return (
    <div className="flex flex-col gap-2">
      <div className="h-[420px] overflow-hidden rounded-md border border-border bg-canvas">
        <ReactFlow<FlowNode, Edge>
          nodes={nodes}
          edges={RESEARCH_EDGES}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          fitView
          fitViewOptions={{ padding: 0.08 }}
          minZoom={0.2}
          maxZoom={1.5}
          attributionPosition="bottom-right"
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--grid)" />
        </ReactFlow>
      </div>
      <p className="font-mono text-2xs text-ink-3" aria-live="polite">
        {inspected
          ? `inspector shows ${inspected}`
          : "Step through a frame's iterations to pick the one the inspector shows."}
      </p>
    </div>
  );
}

/** The fixture's edges with the prefixed handle ids; control dashed, implicit data dotted. */
const RESEARCH_EDGES: Edge[] = researchAgentEdges.map((e) => ({
  id: e.id,
  source: e.source,
  target: e.target,
  sourceHandle: e.sourceHandle,
  targetHandle: e.targetHandle,
  type: "smoothstep",
  style:
    e.kind === "control"
      ? CONTROL_STYLE
      : e.via && e.via !== "ref"
        ? { ...EDGE_STYLE, strokeDasharray: "2 4" }
        : EDGE_STYLE,
}));

function FrameStates() {
  const loop = RESEARCH_BY_ID.get("research");
  const foreach = RESEARCH_BY_ID.get("search_all");
  const runs = researchRuns();
  const latest = (id: string) => runs.get(id);
  if (!loop || !foreach) return null;
  return (
    <Board>
      <Labelled label="loop · idle">
        <ContainerFrame node={loop} width={420} height={120} />
      </Labelled>
      <Labelled label="loop · running · 3 / 5">
        <ContainerFrame node={loop} run={latest("research")} width={420} height={120} />
      </Labelled>
      <Labelled label="foreach · 3 / 4 items">
        <ContainerFrame node={foreach} run={latest("search_all")} width={420} height={120} />
      </Labelled>
      <Labelled label="loop · selected">
        <ContainerFrame node={loop} run={latest("research")} selected width={420} height={120} />
      </Labelled>
      <Labelled label="collapsed card · loop 3 / 5">
        <LoopNodeCard node={loop} run={latest("research")} />
      </Labelled>
    </Board>
  );
}

// ---------------------------------------------------------------------------
// states matrix
// ---------------------------------------------------------------------------

function matrixRun(status: NodeRunView["status"]): NodeRunView | undefined {
  const base = triageRuns.intent;
  switch (status) {
    case "pending":
      return mkRun(triage.intent, {
        status,
        startedAt: undefined,
        endedAt: undefined,
        durationMs: undefined,
      });
    case "running":
      return mkRun(triage.intent, { status, endedAt: undefined, durationMs: undefined });
    case "retry_wait":
      return mkRun(triage.intent, {
        status,
        attempt: 2,
        durationMs: 8_000,
        error: {
          code: "PROVIDER_OVERLOADED",
          message: "jev-latest returned 529; next attempt in 4 s",
          retryable: true,
        },
      });
    case "reused":
      return mkRun(triage.intent, { status, durationMs: 0, reusedFromNodeRunId: "nr_intent_prev" });
    case "completed":
      return base;
    case "failed":
      return mkRun(triage.intent, {
        status,
        attempt: 3,
        durationMs: 9_800,
        error: {
          code: "TIMEOUT_ERROR",
          message: "jev-latest did not answer within 8 s; the fallback provider is not configured",
          retryable: true,
        },
      });
    case "waiting":
      return mkRun(triage.intent, {
        status,
        startedAt: minutesAgo(2),
        endedAt: undefined,
        durationMs: undefined,
      });
    case "skipped":
      return mkRun(triage.intent, { status, durationMs: 0 });
    case "cancelled":
      return mkRun(triage.intent, { status, durationMs: 120 });
  }
}

const MATRIX: Array<{
  label: string;
  status?: NodeRunView["status"];
  selected?: boolean;
  hovered?: boolean;
  disabled?: boolean;
}> = [
  { label: "idle (no run)" },
  { label: "pending", status: "pending" },
  { label: "running", status: "running" },
  { label: "retry wait", status: "retry_wait" },
  { label: "completed", status: "completed" },
  { label: "reused", status: "reused" },
  { label: "failed", status: "failed" },
  { label: "waiting", status: "waiting" },
  { label: "skipped", status: "skipped" },
  { label: "cancelled", status: "cancelled" },
  { label: "disabled", status: "completed", disabled: true },
  { label: "selected", status: "completed", selected: true },
  { label: "selected + running", status: "running", selected: true },
  { label: "hovered", status: "completed", hovered: true },
];

function StatesMatrix() {
  return (
    <Board>
      {MATRIX.map((m) => (
        <Labelled key={m.label} label={m.label}>
          <DecisionNodeCard
            node={triage.intent}
            run={m.status ? matrixRun(m.status) : undefined}
            selected={m.selected}
            hovered={m.hovered}
            disabled={m.disabled}
          />
        </Labelled>
      ))}
    </Board>
  );
}

// ---------------------------------------------------------------------------
// handles
// ---------------------------------------------------------------------------

const portsNode: WorkflowNodeView = {
  ...triage.draft,
  id: "ports",
  name: "Typed ports",
  description: "Hover a port to read its label",
  meta: undefined,
  inputs: [
    { id: "ticket", label: "ticket", type: "ticket", required: true },
    { id: "customer", label: "customer", type: "customer" },
    { id: "context", label: "context", type: "any" },
  ],
  outputs: [
    { id: "reply", label: "reply", type: "message" },
    { id: "usage", label: "usage", type: "any" },
  ],
};

function HandleStates() {
  return (
    <Board>
      <Labelled label="typed (tinted) and untyped (neutral)">
        <NodeCard node={portsNode} kindLabel="generate" />
      </Labelled>
      <Labelled label="compatible while dragging a `customer`">
        <NodeCard
          node={{ ...portsNode, id: "ports-compat" }}
          kindLabel="generate"
          compatibleHandles={["in:customer"]}
          handleReasons={{ "in:ticket": "customer does not fit ticket: missing required subject" }}
        />
      </Labelled>
      <Labelled label="labels pinned · in / out / ctl / ctl-in">
        <div className="relative ml-24 mt-4 h-20 w-[232px] rounded-md border border-border bg-surface">
          <TypedHandle kind="ctl-in" category="flow" labelMode="always" />
          <TypedHandle
            kind="in"
            name="decision"
            port={{ label: "decision", type: "decision" }}
            category="decision"
            offset={24}
            labelMode="always"
          />
          <TypedHandle
            kind="in"
            name="context"
            port={{ label: "context", type: "any" }}
            offset={52}
            labelMode="always"
          />
          <TypedHandle
            kind="ctl"
            name="done"
            label="done"
            category="generation"
            offset={24}
            labelMode="always"
            connected
          />
          <TypedHandle
            kind="out"
            name="reply"
            port={{ label: "reply", type: "message" }}
            category="generation"
            offset={52}
            labelMode="always"
            compatible
          />
        </div>
      </Labelled>
    </Board>
  );
}

// ---------------------------------------------------------------------------
// building blocks
// ---------------------------------------------------------------------------

const ROUTES = [
  { id: "billing", label: "billing", condition: "intent == 'billing'" },
  { id: "security", label: "security", condition: "intent == 'security'" },
  { id: "other", label: "other" },
];

function BuildingBlocks() {
  return (
    <Board>
      <Labelled label="NodeTerminalPill · start, idle">
        <NodeTerminalPill kind="start" node={triage.start} />
      </Labelled>
      <Labelled label="NodeTerminalPill · start, ran">
        <NodeTerminalPill
          kind="start"
          node={{ ...triage.start, id: "start-ran" }}
          run={triageRuns.start}
        />
      </Labelled>
      <Labelled label="NodeTerminalPill · end, failed">
        <NodeTerminalPill
          kind="end"
          node={{ ...triage.end, id: "end-failed" }}
          run={mkRun(triage.end, {
            status: "failed",
            error: { code: "TIMEOUT_ERROR", message: "Output write timed out", retryable: true },
          })}
        />
      </Labelled>
      <Labelled label="NodeRouteList · before a run">
        <div className="fa-node relative w-[232px] py-2">
          <NodeRouteList routes={ROUTES} category="decision" />
        </div>
      </Labelled>
      <Labelled label="NodeRouteList · resolved, billing taken, with outputs">
        <div className="fa-node relative w-[232px] py-2">
          <NodeRouteList
            routes={ROUTES}
            taken="billing"
            resolved
            category="decision"
            outputs={[{ id: "intent", label: "intent", type: "string" }]}
          />
        </div>
      </Labelled>
      <Labelled label="NodeRouteList · while dragging a connection">
        <div className="fa-node relative w-[232px] py-2">
          <NodeRouteList
            routes={ROUTES}
            category="decision"
            compatibleHandles={["ctl:billing", "ctl:other"]}
            handleReasons={{ "ctl:security": "security is already connected" }}
          />
        </div>
      </Labelled>
    </Board>
  );
}

// ---------------------------------------------------------------------------
// kinds
// ---------------------------------------------------------------------------

function KindCards() {
  const stream = useStreamingText(sampleReply, true);
  const idleAgentNode = { ...triage.agent, id: "agent-idle" };
  const diagNode: WorkflowNodeView = {
    ...triage.lookup,
    id: "lookup-diag",
    diagnostics: [
      {
        code: "E_CREDENTIAL_SLOT_UNBOUND",
        severity: "error",
        message: "Credential stripe-prod is not available in production",
        location: { nodeId: "lookup-diag", path: "/nodes/3/credentials/http" },
      },
      {
        code: "W_LOOSE_BOUNDS",
        severity: "warning",
        message: "Timeout of 5 s is below the p99 latency of this endpoint (6.2 s)",
        location: { nodeId: "lookup-diag", path: "/nodes/3/policy/timeoutMs" },
      },
    ],
  };
  const warnNode: WorkflowNodeView = {
    ...triage.intent,
    id: "intent-warn",
    diagnostics: [
      {
        code: "W_UNREACHABLE_ROUTE",
        severity: "warning",
        message: "Option 'other' is never routed",
        location: { nodeId: "intent-warn", path: "/nodes/2/config/criteria/options/3" },
      },
    ],
  };
  return (
    <div className="flex flex-col gap-6">
      <Board>
        <Labelled label="decision · choice">
          <DecisionNodeCard node={triage.intent} run={triageRuns.intent} />
        </Labelled>
        <Labelled label="decision · score">
          <DecisionNodeCard node={triage.urgency} run={triageRuns.urgency} />
        </Labelled>
        <Labelled label="decision · boolean">
          <DecisionNodeCard node={triage.escalation} run={triageRuns.escalation} />
        </Labelled>
        <Labelled label="decision · idle">
          <DecisionNodeCard node={triage.urgency} />
        </Labelled>
        <Labelled label="diagnostics · error + warning">
          <NodeCard node={diagNode} />
        </Labelled>
        <Labelled label="diagnostics · warning">
          <DecisionNodeCard node={warnNode} run={triageRuns.intent} />
        </Labelled>
      </Board>
      <Board>
        <Labelled label="generation · running">
          <GenerationNodeCard node={triage.draft} run={triageRuns.draftRunning} stream={stream} />
        </Labelled>
        <Labelled label="generation · completed">
          <GenerationNodeCard node={triage.draft} run={triageRuns.draft} />
        </Labelled>
        <Labelled label="generation · idle">
          <GenerationNodeCard node={triage.draft} />
        </Labelled>
        <Labelled label={`stream · ${formatTokens(stream.outputTokens)} tokens`}>
          <GenerationNodeCard
            node={{ ...triage.draft, id: "draft-nostream" }}
            run={triageRuns.draftRunning}
          />
        </Labelled>
      </Board>
      <Board>
        <Labelled label="http · GET 200">
          <HttpNodeCard node={triage.lookup} run={triageRuns.lookup} />
        </Labelled>
        <Labelled label="http · POST 502 failed">
          <HttpNodeCard node={triage.refund} run={triageRuns.refund} />
        </Labelled>
        <Labelled label="http · DELETE 204">
          <HttpNodeCard node={triage.purge} run={triageRuns.purge} />
        </Labelled>
        <Labelled label="http · idle">
          <HttpNodeCard node={triage.lookup} />
        </Labelled>
        <Labelled label="tool · mcp">
          <ToolNodeCard node={triage.ticket} run={triageRuns.ticket} />
        </Labelled>
      </Board>
      <Board>
        <Labelled label="human · waiting (live timer)">
          <HumanNodeCard
            node={triage.approve}
            run={triageRuns.approveWaiting}
            onOpenReview={(id) => toast.info(`Open review for ${id}`)}
          />
        </Labelled>
        <Labelled label="human · approved">
          <HumanNodeCard node={triage.approve} run={triageRuns.approved} />
        </Labelled>
        <Labelled label="human · idle">
          <HumanNodeCard node={triage.approve} />
        </Labelled>
      </Board>
      <Board>
        <Labelled label="router · billing taken">
          <RouterNodeCard node={triage.router} run={triageRuns.router} />
        </Labelled>
        <Labelled label="router · idle">
          <RouterNodeCard node={triage.router} />
        </Labelled>
        <Labelled label="branch · false taken">
          <BranchNodeCard node={triage.branch} run={triageRuns.branch} />
        </Labelled>
        <Labelled label="gate · 0.81 → review">
          <ConfidenceGateNodeCard node={triage.gate} run={triageRuns.gate} />
        </Labelled>
        <Labelled label="gate · idle">
          <ConfidenceGateNodeCard node={triage.gate} />
        </Labelled>
        <Labelled label="gate · 0.94 → pass">
          <ConfidenceGateNodeCard
            node={triage.gate}
            run={mkRun(triage.gate, {
              routeTaken: "pass",
              input: { confidence: 0.94 },
              durationMs: 1,
            })}
          />
        </Labelled>
        <Labelled label="gate · two-way (no reviewBand) · 0.62 → review">
          <ConfidenceGateNodeCard
            node={triage.gate}
            gate={{ threshold: 0.8 }}
            run={mkRun(triage.gate, { input: { confidence: 0.62 }, durationMs: 1 })}
          />
        </Labelled>
      </Board>
      <Board>
        <Labelled label="loop · iteration 3 / 10">
          <LoopNodeCard node={triage.loop} run={triageRuns.loop} />
        </Labelled>
        <Labelled label="loop · idle">
          <LoopNodeCard node={triage.loop} />
        </Labelled>
        <Labelled label="join · all 2 · 1 / 2 arrived">
          <JoinNodeCard node={triage.join} run={triageRuns.join} />
        </Labelled>
        <Labelled label="join · race · idle">
          <JoinNodeCard node={{ ...triage.join, id: "join-race" }} mode={{ type: "race" }} />
        </Labelled>
        <Labelled label="wait · event (live timer)">
          <WaitNodeCard node={triage.wait} run={triageRuns.waitWaiting} />
        </Labelled>
        <Labelled label="wait · delay · idle">
          <WaitNodeCard
            node={{
              ...triage.wait,
              id: "wait-delay",
              name: "Cool down",
              description: "Give the customer time to reply",
              meta: [{ label: "delay", value: "15 m" }],
            }}
          />
        </Labelled>
        <Labelled label="note">
          <NoteCard node={triage.note} />
        </Labelled>
        <Labelled label="subflow">
          <SubflowNodeCard node={triage.subflow} run={triageRuns.subflow} />
        </Labelled>
        <Labelled label="code">
          <CodeNodeCard node={triage.code} run={triageRuns.code} code={sampleCode} />
        </Labelled>
        <Labelled label="agent · running">
          <AgentNodeCard node={triage.agent} run={triageRuns.agent} />
        </Labelled>
        <Labelled label="agent · idle">
          <AgentNodeCard node={idleAgentNode} />
        </Labelled>
      </Board>
      <Board>
        <Labelled label="safety · pass">
          <SafetyNodeCard node={triage.safety} run={triageRuns.safety} />
        </Labelled>
        <Labelled label="safety · block">
          <SafetyNodeCard node={triage.safety} run={triageRuns.safetyBlocked} />
        </Labelled>
        <Labelled label="state">
          <StateNodeCard node={triage.state} run={triageRuns.state} />
        </Labelled>
        <Labelled label="retrieval">
          <RetrievalNodeCard node={triage.retrieval} run={triageRuns.retrieval} />
        </Labelled>
        <Labelled label="default (data)">
          <NodeCard node={triage.parse} run={triageRuns.parse} />
        </Labelled>
      </Board>
      <Board>
        <Labelled label="start · completed">
          <StartNodeCard node={triage.start} run={triageRuns.start} />
        </Labelled>
        <Labelled label="start · selected">
          <StartNodeCard node={triage.start} selected />
        </Labelled>
        <Labelled label="end · idle">
          <EndNodeCard node={triage.end} />
        </Labelled>
        <Labelled label="end · running">
          <EndNodeCard
            node={triage.end}
            run={mkRun(triage.end, { status: "running", durationMs: undefined })}
          />
        </Labelled>
        <Labelled label="end · disabled">
          <EndNodeCard node={{ ...triage.end, disabled: true }} />
        </Labelled>
      </Board>
    </div>
  );
}

// ---------------------------------------------------------------------------
// toolbar
// ---------------------------------------------------------------------------

function ToolbarStates() {
  const [disabled, setDisabled] = useState(false);
  const toggle = useCallback(() => setDisabled((d) => !d), []);
  return (
    <Board className="items-center gap-8">
      <Labelled label="all actions">
        <NodeActionBar nodeId="intent" disabled={disabled} {...actions} onToggleDisabled={toggle} />
      </Labelled>
      <Labelled label="cannot run from here">
        <NodeActionBar nodeId="start" canRun={false} {...actions} />
      </Labelled>
      <Labelled label="inspector + delete only">
        <NodeActionBar
          nodeId="end"
          onOpenInspector={actions.onOpenInspector}
          onDelete={actions.onDelete}
        />
      </Labelled>
    </Board>
  );
}

// ---------------------------------------------------------------------------

export default function NodeGallery() {
  return (
    <ReactFlowProvider>
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-10 p-6 sm:p-8">
        <header className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold tracking-tight">Nodes</h1>
          <p className="max-w-2xl text-sm text-ink-2">
            Canvas node renderers for @xyflow/react. A node says what it is, what it is for and what
            happened; decision nodes show their probabilities inline and state changes the outline,
            never the fill.
          </p>
        </header>

        <Section
          id="canvas"
          title="Support triage on the canvas"
          caption="Live ReactFlow instance with the ready-made nodeTypes map. Drag nodes, select one to reveal its toolbar, hover a port for its label. The reply is streaming and the approval timer is ticking."
        >
          <TriageCanvas />
        </Section>

        <Section
          id="containers"
          title="Loop and foreach frames · research agent"
          caption="The research-agent fixture: the loop body (plan, search, accumulate, synthesize, judge completeness) sits in the Research rounds frame and the foreach body (search, judge) in Run searches. Children carry parentId and extent 'parent', so they stay inside their frame. Badges come from folded LOOP_ITERATION_* and FOREACH_ITEM_COMPLETED events; the stepper picks the iteration the inspector shows. Select a frame to resize it. The canvas page adds drop-to-reparent and compound auto layout."
        >
          <ResearchAgentFrames />
          <FrameStates />
        </Section>

        <Section
          id="states"
          title="States matrix · decision card"
          caption="Every run state on the same node. Selected is an accent border with a soft ring; running pulses an info ring; waiting borrows the human hue; failed is red; skipped is dashed; disabled fades and shows off."
        >
          <StatesMatrix />
        </Section>

        <Section
          id="kinds"
          title="Kind-specific cards"
          caption="Each kind puts its one important fact on the card: the distribution, the streaming output, the status code, the taken route, the thresholds. Configuration stays in the inspector."
        >
          <KindCards />
        </Section>

        <Section
          id="building-blocks"
          title="Building blocks · terminal pill and route list"
          caption="The pieces the start/end and router/branch cards are made of. NodeTerminalPill is the compact start and end with a status dot once it ran; NodeRouteList draws one control exit (ctl:<route>) per route, mutes the routes not taken after a run and lists data outputs below."
        >
          <BuildingBlocks />
        </Section>

        <Section
          id="handles"
          title="Typed handles"
          caption="Ids are always out:<port>, in:<port>, ctl:<port> or ctl-in. Data ports are 8px circles on the side borders, tinted by category when typed; control-outs are small squares on the right above the data-outs; the control-in is a notch at the top left. Compatible ports glow while a connection drags; incompatible ones fade and say why."
        >
          <HandleStates />
        </Section>

        <Section
          id="toolbar"
          title="Node toolbar"
          caption="Floats above a selected node via xyflow's NodeToolbar. Every action is a callback with the node id."
        >
          <ToolbarStates />
        </Section>
      </div>
      <Toaster />
    </ReactFlowProvider>
  );
}
