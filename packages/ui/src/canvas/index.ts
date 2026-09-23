// canvas components. Every export here is re-exported from @flowaid/ui.
// Node cards, handles and xyflow's base stylesheet come from "@/node".
import "./canvas.css";

export {
  FlowCanvas,
  isCanvasShortcutTarget,
  CANVAS_MIN_ZOOM,
  CANVAS_MAX_ZOOM,
  CANVAS_SNAP,
  decorateCanvasEdge,
  type FlowCanvasProps,
} from "./FlowCanvas";
export { edgeTypes, edgeTypeFor, toCanvasEdge } from "./edgeTypes";
export {
  ControlEdge,
  controlEdgeStroke,
  controlEdgeOpacity,
  controlEdgeLabel,
} from "./ControlEdge";
export { DataEdge, dataEdgeStroke, dataEdgeTooltip, summarizeSchema } from "./DataEdge";
export { WeightedEdge, edgeStroke } from "./WeightedEdge";
export { EdgeArrow, EdgeLabelChip } from "./edgeParts";
export {
  ConnectionLine,
  ConnectionLinePath,
  type ConnectionLinePathProps,
  type ConnectionLineStatus,
} from "./ConnectionLine";
export {
  useConnectionValidation,
  validateConnection,
  checkPortSchemas,
  portSchema,
  connectionOptionsFrom,
  handleLabel,
  type ConnectionCheck,
  type ConnectionOption,
  type ConnectionValidation,
  type EdgeLike,
  type PendingConnection,
} from "./useConnectionValidation";
export { NodePaletteMenu, CATEGORY_ICON, type NodePaletteMenuProps } from "./NodePaletteMenu";
export { ConnectPicker, type ConnectPickerProps } from "./ConnectPicker";
export {
  CANVAS_SHORTCUTS,
  CANVAS_SHORTCUT_GROUP,
  canvasShortcutSummary,
  isCanvasSurfaceTarget,
  focusedNodeElement,
  type CanvasShortcut,
  type CanvasShortcutId,
} from "./canvasShortcuts";
export { SelectionToolbar, type SelectionToolbarProps } from "./SelectionToolbar";
export { CanvasEmptyState, type CanvasEmptyStateProps } from "./CanvasEmptyState";
export { DiagnosticsBar, diagnosticPath, type DiagnosticsBarProps } from "./DiagnosticsBar";
export { CanvasControls, type CanvasControlsProps } from "./CanvasControls";
export {
  autoLayout,
  applyAutoLayout,
  findBackEdges,
  estimateNodeHeight,
  type AutoLayoutOptions,
  type AutoLayoutResult,
  type LayoutNodeInput,
  type LayoutEdgeInput,
} from "./autoLayout";
export {
  applyLayoutChanges,
  planParentDrops,
  frameAt,
  containerDepth,
  isInside,
  type FlowBox,
  type DroppedBox,
} from "./containers";
export {
  deriveCanvasRunState,
  deriveEdgeState,
  latestNodeRuns,
  controlPortOf,
  firedPortOf,
  type RunStateNodeInput,
  type RunStateEdgeInput,
} from "./deriveCanvasRunState";
export {
  alignNodes,
  distributeNodes,
  boundsOf,
  probabilityToStroke,
  type AlignKind,
  type DistributeAxis,
  type Box,
  type BoxedNode,
} from "./geometry";
export {
  type CanvasNode,
  type CanvasNodeData,
  type CanvasEdge,
  type CanvasEdgeType,
  type CanvasEdgeState,
  type ControlCanvasEdge,
  type ControlEdgeData,
  type DataCanvasEdge,
  type DataEdgeData,
  type CanvasRunState,
  type NodeDefinitionView,
  type CanvasPoint,
  type CanvasLayout,
  type ParentDrop,
} from "./types";
