"use client";
/**
 * The run's version on a locked canvas with the live overlay (UI.md §4.3): node borders by status,
 * taken control edges tinted, pruned ones faded. Selecting a node selects its latest node run.
 */
import { applyEdgeChanges, applyNodeChanges } from "@xyflow/react";
import { useMemo, useState } from "react";
import type { ExecutionPlan, WorkflowDefinition } from "@flowaid/workflow-core";
import type { RunView } from "@flowaid/ui";
import { FlowCanvas, type CanvasEdge, type CanvasNode } from "@flowaid/ui/canvas";
import { toReadOnlyGraph } from "./graph";
import type { Catalog } from "./types";

export interface RunGraphProps {
  definition: WorkflowDefinition;
  plan?: ExecutionPlan;
  catalog: Catalog;
  run: RunView;
  follow?: boolean;
  onSelectNode?: (nodeId: string) => void;
}

export function RunGraph({ definition, plan, catalog, run, follow, onSelectNode }: RunGraphProps) {
  const graph = useMemo(
    () => toReadOnlyGraph(definition, plan, catalog),
    [definition, plan, catalog],
  );
  // xyflow owns measured sizes and selection; reset them when the version changes.
  const [state, setState] = useState<{
    from: typeof graph;
    nodes: CanvasNode[];
    edges: CanvasEdge[];
  }>(() => ({ from: graph, nodes: graph.nodes, edges: graph.edges }));
  if (state.from !== graph) setState({ from: graph, nodes: graph.nodes, edges: graph.edges });
  const { nodes, edges } = state;
  const setNodes = (f: (ns: CanvasNode[]) => CanvasNode[]) =>
    setState((st) => ({ ...st, nodes: f(st.nodes) }));
  const setEdges = (f: (es: CanvasEdge[]) => CanvasEdge[]) =>
    setState((st) => ({ ...st, edges: f(st.edges) }));

  return (
    <div className="h-full min-h-[420px] w-full">
      <FlowCanvas
        nodes={nodes}
        edges={edges}
        onNodesChange={(changes) =>
          setNodes((ns) =>
            applyNodeChanges(
              changes.filter((c) => c.type !== "remove"),
              ns,
            ),
          )
        }
        onEdgesChange={(changes) =>
          setEdges((es) =>
            applyEdgeChanges(
              changes.filter((c) => c.type !== "remove"),
              es,
            ),
          )
        }
        run={run}
        followRun={follow ?? false}
        locked
        fitViewOnInit
        defaultShowMinimap={false}
        onSelectionChange={({ nodes: sel }) => {
          const first = sel[0];
          if (first && onSelectNode) onSelectNode(first.id);
        }}
      />
    </div>
  );
}
