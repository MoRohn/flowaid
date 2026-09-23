import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useEdgesState, useNodesState, type Connection, type NodeChange } from "@xyflow/react";
import { Play, RotateCcw, SkipForward } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatCost, formatMs } from "@/lib/format";
import { cardVariantFor, toFlowNode } from "@/node";
import {
  researchAgentDependencies,
  researchAgentEdges,
  researchAgentEvents,
  researchAgentNodes,
} from "@/node/researchAgent";
import { foldRunEvents } from "@/lib/adapters";
import { Button, Checkbox, StatusChip } from "@/primitives";
import type { IterationView, NodeKind, RunView, WorkflowEdgeView, WorkflowNodeView } from "@/types";
import { applyAutoLayout, autoLayout, estimateNodeHeight } from "./autoLayout";
import { applyLayoutChanges } from "./containers";
import { CanvasControls } from "./CanvasControls";
import { ConnectionLinePath } from "./ConnectionLine";
import { DiagnosticsBar } from "./DiagnosticsBar";
import { edgeTypeFor, toCanvasEdge } from "./edgeTypes";
import { FlowCanvas, decorateCanvasEdge } from "./FlowCanvas";
import { NodePaletteMenu } from "./NodePaletteMenu";
import {
  DECISION_SCHEMA,
  SAMPLE_CATALOG,
  SAMPLE_DIAGNOSTICS,
  SAMPLE_NODES,
  SAMPLE_RUN_STEPS,
  buildSampleRun,
  toCanvasEdges,
  toCanvasNodes,
} from "./sampleWorkflow";
import { SelectionToolbar } from "./SelectionToolbar";
import type {
  CanvasEdge,
  CanvasEdgeState,
  CanvasLayout,
  CanvasNode,
  CanvasPoint,
  NodeDefinitionView,
} from "./types";

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

function Frame({
  children,
  className,
  height = 560,
}: {
  children: ReactNode;
  className?: string;
  height?: number;
}) {
  return (
    <div
      className={cn("overflow-hidden rounded-lg border border-border shadow-1", className)}
      style={{ height }}
    >
      {children}
    </div>
  );
}

const STEP_MS = 700;
const SAMPLE_CANVAS_EDGES = toCanvasEdges();

function layoutInitial(): CanvasNode[] {
  const sized = toCanvasNodes().map((n) => ({
    ...n,
    height: estimateNodeHeight(n.data.node, true),
  }));
  return applyAutoLayout(sized, SAMPLE_CANVAS_EDGES, { nodeGap: 40, layerGap: 96 }).map(
    ({ height: _h, ...n }) => n,
  );
}

const STRUCTURAL_KINDS: ReadonlySet<string> = new Set<NodeKind>([
  "input",
  "output",
  "branch",
  "join",
  "loop",
  "foreach",
  "subflow",
  "wait",
  "human",
  "note",
]);

function isNodeKind(value: string): value is NodeKind {
  return STRUCTURAL_KINDS.has(value) || value === "task";
}

function nodeFromDefinition(def: NodeDefinitionView, id: string): WorkflowNodeView {
  const kind: NodeKind = isNodeKind(def.kind) ? def.kind : "task";
  const decisionOut = def.category === "decision" || def.kind === "flowaid.safety.guard";
  return {
    id,
    kind,
    ...(kind === "task" ? { nodeType: def.kind } : null),
    category: def.category,
    name: def.name,
    description: def.description,
    provider: def.provider,
    inputs:
      kind === "input" || kind === "note" || kind === "wait"
        ? []
        : [{ id: "input", label: "input", type: "any" }],
    outputs:
      kind === "note" || kind === "output"
        ? []
        : [
            decisionOut
              ? { id: "decision", label: "decision", type: "decision", schema: DECISION_SCHEMA }
              : { id: "output", label: "output", type: "any" },
          ],
  };
}

/**
 * Adds the edge for a new connection. A data connection into a port that is already bound by a
 * `ref` replaces that binding (UI.md §4.2, "rebinding replaces"); `isValidConnection` has already
 * rejected ports bound by templates or expressions.
 */
function connect(edges: CanvasEdge[], c: Connection): CanvasEdge[] {
  const kind = edgeTypeFor(c);
  const view: WorkflowEdgeView = {
    id: `${kind === "control" ? "c" : "d"}-${c.source}-${c.sourceHandle ?? ""}-${c.target}-${c.targetHandle ?? ""}`,
    kind,
    source: c.source,
    target: c.target,
    ...(c.sourceHandle ? { sourceHandle: c.sourceHandle } : null),
    ...(c.targetHandle ? { targetHandle: c.targetHandle } : null),
  };
  const kept =
    kind === "data"
      ? edges.filter((e) => !(e.target === c.target && e.targetHandle === c.targetHandle))
      : edges;
  return [...kept, toCanvasEdge(view)];
}

function WorkflowExample() {
  const [initial] = useState(layoutInitial);
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>(initial);
  const [edges, setEdges, onEdgesChange] = useEdgesState<CanvasEdge>(SAMPLE_CANVAS_EDGES);
  const [progress, setProgress] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [recent, setRecent] = useState<string[]>(["flowaid.decision.choice", "flowaid.tools.http"]);
  const [note, setNote] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const total = SAMPLE_RUN_STEPS.length;

  useEffect(() => {
    if (!playing) return;
    const t = window.setInterval(() => {
      setProgress((p) => {
        const next = (p ?? 0) + 1;
        if (next >= total) {
          setPlaying(false);
          return total;
        }
        return next;
      });
    }, STEP_MS);
    return () => window.clearInterval(t);
  }, [playing, total]);

  const run = useMemo(() => (progress === null ? undefined : buildSampleRun(progress)), [progress]);

  const onConnect = useCallback((c: Connection) => setEdges((eds) => connect(eds, c)), [setEdges]);

  const onAddNode = useCallback(
    (def: NodeDefinitionView, position: CanvasPoint) => {
      const id =
        `${def.kind.split(".").pop() ?? "node"}_${Date.now().toString(36).slice(-4)}`.replace(
          /[^a-z0-9_]/g,
          "_",
        );
      setNodes((ns) => [
        ...ns.map((n) => ({ ...n, selected: false })),
        { ...toFlowNode(nodeFromDefinition(def, id), position), selected: true },
      ]);
      setRecent((r) => [def.kind, ...r.filter((k) => k !== def.kind)].slice(0, 5));
      setNote(`added ${def.name} at ${Math.round(position.x)}, ${Math.round(position.y)}`);
    },
    [setNodes],
  );

  const onDuplicateNodes = useCallback(
    (selected: CanvasNode[]) => {
      setNodes((ns) => [
        ...ns.map((n) => ({ ...n, selected: false })),
        ...selected.map((n) => {
          const id = `${n.id}_copy`;
          const copy = toFlowNode(
            { ...n.data.node, id, name: `${n.data.node.name} copy` },
            { x: n.position.x + 24, y: n.position.y + 24 },
          );
          return { ...copy, selected: true };
        }),
      ]);
    },
    [setNodes],
  );

  const play = () => {
    if (progress === null || progress >= total) setProgress(0);
    setPlaying(true);
  };
  const step = () => {
    setPlaying(false);
    setProgress((p) => Math.min(total, (p ?? 0) + 1));
  };
  const reset = () => {
    setPlaying(false);
    setProgress(null);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {playing ? (
          <Button variant="primary" onClick={() => setPlaying(false)}>
            Pause
          </Button>
        ) : (
          <Button
            variant="primary"
            leadingIcon={<Play strokeWidth={1.75} aria-hidden="true" />}
            onClick={play}
          >
            {progress === null ? "Play run" : progress >= total ? "Replay" : "Resume"}
          </Button>
        )}
        <Button
          leadingIcon={<SkipForward strokeWidth={1.75} aria-hidden="true" />}
          onClick={step}
          disabled={progress !== null && progress >= total}
        >
          Step
        </Button>
        <Button
          variant="ghost"
          leadingIcon={<RotateCcw strokeWidth={1.75} aria-hidden="true" />}
          onClick={reset}
          disabled={progress === null}
        >
          Reset
        </Button>
        <Checkbox
          label="Follow run"
          checked={follow}
          onCheckedChange={(v) => setFollow(v === true)}
          className="ml-1"
        />
        {run ? (
          <div className="ml-auto flex flex-wrap items-center gap-3 font-mono text-2xs text-ink-3 tabular">
            <StatusChip status={run.status} size="sm" />
            <span>
              {progress ?? 0}/{total} nodes
            </span>
            <span>{formatMs(run.durationMs ?? 0)}</span>
            <span>{formatCost(run.costUsd ?? 0)}</span>
            {run.pendingApproval ? (
              <span className="text-cat-human">{run.pendingApproval.reason}</span>
            ) : null}
          </div>
        ) : (
          <span className="ml-auto font-mono text-2xs text-ink-3">
            {note ??
              "right-click the canvas or press ⌘K to add a node · Tab to a node, C connects, Enter inspects"}
          </span>
        )}
      </div>
      <Frame>
        <FlowCanvas
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          run={run}
          followRun={follow}
          catalog={SAMPLE_CATALOG}
          recentKinds={recent}
          onAddNode={onAddNode}
          onAskBuilder={(query, position) =>
            setNote(
              `builder asked “${query || "describe the node"}” at ${Math.round(position.x)}, ${Math.round(position.y)}`,
            )
          }
          onDuplicateNodes={onDuplicateNodes}
          onOpenInspector={(node) =>
            setNote(`Enter on ${node.data.node.name}: open it in the inspector`)
          }
          diagnostics={SAMPLE_DIAGNOSTICS}
        />
      </Frame>
    </div>
  );
}

function pairNode(
  id: string,
  name: string,
  category: WorkflowNodeView["category"],
  nodeType: string,
  description: string,
): WorkflowNodeView {
  return {
    id,
    kind: "task",
    nodeType,
    category,
    name,
    description,
    inputs: [{ id: "input", label: "input", type: "any" }],
    outputs: [{ id: "output", label: "output", type: "any" }],
  };
}

type EdgeSample = {
  label: string;
  category?: WorkflowNodeView["category"];
  edge: Omit<WorkflowEdgeView, "id" | "source" | "target"> & { state: CanvasEdgeState };
};

const EDGE_STATES: EdgeSample[] = [
  {
    label: "router exit · p 1.00",
    edge: { kind: "control", route: "done", probability: 1, label: "p 1.00", state: "idle" },
  },
  {
    label: "router exit · p 0.42",
    edge: { kind: "control", route: "done", probability: 0.42, label: "p 0.42", state: "idle" },
  },
  {
    label: "router exit · p 0.18",
    edge: { kind: "control", route: "done", probability: 0.18, label: "p 0.18", state: "idle" },
  },
  {
    label: "router exit · taken",
    category: "decision",
    edge: {
      kind: "control",
      route: "done",
      probability: 0.81,
      label: "security 0.81",
      state: "taken",
    },
  },
  { label: "control · idle", edge: { kind: "control", route: "done", state: "idle" } },
  { label: "control · active", edge: { kind: "control", route: "done", state: "active" } },
  { label: "control · fired", edge: { kind: "control", route: "done", state: "taken" } },
  { label: "control · pruned", edge: { kind: "control", route: "done", state: "not-taken" } },
  { label: "control · error", edge: { kind: "control", route: "done", state: "error" } },
  { label: "data · ref", edge: { kind: "data", via: "ref", state: "idle" } },
  { label: "data · delivered", edge: { kind: "data", via: "ref", state: "taken" } },
  { label: "data · template (implicit)", edge: { kind: "data", via: "template", state: "idle" } },
];

function EdgeStatesExample() {
  const [initialNodes] = useState<CanvasNode[]>(() =>
    EDGE_STATES.flatMap((s, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = col * 640;
      const y = row * 140;
      return [
        toFlowNode(
          pairNode(
            `a${i}`,
            "Source",
            s.category ?? "data",
            s.category === "decision" ? "flowaid.decision.choice" : "flowaid.data.transform",
            s.label,
          ),
          { x, y },
        ),
        toFlowNode(pairNode(`b${i}`, "Target", "tool", "flowaid.tools.http", s.label), {
          x: x + 336,
          y,
        }),
      ];
    }),
  );
  const [initialEdges] = useState<CanvasEdge[]>(() =>
    EDGE_STATES.map((s, i) => {
      const { state, ...view } = s.edge;
      const control = view.kind === "control";
      const edge = toCanvasEdge({
        ...view,
        id: `e${i}`,
        source: `a${i}`,
        target: `b${i}`,
        sourceHandle: control ? "ctl:done" : "out:output",
        targetHandle: control ? "ctl-in" : "in:input",
      });
      return decorateCanvasEdge(edge, state, s.category);
    }),
  );
  const [nodes, , onNodesChange] = useNodesState<CanvasNode>(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState<CanvasEdge>(initialEdges);
  return (
    <Frame height={520}>
      <FlowCanvas
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        defaultShowMinimap={false}
        locked
      />
    </Frame>
  );
}

const MINI_NODES: WorkflowNodeView[] = [
  {
    id: "m_urgency",
    kind: "task",
    nodeType: "flowaid.decision.score",
    category: "decision",
    name: "Urgency",
    description: "Outputs a DecisionResult",
    provider: "jev-latest",
    inputs: [{ id: "state", label: "message", type: "object", schema: { type: "object" } }],
    outputs: [{ id: "decision", label: "decision", type: "decision", schema: DECISION_SCHEMA }],
  },
  {
    id: "m_draft",
    kind: "task",
    nodeType: "flowaid.ai.generate",
    category: "generation",
    name: "Draft reply",
    description: "Accepts any object",
    provider: "gpt-5-mini",
    inputs: [{ id: "context", label: "context", type: "object", schema: { type: "object" } }],
    outputs: [{ id: "text", label: "reply", type: "string", schema: { type: "string" } }],
  },
  {
    id: "m_send",
    kind: "task",
    nodeType: "flowaid.tools.http",
    category: "tool",
    name: "Send reply",
    description: "Accepts a string only",
    provider: "zendesk_prod",
    inputs: [{ id: "body", label: "reply", type: "string", schema: { type: "string" } }],
    outputs: [],
  },
];

function ValidationExample() {
  const [initial] = useState<CanvasNode[]>(() =>
    MINI_NODES.map((node, i) =>
      toFlowNode(node, i === 0 ? { x: 0, y: 72 } : { x: 336, y: i === 1 ? 0 : 180 }),
    ),
  );
  const [nodes, , onNodesChange] = useNodesState<CanvasNode>(initial);
  const [edges, setEdges, onEdgesChange] = useEdgesState<CanvasEdge>([]);
  const onConnect = useCallback((c: Connection) => setEdges((eds) => connect(eds, c)), [setEdges]);
  return (
    <Frame height={340}>
      <FlowCanvas
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        defaultShowMinimap={false}
      />
    </Frame>
  );
}

function ConnectionLineStates() {
  const states = [
    { status: null, label: "pending" },
    { status: "valid", label: "valid: DecisionResult ⊆ object" },
    { status: "invalid", label: "invalid: DecisionResult ⊄ string" },
  ] as const;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {states.map((s) => (
        <div
          key={s.label}
          className="canvas-grid flex flex-col gap-1 rounded-md border border-border p-3"
        >
          <svg viewBox="0 0 200 64" className="h-16 w-full" aria-hidden="true">
            <circle cx={12} cy={32} r={4} fill="var(--accent)" />
            <ConnectionLinePath
              fromX={12}
              fromY={32}
              toX={188}
              toY={s.status === null ? 20 : 44}
              status={s.status}
            />
          </svg>
          <span className="font-mono text-2xs text-ink-3">{s.label}</span>
        </div>
      ))}
    </div>
  );
}

function PaletteExample() {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAnchor({ x: r.left, y: r.bottom });
          setOpen(true);
        }}
      >
        Open palette
      </Button>
      <span className="font-mono text-2xs text-ink-3">
        {picked ? `picked ${picked}` : "search “http”, “yes”, “guard” or arrow through the groups"}
      </span>
      <NodePaletteMenu
        open={open}
        onOpenChange={setOpen}
        anchor={anchor}
        catalog={SAMPLE_CATALOG}
        recent={["flowaid.decision.choice", "flowaid.tools.http", "human"]}
        onPick={(def) => setPicked(def.kind)}
        onAskBuilder={(q) => setPicked(`builder:“${q}”`)}
      />
    </div>
  );
}

function StaticChrome() {
  const [zoom, setZoom] = useState(1);
  const [locked, setLocked] = useState(false);
  const [minimap, setMinimap] = useState(true);
  const [last, setLast] = useState("—");
  return (
    <div className="flex flex-wrap items-start gap-8">
      <div className="flex flex-col gap-2">
        <span className="font-mono text-2xs text-ink-3">CanvasControls</span>
        <div className="canvas-grid rounded-md border border-border p-4">
          <CanvasControls
            zoom={zoom}
            onZoomIn={() => setZoom((z) => Math.min(2, z * 1.2))}
            onZoomOut={() => setZoom((z) => Math.max(0.25, z / 1.2))}
            onResetZoom={() => setZoom(1)}
            onFitView={() => setZoom(0.78)}
            locked={locked}
            onToggleLock={() => setLocked((v) => !v)}
            onAutoLayout={() => setLast("auto layout")}
            minimapVisible={minimap}
            onToggleMinimap={() => setMinimap((v) => !v)}
          />
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="font-mono text-2xs text-ink-3">SelectionToolbar · {last}</span>
        <div className="canvas-grid flex flex-wrap gap-4 rounded-md border border-border p-4">
          <SelectionToolbar
            count={3}
            onAlign={(k) => setLast(`align ${k}`)}
            onDistribute={(a) => setLast(`distribute ${a}`)}
            onGroup={() => setLast("group")}
            onDelete={() => setLast("delete")}
          />
          <SelectionToolbar
            count={2}
            onAlign={(k) => setLast(`align ${k}`)}
            onDistribute={(a) => setLast(`distribute ${a}`)}
            onDelete={() => setLast("delete")}
          />
        </div>
      </div>
    </div>
  );
}

function DiagnosticsExample() {
  const [focused, setFocused] = useState<string | null>(null);
  const name = (id: string) => SAMPLE_NODES.find((n) => n.id === id)?.name;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="flex flex-col gap-2">
        <span className="font-mono text-2xs text-ink-3">
          collapsed · {focused ? `focused ${focused}` : "click a row to focus its node"}
        </span>
        <div className="overflow-hidden rounded-md border border-border">
          <DiagnosticsBar
            diagnostics={SAMPLE_DIAGNOSTICS}
            nodeName={name}
            onFocusNode={setFocused}
            onFocusEdge={setFocused}
            className="border-t-0"
          />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <span className="font-mono text-2xs text-ink-3">open</span>
        <div className="overflow-hidden rounded-md border border-border">
          <DiagnosticsBar
            diagnostics={SAMPLE_DIAGNOSTICS}
            nodeName={name}
            onFocusNode={setFocused}
            onFocusEdge={setFocused}
            defaultOpen
            className="border-t-0"
          />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <span className="font-mono text-2xs text-ink-3">clean</span>
        <div className="overflow-hidden rounded-md border border-border">
          <DiagnosticsBar diagnostics={[]} className="border-t-0" />
        </div>
      </div>
    </div>
  );
}

const RESEARCH_BY_ID = new Map(researchAgentNodes.map((n) => [n.id, n]));

/** The research agent's mid-run log folded into a run: `research` 3/5, `search_all` 3/4. */
function researchRun(): RunView {
  const folded = foldRunEvents(researchAgentEvents(), {
    nodeNameFor: (id) => RESEARCH_BY_ID.get(id)?.name ?? id,
    categoryFor: (id) => RESEARCH_BY_ID.get(id)?.category ?? "flow",
  });
  return {
    id: "0192f0a1-5b3c-7d4e-8f60-1a2b3c4d5e6f",
    workflowId: "b4d6f8a0-2c4e-4a6b-8d0f-1e3a5c7b9d2f",
    workflowName: "Research Agent",
    version: 3,
    status: folded.status ?? "running",
    origin: "ui",
    createdAt: "2026-09-22T10:00:00.000Z",
    nodeRuns: folded.nodeRuns,
  };
}

/** Compound auto layout of the research agent: bodies inside their frames, frames fitted around them. */
function researchLayout(): CanvasLayout {
  const { positions, sizes } = autoLayout(
    researchAgentNodes.map((n) => ({
      id: n.id,
      ...(n.parent !== undefined ? { parent: n.parent } : null),
      height: estimateNodeHeight(n),
    })),
    researchAgentDependencies,
    { nodeGap: 32, layerGap: 72 },
  );
  const nodes: CanvasLayout["nodes"] = {};
  for (const n of researchAgentNodes) {
    const p = positions.get(n.id) ?? { x: 0, y: 0 };
    const size = sizes.get(n.id);
    nodes[n.id] = size ? { x: p.x, y: p.y, w: size.width, h: size.height } : { x: p.x, y: p.y };
  }
  return { nodes };
}

function formatPlacement(p: CanvasLayout["nodes"][string] | undefined): string {
  if (!p) return "unset";
  return `${Math.round(p.x)}, ${Math.round(p.y)}${p.w !== undefined && p.h !== undefined ? ` · ${Math.round(p.w)} × ${Math.round(p.h)}` : ""}`;
}

function ContainersExample() {
  const run = useMemo(() => researchRun(), []);
  const [initialLayout] = useState<CanvasLayout>(researchLayout);
  const [layout, setLayout] = useState<CanvasLayout>(initialLayout);
  const [status, setStatus] = useState<string>(
    "drop a node into a frame, or hold ⌥ and drag one out",
  );
  const extras = useMemo(
    () => ({
      onSelectIteration: (id: string, it: IterationView) =>
        setStatus(`inspector shows ${id} · ${it.scope} (${it.status})`),
    }),
    [],
  );
  const build = useCallback(
    (node: WorkflowNodeView, placement: CanvasLayout["nodes"][string]): CanvasNode =>
      toFlowNode(
        node,
        placement,
        undefined,
        cardVariantFor(node) === "container" ? extras : undefined,
      ),
    [extras],
  );
  const initialNodes = useMemo(
    () => researchAgentNodes.map((n) => build(n, initialLayout.nodes[n.id] ?? { x: 0, y: 0 })),
    [build, initialLayout],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState<CanvasEdge>(researchAgentEdges.map(toCanvasEdge));
  const handleNodesChange = useCallback(
    (changes: NodeChange<CanvasNode>[]) => {
      onNodesChange(changes);
      setLayout((current) => applyLayoutChanges(current, changes));
    },
    [onNodesChange],
  );
  const onSetParent = useCallback(
    (ids: string[], parent: string | undefined, positions: Record<string, CanvasPoint>) => {
      setNodes((current) =>
        current.map((n) => {
          const position = positions[n.id];
          if (!ids.includes(n.id) || !position) return n;
          const { parent: _previous, ...rest } = n.data.node;
          const node: WorkflowNodeView = parent !== undefined ? { ...rest, parent } : rest;
          return { ...build(node, { ...position, w: n.width, h: n.height }), selected: n.selected };
        }),
      );
      setLayout((current) => {
        const next = { ...current.nodes };
        for (const id of ids) {
          const position = positions[id];
          if (position) next[id] = { ...next[id], ...position };
        }
        return { ...current, nodes: next };
      });
      setStatus(`setParent([${ids.join(", ")}], ${parent ?? "top level"})`);
    },
    [setNodes, build],
  );
  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono text-2xs text-ink-3" aria-live="polite">
        {status}
      </span>
      <Frame height={520}>
        <FlowCanvas
          nodes={nodes}
          edges={edges}
          onNodesChange={handleNodesChange}
          onEdgesChange={onEdgesChange}
          onSetParent={onSetParent}
          run={run}
          defaultShowMinimap={false}
        />
      </Frame>
      <p className="font-mono text-2xs text-ink-3 tabular" data-layout-readout>
        layout.nodes.research = {formatPlacement(layout.nodes.research)} · layout.nodes.search_all ={" "}
        {formatPlacement(layout.nodes.search_all)}
      </p>
    </div>
  );
}

function EmptyExample() {
  const [nodes, , onNodesChange] = useNodesState<CanvasNode>([]);
  const [edges, , onEdgesChange] = useEdgesState<CanvasEdge>([]);
  const [last, setLast] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono text-2xs text-ink-3">{last ?? "the three ways to start"}</span>
      <Frame height={400}>
        <FlowCanvas
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          catalog={SAMPLE_CATALOG}
          onAddNode={(def) => setLast(`add ${def.kind}`)}
          onStartFromTemplate={() => setLast("start from template")}
          onAskBuilder={(q) => setLast(`describe to builder: “${q}”`)}
          fitViewOnInit={false}
        />
      </Frame>
    </div>
  );
}

export default function CanvasGallery() {
  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-10 p-6 sm:p-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-lg font-semibold tracking-tight">Canvas</h1>
        <p className="max-w-2xl text-sm text-ink-2">
          The workflow canvas: React Flow themed with the tokens, the node group&apos;s cards with
          prefixed handles (out:, in:, ctl:, ctl-in), dashed control edges (weighted by probability
          on router exits), solid data edges and live execution state from a run.
        </p>
      </header>

      <Section
        id="workflow"
        title="Workflow canvas · support triage"
        caption="Thirteen nodes laid out by autoLayout, with control edges from the definition and data edges from the bindings (template and expression references dotted). Play run steps a simulated RunView through the graph every 700 ms: edges into the running node flow, fired control edges tint green, pruned ones fade, decision cards fill in their distributions and the human node waits. Right-click, ⌘K or / opens the palette; drag on the pane selects; space or middle button pans."
      >
        <WorkflowExample />
      </Section>

      <Section
        id="edges"
        title="Control and data edges"
        caption="Control edges are dashed with an arrowhead into the control-in notch; fired edges tint green, pruned edges fade to 30 %. Router exits are weighted: opacity and width follow the probability like the mark's branches (1.00 / 0.42 / 0.18) and a taken exit takes the source category's hue. Data edges are solid; template and expression references are dotted and cannot be selected. Hover a data edge for its schema."
      >
        <EdgeStatesExample />
      </Section>

      <Section
        id="validation"
        title="Connection validation"
        caption="Validation runs isSubschema on the port schemas. Drag from Urgency's decision output: Draft reply's object port lights up and the line turns green; Send reply's string port fades and hovering it shows the reason. Control-outs only reach control-ins; self loops and duplicate edges are rejected too."
      >
        <ValidationExample />
        <ConnectionLineStates />
      </Section>

      <Section
        id="palette"
        title="Node palette"
        caption="Grouped by category with a Recent group first; fuzzy search over name, description, kind and category; the last row always hands the query to the AI builder."
      >
        <PaletteExample />
      </Section>

      <Section
        id="chrome"
        title="Controls and selection toolbar"
        caption="Compact vertical control stack with a mono zoom readout; a floating toolbar above multi-selections for align, distribute, group and delete."
      >
        <StaticChrome />
      </Section>

      <Section
        id="diagnostics"
        title="Diagnostics bar"
        caption="A slim bar under the canvas with counts by severity. Opening it lists every diagnostic; a row focuses the node or edge it points at."
      >
        <DiagnosticsExample />
      </Section>

      <Section
        id="containers"
        title="Containers · research agent"
        caption="Loop and foreach nodes are frames their bodies sit in; auto layout (⇧L) lays each body out inside its frame and fits the frame around it. Badges read 3/5 and 3/4 from the folded LOOP_ITERATION_* and FOREACH_ITEM_COMPLETED events and the stepper picks the iteration the inspector shows. Select a frame and drag a corner to resize it (the readout is layout.nodes[id].w/h); drop a node into a frame, or hold ⌥ and drag one out, to call onSetParent."
      >
        <ContainersExample />
      </Section>

      <Section
        id="empty"
        title="Empty state"
        caption="An empty canvas offers the palette, a template and the AI builder."
      >
        <EmptyExample />
      </Section>
    </div>
  );
}
