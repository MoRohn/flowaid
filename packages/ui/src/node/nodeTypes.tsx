import { memo, type ComponentType } from "react";
import {
  Position,
  type Node,
  type NodeHandle,
  type NodeProps,
  type XYPosition,
} from "@xyflow/react";
import type {
  CardManifest,
  ConfidenceThresholds,
  ControlPortView,
  GateConfig,
  IterationProgress,
  IterationView,
  NodeRunView,
  WorkflowNodeView,
} from "@/types";
import { AgentNodeCard } from "./AgentNodeCard";
import { BranchNodeCard } from "./BranchNodeCard";
import { CodeNodeCard } from "./CodeNodeCard";
import { ConfidenceGateNodeCard, gateRoutes } from "./ConfidenceGateNodeCard";
import {
  CONTAINER_DEFAULT_HEIGHT,
  CONTAINER_DEFAULT_WIDTH,
  CONTAINER_DRAG_HANDLE_CLASS,
  ContainerFrame,
} from "./ContainerFrame";
import { DecisionNodeCard } from "./DecisionNodeCard";
import { EndNodeCard } from "./EndNodeCard";
import { GenerationNodeCard, type GenerationStream } from "./GenerationNodeCard";
import { HttpNodeCard } from "./HttpNodeCard";
import { HumanNodeCard } from "./HumanNodeCard";
import { JoinNodeCard, joinControlOuts } from "./JoinNodeCard";
import { LoopNodeCard } from "./LoopNodeCard";
import { NodeCard, type NodeCardBaseProps } from "./NodeCard";
import type { NodeActionHandlers } from "./NodeActionBar";
import { NodeToolbar } from "./NodeToolbar";
import { NoteCard } from "./NoteCard";
import { RetrievalNodeCard } from "./RetrievalNodeCard";
import { RouterNodeCard } from "./RouterNodeCard";
import { SafetyNodeCard, type SafetyOutcome } from "./SafetyNodeCard";
import { StartNodeCard } from "./StartNodeCard";
import { StateNodeCard } from "./StateNodeCard";
import { SubflowNodeCard } from "./SubflowNodeCard";
import { ToolNodeCard } from "./ToolNodeCard";
import { CONTROL_IN_OFFSET } from "./TypedHandle";
import { WaitNodeCard, waitControlOuts } from "./WaitNodeCard";
import {
  HANDLE_SIZE,
  NODE_WIDTH,
  cardVariantFor,
  controlOutsFor,
  handleId,
  handleOffset,
  hasControlIn,
  nodeTypeId,
  type NodeCardVariant,
} from "./nodeUtils";

/**
 * Live and per-kind data the canvas can attach to a node beyond its
 * definition and last run. Every field is optional; cards read what they use.
 */
export interface NodeCardExtras {
  /** Streaming output for a running generation node. */
  stream?: GenerationStream;
  /** Handle ids (`in:<port>`, `ctl-in`, …) to highlight while a connection is being dragged. */
  compatibleHandles?: ReadonlyArray<string>;
  /** Why the other handles reject the dragged connection, by handle id. */
  handleReasons?: Readonly<Record<string, string>>;
  /** Gate runtime config (`threshold`, `reviewBand?`, `requireValue?`); else `thresholds`, then meta / defaults. */
  gate?: GateConfig;
  /** Gate thresholds in the UI's two-threshold model (else read from meta / defaults). */
  thresholds?: ConfidenceThresholds;
  /** Confidence arriving at a gate. */
  confidence?: number;
  /** Current loop iteration (1-based); overrides the folded `run.progress`. */
  iteration?: number;
  /** Loop / foreach progress; defaults to `run.progress`. */
  progress?: IterationProgress;
  /** Iteration (0-based index) a container's stepper shows; the frame keeps its own when omitted. */
  selectedIteration?: number;
  /** A container's stepper moved: the inspector should show that iteration's values. */
  onSelectIteration?: (nodeId: string, iteration: IterationView) => void;
  /** Source shown by a code node. */
  code?: string;
  /** Agent steps used / max. */
  steps?: { used: number; max?: number };
  toolsCount?: number;
  hits?: number;
  outcome?: SafetyOutcome;
  assignee?: string;
  hovered?: boolean;
  onOpenReview?: (nodeId: string) => void;
  /** When present, a `NodeToolbar` shows above the node while it is selected. */
  actions?: NodeActionHandlers;
}

/** The `data` of every FlowAId node on the canvas (UI.md §4.2). */
export type FlowNodeData = {
  node: WorkflowNodeView;
  run?: NodeRunView;
  /** The node's manifest, when the catalog has it; refines the card variant for unknown type ids. */
  manifest?: CardManifest;
  /** The card variant `toFlowNode` resolved; recomputed from `node` and `manifest` when absent. */
  variant?: NodeCardVariant;
  extras?: NodeCardExtras;
};

/** XYFlow node types: `flowaid` (every card, dispatching on the variant), `container` (loop/foreach) and `note`. */
export type FlowNodeType = "flowaid" | "container" | "note";

export type FlowNode = Node<FlowNodeData, FlowNodeType>;
export type FlowNodeProps = NodeProps<FlowNode>;

type CardComponent = ComponentType<NodeCardBaseProps & NodeCardExtras>;

/** The card component per variant (notes render `NoteCard`, which takes no run or handles). */
const VARIANT_CARDS: Record<Exclude<NodeCardVariant, "note">, CardComponent> = {
  start: StartNodeCard,
  end: EndNodeCard,
  decision: DecisionNodeCard,
  generation: GenerationNodeCard,
  tool: ToolNodeCard,
  http: HttpNodeCard,
  human: HumanNodeCard,
  branch: BranchNodeCard,
  join: JoinNodeCard,
  router: RouterNodeCard,
  gate: ConfidenceGateNodeCard,
  container: LoopNodeCard,
  subflow: SubflowNodeCard,
  wait: WaitNodeCard,
  code: CodeNodeCard,
  agent: AgentNodeCard,
  safety: SafetyNodeCard,
  state: StateNodeCard,
  retrieval: RetrievalNodeCard,
  default: NodeCard,
};

/** The variant a flow node renders as. */
export function flowNodeVariant(
  data: Pick<FlowNodeData, "node" | "manifest" | "variant">,
): NodeCardVariant {
  return data.variant ?? cardVariantFor(data.node, data.manifest);
}

/** The XYFlow node type for a variant: `container` for loop/foreach, `note` for notes, `flowaid` otherwise. */
export function flowNodeTypeFor(variant: NodeCardVariant): FlowNodeType {
  if (variant === "container") return "container";
  if (variant === "note") return "note";
  return "flowaid";
}

const FlowaidNode = memo(function FlowaidNode({ data, selected, dragging }: FlowNodeProps) {
  const { node, run, extras } = data;
  const variant = flowNodeVariant(data);
  if (variant === "note") return <NoteCard node={node} selected={selected} dragging={dragging} />;
  const Card = VARIANT_CARDS[variant];
  const { actions, ...cardExtras } = extras ?? {};
  return (
    <>
      {actions ? (
        <NodeToolbar nodeId={node.id} isVisible={selected} disabled={node.disabled} {...actions} />
      ) : null}
      <Card
        node={node}
        run={run}
        selected={selected}
        dragging={dragging}
        disabled={node.disabled}
        {...cardExtras}
      />
    </>
  );
});
FlowaidNode.displayName = "FlowaidNode";

const ContainerNode = memo(function ContainerNode({ data, selected, dragging }: FlowNodeProps) {
  const { node, run, extras } = data;
  const {
    actions,
    compatibleHandles,
    handleReasons,
    iteration,
    progress,
    selectedIteration,
    onSelectIteration,
    hovered,
  } = extras ?? {};
  return (
    <>
      {actions ? (
        <NodeToolbar nodeId={node.id} isVisible={selected} disabled={node.disabled} {...actions} />
      ) : null}
      <ContainerFrame
        node={node}
        run={run}
        selected={selected}
        dragging={dragging}
        hovered={hovered}
        disabled={node.disabled}
        compatibleHandles={compatibleHandles}
        handleReasons={handleReasons}
        iteration={iteration}
        progress={progress}
        selectedIteration={selectedIteration}
        onSelectIteration={onSelectIteration}
      />
    </>
  );
});
ContainerNode.displayName = "ContainerNode";

const NoteNode = memo(function NoteNode({ data, selected, dragging }: FlowNodeProps) {
  return <NoteCard node={data.node} selected={selected} dragging={dragging} />;
});
NoteNode.displayName = "NoteNode";

/**
 * Ready-made `nodeTypes` for `<ReactFlow nodeTypes={nodeTypes}>` (UI.md §3):
 * `flowaid` renders every card and dispatches on `cardVariantFor`,
 * `container` renders loop/foreach nodes as a resizable `ContainerFrame` their
 * body nodes sit in, and `note` canvas annotations.
 */
export const nodeTypes: Record<FlowNodeType, ComponentType<FlowNodeProps>> = {
  flowaid: FlowaidNode,
  container: ContainerNode,
  note: NoteNode,
};

/** The control-outs a variant's card draws, in order (the cards call the same helpers). */
export function cardControlOuts(
  node: WorkflowNodeView,
  variant: NodeCardVariant = cardVariantFor(node),
): ControlPortView[] {
  if (variant === "gate") return gateRoutes(node);
  if (variant === "join") return joinControlOuts(node);
  if (variant === "wait") return waitControlOuts(node);
  return controlOutsFor(node, variant);
}

/**
 * Initial handle geometry for a node, mirroring where the cards draw them
 * (xyflow replaces these with DOM measurements once the node mounts). Every
 * id is prefixed (`handleId`): the control-in notch `ctl-in` on the top edge,
 * data-ins `in:<port>` on the left, control-outs `ctl:<port>` on the right
 * with data-outs `out:<port>` below them.
 */
export function flowNodeHandles(
  node: WorkflowNodeView,
  variant: NodeCardVariant = cardVariantFor(node),
  width: number = variant === "container" ? CONTAINER_DEFAULT_WIDTH : NODE_WIDTH,
): NodeHandle[] {
  const half = HANDLE_SIZE / 2;
  const size = { width: HANDLE_SIZE, height: HANDLE_SIZE };
  const handles: NodeHandle[] = [];
  if (variant === "note") return handles;
  if (hasControlIn(variant)) {
    handles.push({
      id: handleId("ctl-in"),
      type: "target",
      position: Position.Top,
      x: CONTROL_IN_OFFSET - half,
      y: -half,
      ...size,
    });
  }
  if (variant === "start" || variant === "end") {
    // Pills are measured on mount; stack the handles at the pill's edge until then.
    if (variant === "start") {
      cardControlOuts(node, variant).forEach((c, i) => {
        handles.push({
          id: handleId("ctl", c.id),
          type: "source",
          position: Position.Right,
          x: -half,
          y: handleOffset(i) - half,
          ...size,
        });
      });
      const offset = handles.length;
      node.outputs.forEach((port, i) => {
        handles.push({
          id: handleId("out", port.id),
          type: "source",
          position: Position.Right,
          x: -half,
          y: handleOffset(offset + i) - half,
          ...size,
        });
      });
    } else {
      node.inputs.forEach((port, i) => {
        handles.push({
          id: handleId("in", port.id),
          type: "target",
          position: Position.Left,
          x: -half,
          y: handleOffset(i) - half,
          ...size,
        });
      });
    }
    return handles;
  }
  node.inputs.forEach((port, i) => {
    handles.push({
      id: handleId("in", port.id),
      type: "target",
      position: Position.Left,
      x: -half,
      y: handleOffset(i) - half,
      ...size,
    });
  });
  const controls = cardControlOuts(node, variant);
  controls.forEach((c, i) => {
    handles.push({
      id: handleId("ctl", c.id),
      type: "source",
      position: Position.Right,
      x: width - half,
      y: handleOffset(i) - half,
      ...size,
    });
  });
  node.outputs.forEach((port, i) => {
    handles.push({
      id: handleId("out", port.id),
      type: "source",
      position: Position.Right,
      x: width - half,
      y: handleOffset(controls.length + i) - half,
      ...size,
    });
  });
  return handles;
}

/**
 * Where a node sits: a `layout.nodes[id]` entry (`x`, `y`, and `w`/`h` for a resized
 * container). A node with a `parent` is positioned relative to its container's top-left.
 */
export type FlowNodePlacement = XYPosition & { w?: number; h?: number };

/**
 * Builds the xyflow node for a workflow node (UI.md §4.2): its XYFlow type, resolved card
 * variant, typed data and initial handles. A node with `parent` gets `parentId` and
 * `extent: 'parent'` (its position is relative to the frame); a loop/foreach container is
 * sized from `placement.w`/`h` (else the default frame size) and dragged by its header.
 */
export function toFlowNode(
  node: WorkflowNodeView,
  placement: FlowNodePlacement,
  run?: NodeRunView,
  extras?: NodeCardExtras,
  manifest?: CardManifest,
): FlowNode {
  const variant = cardVariantFor(node, manifest);
  const data: FlowNodeData = { node, variant };
  if (run) data.run = run;
  if (extras) data.extras = extras;
  if (manifest) data.manifest = manifest;
  const container = variant === "container";
  const width = container ? (placement.w ?? CONTAINER_DEFAULT_WIDTH) : undefined;
  const height = container ? (placement.h ?? CONTAINER_DEFAULT_HEIGHT) : undefined;
  return {
    id: node.id,
    type: flowNodeTypeFor(variant),
    position: { x: placement.x, y: placement.y },
    data,
    handles: flowNodeHandles(node, variant, width),
    ariaLabel: `${node.name} (${nodeTypeId(node)})`,
    ...(node.parent !== undefined ? { parentId: node.parent, extent: "parent" as const } : null),
    ...(width !== undefined && height !== undefined
      ? { width, height, dragHandle: `.${CONTAINER_DRAG_HANDLE_CLASS}` }
      : null),
    ...(variant === "note" ? { connectable: false } : null),
  };
}

/**
 * Orders flow nodes so every container precedes the nodes inside it (xyflow requires a
 * parent before its children); otherwise keeps the input order. Parents missing from the
 * list are ignored, and a parent cycle cannot loop.
 */
export function orderParentsFirst<N extends { id: string; parentId?: string }>(
  nodes: readonly N[],
): N[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: N[] = [];
  const placed = new Set<string>();
  const visiting = new Set<string>();
  const place = (n: N) => {
    if (placed.has(n.id) || visiting.has(n.id)) return;
    visiting.add(n.id);
    const parent = n.parentId !== undefined ? byId.get(n.parentId) : undefined;
    if (parent) place(parent);
    visiting.delete(n.id);
    placed.add(n.id);
    out.push(n);
  };
  for (const n of nodes) place(n);
  return out;
}
