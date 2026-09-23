import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import {
  Background,
  BackgroundVariant,
  MiniMap,
  Panel as FlowPanel,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  getNodesBounds,
  useReactFlow,
  useStore,
  useViewport,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type OnConnect,
  type OnEdgesChange,
  type OnNodeDrag,
  type OnNodesChange,
} from "@xyflow/react";
import { useReducedMotion } from "motion/react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  CONTAINER_DEFAULT_HEIGHT,
  CONTAINER_DEFAULT_WIDTH,
  NODE_WIDTH,
  flowNodeTypeFor,
  flowNodeVariant,
  nodeTypes,
  orderParentsFirst,
  type NodeCardExtras,
} from "@/node";
import { Button, Shortcut } from "@/primitives";
import { ShortcutProvider, useShortcut, type ShortcutOptions } from "@/primitives/shortcuts";
import type { NodeCategory } from "@/lib/categories";
import type { DataEdgeVia, Diagnostic, RunView, WorkflowNodeView } from "@/types";
import { autoLayout, estimateNodeHeight } from "./autoLayout";
import { CanvasControls } from "./CanvasControls";
import {
  CANVAS_SHORTCUTS,
  CANVAS_SHORTCUT_GROUP,
  canvasShortcutSummary,
  focusedNodeElement,
  isCanvasShortcutTarget,
  isCanvasSurfaceTarget,
  type CanvasShortcutId,
} from "./canvasShortcuts";
import { ConnectPicker } from "./ConnectPicker";
import { CanvasEmptyState } from "./CanvasEmptyState";
import { ConnectionLine } from "./ConnectionLine";
import { frameAt, isInside, planParentDrops, type DroppedBox, type FlowBox } from "./containers";
import { deriveCanvasRunState } from "./deriveCanvasRunState";
import { DiagnosticsBar } from "./DiagnosticsBar";
import {
  alignNodes,
  distributeNodes,
  type AlignKind,
  type BoxedNode,
  type DistributeAxis,
} from "./geometry";
import { NodePaletteMenu } from "./NodePaletteMenu";
import { SelectionToolbar } from "./SelectionToolbar";
import { edgeTypeFor, edgeTypes } from "./edgeTypes";
import type {
  CanvasEdge,
  CanvasEdgeState,
  CanvasNode,
  CanvasPoint,
  ControlCanvasEdge,
  DataCanvasEdge,
  NodeDefinitionView,
} from "./types";
import { useConnectionValidation } from "./useConnectionValidation";
import "./canvas.css";

export const CANVAS_MIN_ZOOM = 0.25;
export const CANVAS_MAX_ZOOM = 2;
export const CANVAS_SNAP = 8;

export interface FlowCanvasProps {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  onNodesChange: OnNodesChange<CanvasNode>;
  onEdgesChange: OnEdgesChange<CanvasEdge>;
  onConnect?: OnConnect;
  /** When present, nodes and edges are decorated with execution state. */
  run?: RunView;
  /** Pan to the running or waiting node (at a readable zoom) as the run advances; fit again when the run is cleared. */
  followRun?: boolean;
  /** Node definitions offered by the palette. Omit to hide the palette. */
  catalog?: NodeDefinitionView[];
  /** Recently used kinds for the palette, most recent first. */
  recentKinds?: string[];
  onAddNode?: (def: NodeDefinitionView, position: CanvasPoint) => void;
  onAskBuilder?: (query: string, position: CanvasPoint) => void;
  onStartFromTemplate?: () => void;
  /** ⌘D on a selection. */
  onDuplicateNodes?: (nodes: CanvasNode[]) => void;
  /** "Group into subflow" on the selection toolbar (⌘G). */
  onGroupNodes?: (nodes: CanvasNode[]) => void;
  /**
   * Nodes were dropped into a container frame (loop/foreach), or out of one onto the top level
   * (`parent` undefined): the app calls its `setParent(ids, parent)` action and moves each node to
   * `positions[id]`, which is relative to the new frame (UI.md §4.2). Children are held inside
   * their frame (`extent: 'parent'`); holding ⌥/Alt while dragging lets them leave it.
   */
  onSetParent?: (
    ids: string[],
    parent: string | undefined,
    positions: Record<string, CanvasPoint>,
  ) => void;
  onNodeDoubleClick?: (node: CanvasNode) => void;
  /**
   * Enter on a focused node: open it in the inspector. Defaults to `onNodeDoubleClick`, the
   * pointer path to the same place.
   */
  onOpenInspector?: (node: CanvasNode) => void;
  onSelectionChange?: (selection: { nodes: CanvasNode[]; edges: CanvasEdge[] }) => void;
  diagnostics?: Diagnostic[];
  /** Controlled lock; when omitted the lock control keeps its own state. */
  locked?: boolean;
  onLockedChange?: (locked: boolean) => void;
  defaultShowMinimap?: boolean;
  /** Fit the graph on first render. */
  fitViewOnInit?: boolean;
  /** Extra React Flow panels or overlays. */
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

interface PaletteState {
  screen: { x: number; y: number } | null;
  flow: CanvasPoint;
}

export { isCanvasShortcutTarget };

/** The keyboard connect list: the node it starts from and where it is anchored. */
interface ConnectState {
  nodeId: string;
  element: HTMLElement;
  anchor: { x: number; y: number };
  /** Kept (closed) after the list closes, so focus can return to `element`. */
  open: boolean;
}

function snap(v: number): number {
  return Math.round(v / CANVAS_SNAP) * CANVAS_SNAP;
}

function toBoxed(n: CanvasNode): BoxedNode {
  return {
    id: n.id,
    x: n.position.x,
    y: n.position.y,
    width: n.measured?.width ?? n.width ?? 232,
    height:
      n.measured?.height ??
      n.height ??
      estimateNodeHeight(n.data.node, n.data.run?.decision !== undefined),
  };
}

function viaOf(data: CanvasEdge["data"]): DataEdgeVia {
  const v = data?.via;
  return v === "template" || v === "expr" || v === "hoisted" ? v : "ref";
}

/**
 * The edge as the canvas draws it: `type` from its kind (`WorkflowEdgeView.kind` or its handle ids),
 * the run state and source category in `data`, and implicit data edges (`via !== "ref"`) made
 * non-selectable, non-focusable and non-deletable.
 */
export function decorateCanvasEdge(
  edge: CanvasEdge,
  state: CanvasEdgeState,
  category: NodeCategory | undefined,
): CanvasEdge {
  if (edgeTypeFor(edge) === "control") {
    if (edge.type === "control" && edge.data?.state === state && edge.data.category === category)
      return edge;
    const next: ControlCanvasEdge = {
      ...edge,
      type: "control",
      data: { ...edge.data, state, category },
    };
    return next;
  }
  const via = viaOf(edge.data);
  const implicit = via !== "ref";
  if (
    edge.type === "data" &&
    edge.data?.state === state &&
    edge.data.category === category &&
    edge.data.via === via &&
    (!implicit || edge.selectable === false)
  ) {
    return edge;
  }
  const next: DataCanvasEdge = {
    ...edge,
    type: "data",
    data: { ...edge.data, via, state, category },
    ...(implicit ? { selectable: false, focusable: false, deletable: false } : null),
  };
  return next;
}

function FlowCanvasInner({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onConnect,
  run,
  followRun = false,
  catalog,
  recentKinds,
  onAddNode,
  onAskBuilder,
  onStartFromTemplate,
  onDuplicateNodes,
  onGroupNodes,
  onSetParent,
  onNodeDoubleClick,
  onOpenInspector,
  onSelectionChange,
  diagnostics = [],
  locked: lockedProp,
  onLockedChange,
  defaultShowMinimap = true,
  fitViewOnInit = true,
  children,
  className,
  style,
}: FlowCanvasProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const flow = useReactFlow<CanvasNode, CanvasEdge>();
  const { x: vx, y: vy, zoom } = useViewport();
  /** Pane width from the flow store (the wrapper's width), read reactively instead of from the ref during render. */
  const paneWidth = useStore((s) => s.width);
  const reduceMotion = useReducedMotion() ?? false;
  const duration = reduceMotion ? 0 : 300;

  const [lockedState, setLockedState] = useState(false);
  const locked = lockedProp ?? lockedState;
  const setLocked = useCallback(
    (next: boolean) => {
      if (lockedProp === undefined) setLockedState(next);
      onLockedChange?.(next);
    },
    [lockedProp, onLockedChange],
  );
  const [showMinimap, setShowMinimap] = useState(defaultShowMinimap);
  const [palette, setPalette] = useState<PaletteState | null>(null);

  // --- connection validation -------------------------------------------
  const workflowNodes = useMemo<WorkflowNodeView[]>(() => nodes.map((n) => n.data.node), [nodes]);
  const validation = useConnectionValidation(workflowNodes, edges);
  const { pending, compatibleHandles, handleReasons } = validation;

  // --- run decoration ---------------------------------------------------
  const runState = useMemo(
    () =>
      deriveCanvasRunState(
        nodes,
        edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle,
          kind: edgeTypeFor(e),
          route: e.type === "control" ? e.data?.route : undefined,
        })),
        run,
      ),
    [nodes, edges, run],
  );
  // One id → node map per `nodes` change: diagnostics rows, the connect list and focus
  // lookups resolve names in O(1) instead of scanning the array per row.
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n] as const)), [nodes]);
  const categoryOf = useMemo(
    () => new Map(nodes.map((n) => [n.id, n.data.node.category])),
    [nodes],
  );

  // --- containers -------------------------------------------------------
  /** ⌥/Alt held: children may be dragged out of their frame (their `extent` is lifted). */
  const [detaching, setDetaching] = useState(false);
  const [dropTarget, setDropTarget] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!onSetParent) return;
    const onKey = (e: KeyboardEvent) => setDetaching(e.altKey);
    const reset = () => setDetaching(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("blur", reset);
    };
  }, [onSetParent]);

  const parentOf = useMemo(() => {
    const map = new Map(nodes.map((n) => [n.id, n.parentId ?? n.data.node.parent]));
    return (id: string) => map.get(id);
  }, [nodes]);

  /** Absolute boxes of the container frames, from xyflow's measured internals. */
  const frameBoxes = useCallback((): FlowBox[] => {
    const out: FlowBox[] = [];
    for (const n of nodes) {
      if (n.type !== "container" && flowNodeVariant(n.data) !== "container") continue;
      const internal = flow.getInternalNode(n.id);
      if (!internal) continue;
      out.push({
        id: n.id,
        x: internal.internals.positionAbsolute.x,
        y: internal.internals.positionAbsolute.y,
        width: internal.measured.width ?? n.width ?? CONTAINER_DEFAULT_WIDTH,
        height: internal.measured.height ?? n.height ?? CONTAINER_DEFAULT_HEIGHT,
      });
    }
    return out;
  }, [nodes, flow]);

  /** Dragged nodes at their current position, in absolute flow coordinates. */
  const droppedBoxes = useCallback(
    (dragged: CanvasNode[]): DroppedBox[] =>
      dragged.map((d) => {
        const parentId = d.parentId;
        const origin = parentId
          ? flow.getInternalNode(parentId)?.internals.positionAbsolute
          : undefined;
        const box: DroppedBox = {
          id: d.id,
          x: (origin?.x ?? 0) + d.position.x,
          y: (origin?.y ?? 0) + d.position.y,
          width: d.measured?.width ?? d.width ?? NODE_WIDTH,
          height: d.measured?.height ?? d.height ?? estimateNodeHeight(d.data.node),
        };
        const parent = parentOf(d.id);
        if (parent !== undefined) box.parent = parent;
        return box;
      }),
    [flow, parentOf],
  );

  const onNodeDrag = useCallback<OnNodeDrag<CanvasNode>>(
    (_event, node, dragged) => {
      if (!onSetParent || locked) return;
      const primary = droppedBoxes(dragged.length ? dragged : [node]).find((b) => b.id === node.id);
      if (!primary) return;
      const moving = new Set(dragged.map((d) => d.id));
      const exclude = new Set(moving);
      const frames = frameBoxes();
      for (const f of frames)
        for (const id of moving) if (isInside(f.id, id, parentOf)) exclude.add(f.id);
      const target = frameAt(
        { x: primary.x + primary.width / 2, y: primary.y + primary.height / 2 },
        frames,
        parentOf,
        exclude,
      );
      const next = target && target.id !== primary.parent ? target.id : undefined;
      setDropTarget((prev) => (prev === next ? prev : next));
    },
    [onSetParent, locked, droppedBoxes, frameBoxes, parentOf],
  );

  const onNodeDragStop = useCallback<OnNodeDrag<CanvasNode>>(
    (_event, node, dragged) => {
      setDropTarget(undefined);
      if (!onSetParent || locked) return;
      const drops = planParentDrops(
        droppedBoxes(dragged.length ? dragged : [node]),
        frameBoxes(),
        parentOf,
      );
      for (const drop of drops) onSetParent(drop.ids, drop.parent, drop.positions);
    },
    [onSetParent, locked, droppedBoxes, frameBoxes, parentOf],
  );

  const viewNodes = useMemo<CanvasNode[]>(
    () =>
      orderParentsFirst(nodes).map((n) => {
        const r = run ? runState.nodes[n.id] : n.data.run;
        const type = n.type ?? flowNodeTypeFor(flowNodeVariant(n.data));
        const compatible =
          pending && pending.nodeId !== n.id ? (compatibleHandles.get(n.id) ?? []) : undefined;
        const reasons = compatible ? handleReasons.get(n.id) : undefined;
        const detach = detaching && n.extent === "parent";
        const target = dropTarget === n.id;
        let next = n;
        if (
          r !== n.data.run ||
          type !== n.type ||
          compatible !== undefined ||
          n.data.extras?.compatibleHandles !== undefined ||
          n.data.extras?.handleReasons !== undefined
        ) {
          const extras: NodeCardExtras | undefined =
            n.data.extras || compatible
              ? { ...n.data.extras, compatibleHandles: compatible, handleReasons: reasons }
              : undefined;
          next = { ...n, type, data: { ...n.data, run: r, extras } };
        }
        if (detach) {
          const { extent: _extent, ...free } = next;
          next = free;
        }
        if (target) next = { ...next, className: cn(next.className, "fa-frame-drop-target") };
        return next;
      }),
    [nodes, run, runState, pending, compatibleHandles, handleReasons, detaching, dropTarget],
  );
  const viewEdges = useMemo<CanvasEdge[]>(
    () =>
      edges.map((e) => {
        const state = run ? (runState.edges[e.id] ?? "idle") : (e.data?.state ?? "idle");
        const category = e.data?.category ?? categoryOf.get(e.source);
        return decorateCanvasEdge(e, state, category);
      }),
    [edges, run, runState, categoryOf],
  );

  // --- follow the run ---------------------------------------------------
  const activeNodeId = useMemo(() => {
    if (!run) return null;
    for (const [id, r] of Object.entries(runState.nodes)) {
      if (r.status === "running" || r.status === "retry_wait" || r.status === "waiting") return id;
    }
    return null;
  }, [run, runState]);
  const hadRun = useRef(false);
  useEffect(() => {
    if (!followRun) return;
    if (!run) {
      if (hadRun.current) void flow.fitView({ padding: 0.2, duration, maxZoom: 1 });
      hadRun.current = false;
      return;
    }
    hadRun.current = true;
    if (!activeNodeId) return;
    const node = flow.getInternalNode(activeNodeId);
    if (!node) return;
    const w = node.measured.width ?? 232;
    const h = node.measured.height ?? 96;
    const cx = node.internals.positionAbsolute.x + w / 2;
    const cy = node.internals.positionAbsolute.y + h / 2;
    void flow.setCenter(cx, cy, { zoom: Math.max(flow.getZoom(), 0.85), duration });
  }, [followRun, run, activeNodeId, flow, duration]);

  // --- selection --------------------------------------------------------
  const selectedNodes = useMemo(() => nodes.filter((n) => n.selected), [nodes]);
  const selectedEdges = useMemo(() => edges.filter((e) => e.selected), [edges]);
  // `nodes` changes on every drag frame; report a selection only when the selected id sets
  // change (the first render always reports, so the consumer starts in sync).
  const lastSelection = useRef<string | null>(null);
  useEffect(() => {
    const ids = (items: readonly { id: string }[]) =>
      items
        .map((x) => x.id)
        .sort()
        .join("\u0000");
    const key = `${ids(selectedNodes)}\u0001${ids(selectedEdges)}`;
    if (lastSelection.current === key) return;
    lastSelection.current = key;
    onSelectionChange?.({ nodes: selectedNodes, edges: selectedEdges });
  }, [selectedNodes, selectedEdges, onSelectionChange]);

  const selectAll = useCallback(() => {
    const nc: NodeChange<CanvasNode>[] = nodes
      .filter((n) => !n.selected)
      .map((n) => ({ type: "select", id: n.id, selected: true }));
    const ec: EdgeChange<CanvasEdge>[] = edges
      .filter((e) => !e.selected)
      .map((e) => ({ type: "select", id: e.id, selected: true }));
    if (nc.length) onNodesChange(nc);
    if (ec.length) onEdgesChange(ec);
  }, [nodes, edges, onNodesChange, onEdgesChange]);

  const clearSelection = useCallback(() => {
    const nc: NodeChange<CanvasNode>[] = selectedNodes.map((n) => ({
      type: "select",
      id: n.id,
      selected: false,
    }));
    const ec: EdgeChange<CanvasEdge>[] = selectedEdges.map((e) => ({
      type: "select",
      id: e.id,
      selected: false,
    }));
    if (nc.length) onNodesChange(nc);
    if (ec.length) onEdgesChange(ec);
  }, [selectedNodes, selectedEdges, onNodesChange, onEdgesChange]);

  const moveNodes = useCallback(
    (positions: Map<string, CanvasPoint>) => {
      const changes: NodeChange<CanvasNode>[] = [];
      for (const [id, position] of positions) changes.push({ type: "position", id, position });
      if (changes.length) onNodesChange(changes);
    },
    [onNodesChange],
  );

  const nudge = useCallback(
    (dx: number, dy: number) => {
      if (locked || selectedNodes.length === 0) return;
      const positions = new Map<string, CanvasPoint>();
      for (const n of selectedNodes)
        positions.set(n.id, { x: n.position.x + dx, y: n.position.y + dy });
      moveNodes(positions);
    },
    [locked, selectedNodes, moveNodes],
  );

  const deleteSelection = useCallback(() => {
    if (locked) return;
    void flow.deleteElements({ nodes: selectedNodes, edges: selectedEdges });
  }, [locked, flow, selectedNodes, selectedEdges]);

  const align = useCallback(
    (kind: AlignKind) => moveNodes(alignNodes(selectedNodes.map(toBoxed), kind)),
    [selectedNodes, moveNodes],
  );
  const distribute = useCallback(
    (axis: DistributeAxis) => moveNodes(distributeNodes(selectedNodes.map(toBoxed), axis)),
    [selectedNodes, moveNodes],
  );

  // --- viewport ---------------------------------------------------------
  const fit = useCallback(() => {
    void flow.fitView({ padding: 0.2, duration, maxZoom: 1 });
  }, [flow, duration]);

  const runAutoLayout = useCallback(() => {
    if (locked) return;
    const { positions, sizes } = autoLayout(
      nodes.map((n) => {
        const parent = n.parentId ?? n.data.node.parent;
        return {
          id: n.id,
          measured: n.measured,
          width: n.width,
          height: n.height ?? estimateNodeHeight(n.data.node, n.data.run?.decision !== undefined),
          ...(parent !== undefined ? { parent } : null),
        };
      }),
      edges,
      { nodeGap: 40, layerGap: 96 },
    );
    moveNodes(positions);
    // Fit each frame around its children (the NodeResizer's change shape → `layout.nodes[id].w/h`).
    const resized: NodeChange<CanvasNode>[] = [];
    for (const [id, dimensions] of sizes)
      resized.push({ type: "dimensions", id, dimensions, setAttributes: true });
    if (resized.length) onNodesChange(resized);
    window.requestAnimationFrame(() => {
      void flow.fitView({ padding: 0.2, duration, maxZoom: 1 });
    });
  }, [locked, nodes, edges, moveNodes, onNodesChange, flow, duration]);

  // --- palette ----------------------------------------------------------
  const openPaletteAt = useCallback(
    (screen: { x: number; y: number } | null) => {
      if (!catalog) return;
      let point = screen;
      if (!point && wrapperRef.current) {
        const r = wrapperRef.current.getBoundingClientRect();
        point = { x: r.left + r.width / 2, y: r.top + r.height * 0.4 };
      }
      const flowPos = point ? flow.screenToFlowPosition(point) : { x: 0, y: 0 };
      setPalette({ screen, flow: { x: snap(flowPos.x), y: snap(flowPos.y) } });
    },
    [catalog, flow],
  );

  const onPaneContextMenu = useCallback(
    (event: ReactMouseEvent | MouseEvent) => {
      event.preventDefault();
      openPaletteAt({ x: event.clientX, y: event.clientY });
    },
    [openPaletteAt],
  );

  const addButtonRef = useRef<HTMLButtonElement>(null);
  const openPaletteFromButton = useCallback(() => {
    const r = addButtonRef.current?.getBoundingClientRect();
    const wrap = wrapperRef.current?.getBoundingClientRect();
    if (!r || !wrap) return openPaletteAt(null);
    // Anchor under the button; place the node at the viewport centre.
    const centre = flow.screenToFlowPosition({
      x: wrap.left + wrap.width / 2,
      y: wrap.top + wrap.height / 2,
    });
    setPalette({
      screen: { x: r.left, y: r.bottom },
      flow: { x: snap(centre.x - 116), y: snap(centre.y - 40) },
    });
  }, [flow, openPaletteAt]);

  // --- keyboard ---------------------------------------------------------
  // Every canvas shortcut goes through the shortcut registry, scoped to this wrapper, so
  // the shortcuts dialog lists it and a scoped binding (⌘K here) wins over the app's while
  // focus is inside the canvas. Plain keys act only on the canvas surface (the wrapper, the
  // pane, a node or an edge), never on a control inside it.
  const [connecting, setConnecting] = useState<ConnectState | null>(null);
  const openInspector = onOpenInspector ?? onNodeDoubleClick;

  const onSurface = useCallback((event: KeyboardEvent) => isCanvasSurfaceTarget(event.target), []);
  const inCanvas = useCallback((event: KeyboardEvent) => isCanvasShortcutTarget(event.target), []);
  const onNode = useCallback(
    (event: KeyboardEvent) => focusedNodeElement(event.target) !== null,
    [],
  );
  const shortcut = (
    id: CanvasShortcutId,
    when: (event: KeyboardEvent) => boolean,
    enabled = true,
  ): ShortcutOptions => ({
    description: CANVAS_SHORTCUTS[id].description,
    group: CANVAS_SHORTCUT_GROUP,
    when,
    enabled,
  });

  const nudgeByKey = useCallback(
    (event: KeyboardEvent) => {
      const step = event.shiftKey ? 32 : 8;
      if (event.key === "ArrowLeft") nudge(-step, 0);
      else if (event.key === "ArrowRight") nudge(step, 0);
      else if (event.key === "ArrowUp") nudge(0, -step);
      else if (event.key === "ArrowDown") nudge(0, step);
    },
    [nudge],
  );

  const startConnect = useCallback((event: KeyboardEvent) => {
    const element = focusedNodeElement(event.target);
    const nodeId = element?.dataset.id;
    if (!element || nodeId === undefined) return;
    const r = element.getBoundingClientRect();
    setPalette(null);
    setConnecting({ nodeId, element, anchor: { x: r.left, y: r.bottom }, open: true });
  }, []);

  const inspectFocused = useCallback(
    (event: KeyboardEvent) => {
      const id = focusedNodeElement(event.target)?.dataset.id;
      const node = id === undefined ? undefined : nodeById.get(id);
      if (node) openInspector?.(node);
    },
    [nodeById, openInspector],
  );

  const clearAll = useCallback(() => {
    setPalette(null);
    clearSelection();
  }, [clearSelection]);

  useShortcut([...CANVAS_SHORTCUTS.selectAll.keys], selectAll, {
    ...shortcut("selectAll", inCanvas),
    scope: wrapperRef,
  });
  useShortcut([...CANVAS_SHORTCUTS.nudge.keys], nudgeByKey, {
    ...shortcut("nudge", onSurface, !locked),
    scope: wrapperRef,
  });
  useShortcut([...CANVAS_SHORTCUTS.nudgeFar.keys], nudgeByKey, {
    ...shortcut("nudgeFar", onSurface, !locked),
    scope: wrapperRef,
  });
  useShortcut([...CANVAS_SHORTCUTS.connect.keys], startConnect, {
    ...shortcut("connect", onNode, !locked && onConnect !== undefined),
    scope: wrapperRef,
  });
  useShortcut([...CANVAS_SHORTCUTS.inspect.keys], inspectFocused, {
    ...shortcut("inspect", onNode, openInspector !== undefined),
    scope: wrapperRef,
  });
  useShortcut([...CANVAS_SHORTCUTS.remove.keys], deleteSelection, {
    ...shortcut("remove", onSurface, !locked),
    scope: wrapperRef,
  });
  useShortcut([...CANVAS_SHORTCUTS.clear.keys], clearAll, {
    ...shortcut("clear", onSurface),
    scope: wrapperRef,
    preventDefault: false,
  });
  useShortcut([...CANVAS_SHORTCUTS.palette.keys], () => openPaletteAt(null), {
    ...shortcut("palette", inCanvas, catalog !== undefined && !locked),
    scope: wrapperRef,
  });
  useShortcut(
    [...CANVAS_SHORTCUTS.duplicate.keys],
    () => {
      if (selectedNodes.length) onDuplicateNodes?.(selectedNodes);
    },
    {
      ...shortcut("duplicate", inCanvas, !locked && onDuplicateNodes !== undefined),
      scope: wrapperRef,
    },
  );
  useShortcut(
    [...CANVAS_SHORTCUTS.group.keys],
    () => {
      if (selectedNodes.length) onGroupNodes?.(selectedNodes);
    },
    { ...shortcut("group", inCanvas, !locked && onGroupNodes !== undefined), scope: wrapperRef },
  );
  useShortcut([...CANVAS_SHORTCUTS.autoLayout.keys], runAutoLayout, {
    ...shortcut("autoLayout", onSurface, !locked),
    scope: wrapperRef,
  });
  useShortcut([...CANVAS_SHORTCUTS.fit.keys], fit, {
    ...shortcut("fit", inCanvas),
    scope: wrapperRef,
  });
  useShortcut([...CANVAS_SHORTCUTS.zoomIn.keys], () => void flow.zoomIn({ duration }), {
    ...shortcut("zoomIn", inCanvas),
    scope: wrapperRef,
  });
  useShortcut([...CANVAS_SHORTCUTS.zoomOut.keys], () => void flow.zoomOut({ duration }), {
    ...shortcut("zoomOut", inCanvas),
    scope: wrapperRef,
  });

  const { connectionOptionsFrom } = validation;
  const connectOptions = useMemo(
    () => (connecting?.open ? connectionOptionsFrom(connecting.nodeId) : []),
    [connecting, connectionOptionsFrom],
  );
  const connectingName = connecting
    ? (nodeById.get(connecting.nodeId)?.data.node.name ?? connecting.nodeId)
    : "";
  const summaryId = useId();
  const summary = canvasShortcutSummary({
    palette: catalog !== undefined,
    connect: onConnect !== undefined,
    inspect: openInspector !== undefined,
  });

  const focusWrapper = useCallback(() => {
    const el = wrapperRef.current;
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
  }, []);

  // --- diagnostics ------------------------------------------------------
  const nodeName = useCallback((id: string) => nodeById.get(id)?.data.node.name, [nodeById]);
  const focusNode = useCallback(
    (id: string) => {
      const nc: NodeChange<CanvasNode>[] = nodes
        .filter((n) => (n.selected ?? false) !== (n.id === id))
        .map((n) => ({ type: "select", id: n.id, selected: n.id === id }));
      if (nc.length) onNodesChange(nc);
      void flow.fitView({ nodes: [{ id }], duration, padding: 0.6, maxZoom: 1.25 });
    },
    [nodes, onNodesChange, flow, duration],
  );
  const focusEdge = useCallback(
    (id: string) => {
      const ec: EdgeChange<CanvasEdge>[] = edges
        .filter((e) => (e.selected ?? false) !== (e.id === id))
        .map((e) => ({ type: "select", id: e.id, selected: e.id === id }));
      if (ec.length) onEdgesChange(ec);
    },
    [edges, onEdgesChange],
  );

  // --- selection toolbar position ---------------------------------------
  const toolbarPos = useMemo(() => {
    if (selectedNodes.length < 2) return null;
    const b = getNodesBounds(selectedNodes);
    const left = b.x * zoom + vx + (b.width * zoom) / 2;
    const top = b.y * zoom + vy - 12;
    return {
      left: Math.max(200, Math.min(left, Math.max(200, paneWidth - 200))),
      top: Math.max(44, top),
    };
  }, [selectedNodes, zoom, vx, vy, paneWidth]);

  const handleConnect = useCallback(
    (c: Connection) => {
      if (locked) return;
      onConnect?.(c);
    },
    [locked, onConnect],
  );

  return (
    // role="application": the canvas owns its keyboard model (select-all, nudge, connect,
    // palette, fit), registered through the shortcut registry and scoped to this wrapper.
    // It is a Tab stop with a visible focus ring, named, and described by the shortcut
    // summary. jsx-a11y counts `application` as non-interactive, but it is exactly the role
    // for a focusable widget that handles its own keys (WAI-ARIA 1.2 application).
    <div
      ref={wrapperRef}
      role="application"
      aria-label="Workflow canvas"
      aria-describedby={summaryId}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- `application` is a focusable widget role
      tabIndex={0}
      onPointerDownCapture={focusWrapper}
      className={cn(
        "fa-canvas relative flex h-full min-h-0 w-full flex-col bg-canvas text-ink",
        className,
      )}
      style={style}
      data-locked={locked || undefined}
    >
      <p id={summaryId} className="sr-only">
        {summary}
      </p>
      <div className="relative min-h-0 flex-1">
        <ReactFlow<CanvasNode, CanvasEdge>
          nodes={viewNodes}
          edges={viewEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={handleConnect}
          onConnectStart={validation.onConnectStart}
          onConnectEnd={validation.onConnectEnd}
          isValidConnection={validation.isValidConnection}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          connectionLineComponent={ConnectionLine}
          snapToGrid
          snapGrid={[CANVAS_SNAP, CANVAS_SNAP]}
          minZoom={CANVAS_MIN_ZOOM}
          maxZoom={CANVAS_MAX_ZOOM}
          fitView={fitViewOnInit}
          fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
          selectionOnDrag
          selectionMode={SelectionMode.Partial}
          selectionKeyCode="Shift"
          panOnDrag={[1, 2]}
          panActivationKeyCode="Space"
          panOnScroll
          zoomOnPinch
          zoomOnDoubleClick={false}
          // Delete/Backspace is a registered canvas shortcut (listed in the shortcuts dialog).
          deleteKeyCode={null}
          nodesDraggable={!locked}
          nodesConnectable={!locked}
          elevateEdgesOnSelect
          onPaneContextMenu={catalog ? onPaneContextMenu : undefined}
          onNodeDoubleClick={onNodeDoubleClick ? (_e, node) => onNodeDoubleClick(node) : undefined}
          onNodeDrag={onSetParent ? onNodeDrag : undefined}
          onNodeDragStop={onSetParent ? onNodeDragStop : undefined}
          attributionPosition="bottom-center"
          className="h-full w-full"
        >
          <Background
            id="fa-grid"
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1}
            color="var(--grid)"
            bgColor="var(--canvas)"
          />
          {showMinimap && nodes.length > 0 ? (
            <MiniMap<CanvasNode>
              pannable
              zoomable
              position="bottom-right"
              nodeClassName={(n) => `fa-minimap-node-${n.data.node.category}`}
              nodeBorderRadius={3}
              className="hidden min-[900px]:block"
              style={{ width: 160, height: 100 }}
              ariaLabel="Workflow minimap"
            />
          ) : null}
          <FlowPanel position="bottom-left" className="m-3">
            <CanvasControls
              zoom={zoom}
              onZoomIn={() => void flow.zoomIn({ duration })}
              onZoomOut={() => void flow.zoomOut({ duration })}
              onResetZoom={() => void flow.zoomTo(1, { duration })}
              onFitView={fit}
              locked={locked}
              onToggleLock={() => setLocked(!locked)}
              onAutoLayout={runAutoLayout}
              minimapVisible={showMinimap}
              onToggleMinimap={() => setShowMinimap((v) => !v)}
              minZoom={CANVAS_MIN_ZOOM}
              maxZoom={CANVAS_MAX_ZOOM}
            />
          </FlowPanel>
          {catalog ? (
            <FlowPanel position="top-left" className="m-3">
              <Button
                ref={addButtonRef}
                leadingIcon={<Plus strokeWidth={1.75} aria-hidden="true" />}
                onClick={openPaletteFromButton}
                disabled={locked}
              >
                Add node
                <Shortcut shortcut="mod+k" size="sm" className="ml-1" />
              </Button>
            </FlowPanel>
          ) : null}
          {children}
        </ReactFlow>

        {nodes.length === 0 ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
            <CanvasEmptyState
              onAddNode={() => openPaletteAt(null)}
              onStartFromTemplate={onStartFromTemplate}
              onDescribeToBuilder={
                onAskBuilder ? () => onAskBuilder("", { x: 0, y: 0 }) : undefined
              }
            />
          </div>
        ) : null}

        {toolbarPos && !locked ? (
          <SelectionToolbar
            count={selectedNodes.length}
            onAlign={align}
            onDistribute={distribute}
            onGroup={onGroupNodes ? () => onGroupNodes(selectedNodes) : undefined}
            onDelete={deleteSelection}
            className="absolute z-10 -translate-x-1/2 -translate-y-full"
            style={{ left: toolbarPos.left, top: toolbarPos.top }}
          />
        ) : null}

        {onConnect ? (
          <ConnectPicker
            open={connecting?.open ?? false}
            onOpenChange={(open) => {
              if (!open) setConnecting((c) => (c ? { ...c, open: false } : c));
            }}
            anchor={connecting?.anchor ?? null}
            sourceName={connectingName}
            options={connectOptions}
            returnFocusTo={connecting?.element ?? null}
            onPick={(o) =>
              handleConnect({
                source: o.source,
                sourceHandle: o.sourceHandle,
                target: o.target,
                targetHandle: o.targetHandle,
              })
            }
          />
        ) : null}

        {catalog ? (
          <NodePaletteMenu
            open={palette !== null}
            onOpenChange={(open) => {
              if (!open) setPalette(null);
            }}
            anchor={palette?.screen ?? null}
            catalog={catalog}
            recent={recentKinds}
            onPick={(def) => {
              if (palette) onAddNode?.(def, palette.flow);
            }}
            onAskBuilder={
              onAskBuilder
                ? (query) => {
                    if (palette) onAskBuilder(query, palette.flow);
                  }
                : undefined
            }
          />
        ) : null}
      </div>

      {diagnostics.length > 0 ? (
        <DiagnosticsBar
          diagnostics={diagnostics}
          nodeName={nodeName}
          onFocusNode={focusNode}
          onFocusEdge={focusEdge}
          className="shrink-0"
        />
      ) : null}
    </div>
  );
}

/**
 * The workflow canvas: a themed React Flow with the node group's cards,
 * control edges (`ctl:<port>` → `ctl-in`, weighted for router exits) and data
 * edges (`out:<port>` → `in:<port>`, dotted when implicit). Fully controlled: nodes and edges come from props and every
 * interaction is reported through `onNodesChange` / `onEdgesChange`
 * (position, selection, removal) or a named callback, so the app owns the
 * workflow. Pass `run` to decorate the graph with execution state.
 *
 * Keyboard (UI.md §9): the canvas is a Tab stop (`role="application"`, described by a
 * shortcut summary); Tab walks the nodes. ⌘A select all · Delete/Backspace remove · ⌘D
 * duplicate · Esc clear · arrows nudge 8px (⇧ 32px) · C on a focused node opens the
 * connect list (compatible targets; Enter connects) · Enter on a focused node opens the
 * inspector (`onOpenInspector`) · ⌘0 fit · ⌘+ / ⌘− zoom · ⌘K or / palette · ⇧L auto
 * layout. Every one is registered through the shortcut registry (group "Canvas"), so
 * `KeyboardShortcutsDialog` lists it. Mouse: drag selects, ⇧ adds, space or middle
 * button pans, wheel pans, pinch zooms, right-click opens the palette.
 *
 * Containers: loop/foreach nodes render as resizable frames and their body nodes
 * (`node.parent`) sit inside them (`toFlowNode` sets `parentId` + `extent: 'parent'`).
 * Dropping nodes into a frame, or out of one while holding ⌥/Alt, calls `onSetParent`;
 * resizing a frame reports `dimensions` changes through `onNodesChange` (map them onto
 * the layout with `applyLayoutChanges`). Auto layout lays bodies out inside their frames
 * and fits each frame around them.
 */
export function FlowCanvas(props: FlowCanvasProps) {
  // Joins the app's ShortcutProvider when there is one (so its dialog lists the canvas
  // shortcuts); otherwise this provider handles them on its own.
  return (
    <ShortcutProvider>
      <ReactFlowProvider>
        <FlowCanvasInner {...props} />
      </ReactFlowProvider>
    </ShortcutProvider>
  );
}
