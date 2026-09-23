# Verification: ui-container-frame

Verdict: finding stands (not refuted). Severity: high.

Evidence

- `grep -rn "ContainerFrame\|NodeResizer\|parentId" packages/ui/src` -> no hits (only chartMath `extent`).
- packages/ui/src/node/LoopNodeCard.tsx: plain NodeCard with iteration progress bar; no group/frame behaviour.
- packages/ui/src/node/nodeTypes.tsx `toFlowNode` (line ~150) returns { id, type, position, data, handles, ariaLabel } - no parentId/extent.
- packages/ui/src/canvas/FlowCanvas.tsx props: onGroupNodes exists but no onSetParent / drop-into-frame handling.
- packages/ui/src/canvas/autoLayout.ts: flat layered layout, no compound/container awareness.
- docs/design/UI.md line 59, 115, 137, 219: ContainerFrame group node with NodeResizer, parentId + extent 'parent', iteration badge and stepper are required.
- docs/design/CONTRACTS.ts line 546: `parent: NodeIdSchema.optional()` on nodes; loop/foreach body defined as nodes with parent === this.id (lines 604, 624).
