/**
 * The research-agent workflow (`packages/workflow-core/fixtures/research-agent.json`) as the
 * canvas projects it: a `loop` ("Research rounds") whose body holds a `foreach` ("Run
 * searches") with its own body, plus a mid-run event log that folds into the loop's `3/5`
 * and the foreach's `3/4` iteration badges. Node ids, kinds, type ids, names, parents and
 * control edges mirror the JSON fixture (`researchAgent.test.ts` checks them); ports and data
 * edges are the ones its bindings resolve to (UI.md §4.2 projection).
 */
import type { Layout, NodeRunStatus } from "@flowaid/workflow-core";
import type { PortView, WorkflowEdgeView, WorkflowNodeView } from "@/types";

type PortType = "string" | "integer" | "object" | "array";
const port = (id: string, type: PortType, label: string = id): PortView => ({
  id,
  label,
  type,
  schema: { type },
});

export const researchAgentNodes: WorkflowNodeView[] = [
  {
    id: "start",
    kind: "input",
    category: "flow",
    name: "Question",
    inputs: [],
    outputs: [port("question", "string"), port("max_rounds", "integer")],
  },
  {
    id: "research",
    kind: "loop",
    category: "flow",
    name: "Research rounds",
    description:
      "Plan searches, run them, judge the results and decide whether the answer is complete",
    bounds: { maxIterations: 5, maxCostUsd: 1.5, timeoutMs: 480_000 },
    inputs: [],
    outputs: [port("result", "object"), port("carry", "object"), port("iterations", "integer")],
    routes: [
      { id: "done", label: "done" },
      { id: "exhausted", label: "exhausted" },
    ],
  },
  {
    id: "planner",
    kind: "task",
    nodeType: "flowaid.ai.structured_generate",
    category: "generation",
    parent: "research",
    name: "Plan queries",
    description: "Up to four targeted searches for the known gap",
    provider: "claude-sonnet-4-5",
    inputs: [port("prompt", "string")],
    outputs: [port("structured", "object")],
  },
  {
    id: "search_all",
    kind: "foreach",
    category: "flow",
    parent: "research",
    name: "Run searches",
    description: "Each planned query, four at a time",
    bounds: { maxIterations: 4 },
    inputs: [port("items", "array")],
    outputs: [port("results", "array")],
  },
  {
    id: "web",
    kind: "task",
    nodeType: "flowaid.tools.http",
    category: "tool",
    parent: "search_all",
    name: "Search",
    meta: [
      { label: "method", value: "GET" },
      { label: "path", value: "search.example.com/v1" },
    ],
    inputs: [],
    outputs: [port("body", "object"), port("status", "integer")],
  },
  {
    id: "judge",
    kind: "task",
    nodeType: "flowaid.decision.batch",
    category: "decision",
    parent: "search_all",
    name: "Judge result",
    description: "Relevance and reliability, scored 0–4",
    inputs: [port("state", "object")],
    outputs: [port("answers", "object")],
  },
  {
    id: "store",
    kind: "task",
    nodeType: "flowaid.data.transform",
    category: "data",
    parent: "research",
    name: "Accumulate evidence",
    description: "Keep results judged relevant and reliable",
    inputs: [],
    outputs: [port("result", "array")],
  },
  {
    id: "synthesis",
    kind: "task",
    nodeType: "flowaid.ai.structured_generate",
    category: "generation",
    parent: "research",
    name: "Synthesize",
    description: "A sourced answer from the scored evidence",
    provider: "claude-sonnet-4-5",
    inputs: [port("prompt", "string")],
    outputs: [port("structured", "object")],
  },
  {
    id: "completeness",
    kind: "task",
    nodeType: "flowaid.decision.batch",
    category: "decision",
    parent: "research",
    name: "Complete?",
    description: "Is the answer complete, and what is the main gap?",
    inputs: [port("state", "object")],
    outputs: [port("answers", "object")],
  },
  {
    id: "out_done",
    kind: "output",
    category: "flow",
    name: "Answer",
    inputs: [port("value", "object")],
    outputs: [],
  },
  {
    id: "out_partial",
    kind: "output",
    category: "flow",
    name: "Best effort",
    inputs: [port("value", "object")],
    outputs: [],
  },
];

/** Control edges (`definition.edges`) and the data edges the bindings resolve to. */
export const researchAgentEdges: WorkflowEdgeView[] = [
  {
    id: "c1",
    kind: "control",
    source: "research",
    sourceHandle: "ctl:done",
    target: "out_done",
    targetHandle: "ctl-in",
  },
  {
    id: "c2",
    kind: "control",
    source: "research",
    sourceHandle: "ctl:exhausted",
    target: "out_partial",
    targetHandle: "ctl-in",
  },
  {
    id: "d:start.question→planner.prompt",
    kind: "data",
    via: "template",
    source: "start",
    sourceHandle: "out:question",
    target: "planner",
    targetHandle: "in:prompt",
  },
  {
    id: "d:planner.structured→search_all.items",
    kind: "data",
    source: "planner",
    sourceHandle: "out:structured",
    target: "search_all",
    targetHandle: "in:items",
    path: "/queries",
  },
  {
    id: "d:web.body→judge.state",
    kind: "data",
    via: "expr",
    source: "web",
    sourceHandle: "out:body",
    target: "judge",
    targetHandle: "in:state",
  },
  {
    id: "d:start.question→judge.state",
    kind: "data",
    source: "start",
    sourceHandle: "out:question",
    target: "judge",
    targetHandle: "in:state",
  },
  {
    id: "d:store.result→synthesis.prompt",
    kind: "data",
    via: "template",
    source: "store",
    sourceHandle: "out:result",
    target: "synthesis",
    targetHandle: "in:prompt",
  },
  {
    id: "d:synthesis.structured→completeness.state",
    kind: "data",
    source: "synthesis",
    sourceHandle: "out:structured",
    target: "completeness",
    targetHandle: "in:state",
    path: "/answer",
  },
  {
    id: "d:research.result→out_done.value",
    kind: "data",
    source: "research",
    sourceHandle: "out:result",
    target: "out_done",
    targetHandle: "in:value",
  },
  {
    id: "d:research.carry→out_partial.value",
    kind: "data",
    source: "research",
    sourceHandle: "out:carry",
    target: "out_partial",
    targetHandle: "in:value",
  },
];

/**
 * Every dependency between nodes, for layout: the drawn edges plus the ones that flow through
 * config expressions (`store` reads `search_all.results`, `completeness` reads `store.result`).
 */
export const researchAgentDependencies: Array<{ source: string; target: string }> = [
  ...researchAgentEdges.map((e) => ({ source: e.source, target: e.target })),
  { source: "search_all", target: "store" },
  { source: "store", target: "completeness" },
];

/**
 * `definition.layout` for the canvas projection: top-level nodes in flow coordinates, body nodes
 * relative to their frame's top-left (xyflow's `parentId` convention), and each frame's fitted
 * `w`/`h`. It is what the canvas's compound auto layout produces for this graph (`nodeGap` 32,
 * `layerGap` 72); the JSON fixture's own `layout` predates parent-relative positions.
 */
export const researchAgentLayout: Layout = {
  nodes: {
    start: { x: 0, y: 118 },
    research: { x: 304, y: 0, w: 1848, h: 268 },
    planner: { x: 24, y: 114 },
    search_all: { x: 328, y: 64, w: 584, h: 180 },
    web: { x: 24, y: 64 },
    judge: { x: 328, y: 70 },
    store: { x: 984, y: 114 },
    synthesis: { x: 1288, y: 114 },
    completeness: { x: 1592, y: 114 },
    out_done: { x: 2224, y: 86 },
    out_partial: { x: 2224, y: 150 },
  },
};

const RUN_ID = "0192f0a1-5b3c-7d4e-8f60-1a2b3c4d5e6f";

/**
 * A mid-run event log: rounds 1 and 2 of the loop completed, round 3 is running with three of
 * its four searches done and the fourth being judged. Every event validates against
 * `RunEventSchema`, so `foldRunEvents` folds it into node runs whose `progress` drives the
 * badges (`research` 3/5, `search_all` 3/4).
 */
export function researchAgentEvents(): unknown[] {
  const events: unknown[] = [];
  let seq = 0;
  let runSerial = 0;
  let clock = Date.parse("2026-09-22T10:00:00.000Z");
  const at = () => {
    clock += 250;
    return new Date(clock).toISOString();
  };
  const nodeRunId = () => {
    runSerial += 1;
    return `0192f0a1-5b3c-7d4e-8f60-${runSerial.toString(16).padStart(12, "0")}`;
  };
  const base = (id: string, nodeId: string, scope: string) => ({
    runId: RUN_ID,
    seq: seq++,
    at: at(),
    nodeRunId: id,
    nodeId,
    scope,
    attempt: 1,
  });
  const started = (id: string, nodeId: string, scope: string) =>
    events.push({
      ...base(id, nodeId, scope),
      type: "NODE_STARTED",
      input: {},
      pool: "general",
      workerId: "worker-general-01",
    });
  const completed = (id: string, nodeId: string, scope: string, output: unknown = {}) =>
    events.push({
      ...base(id, nodeId, scope),
      type: "NODE_COMPLETED",
      output,
      firedPorts: ["done"],
      usage: null,
      costUsd: 0,
      latencyMs: 250,
      reused: false,
    });
  const task = (
    nodeId: string,
    scope: string,
    status: Extract<NodeRunStatus, "running" | "completed">,
  ) => {
    const id = nodeRunId();
    started(id, nodeId, scope);
    if (status === "completed") completed(id, nodeId, scope);
  };

  const research = nodeRunId();
  started(research, "research", "");
  const rounds = [
    { items: 3, done: 3 },
    { items: 2, done: 2 },
    { items: 4, done: 3 },
  ];
  rounds.forEach((round, i) => {
    const scope = `research#${i}`;
    const carry = { evidence: [], gap: i === 0 ? "none" : "missing_data" };
    events.push({
      ...base(research, "research", ""),
      type: "LOOP_ITERATION_STARTED",
      iteration: i,
      childScope: scope,
      carry,
    });
    task("planner", scope, "completed");
    const searchAll = nodeRunId();
    started(searchAll, "search_all", scope);
    events.push({
      ...base(searchAll, "search_all", scope),
      type: "FOREACH_STARTED",
      itemCount: round.items,
      concurrency: 4,
    });
    for (let item = 0; item < round.items; item++) {
      const itemScope = `${scope}/search_all#${item}`;
      const finished = item < round.done;
      task("web", itemScope, "completed");
      task("judge", itemScope, finished ? "completed" : "running");
      if (finished) {
        events.push({
          ...base(searchAll, "search_all", scope),
          type: "FOREACH_ITEM_COMPLETED",
          index: item,
          childScope: itemScope,
          status: "completed",
          result: { query: `query ${item + 1}` },
          error: null,
        });
      }
    }
    if (round.done < round.items) return;
    completed(searchAll, "search_all", scope, { results: [] });
    task("store", scope, "completed");
    task("synthesis", scope, "completed");
    task("completeness", scope, "completed");
    events.push({
      ...base(research, "research", ""),
      type: "LOOP_ITERATION_COMPLETED",
      iteration: i,
      childScope: scope,
      carry,
      result: { answer: "partial" },
      exit: false,
      usage: { inputTokens: 3120, outputTokens: 410 },
      costUsd: 0.0021,
    });
  });
  return events;
}
