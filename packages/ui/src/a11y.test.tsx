/**
 * axe-core over the components P0-19 touched (canvas keyboard model, inspector heading,
 * charts, edge labels, decision badge, primitives, trace rulers and the title → Tooltip /
 * Hint replacements), rendered with the gallery fixtures. `color-contrast` needs real layout
 * and is covered by the Playwright gallery suite (P0-20); every other rule must pass.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { MotionGlobalConfig } from "motion/react";
import type { ReactElement } from "react";
import { applyAutoLayout, FlowCanvas } from "@/canvas";
import {
  SAMPLE_CATALOG,
  SAMPLE_DIAGNOSTICS,
  SAMPLE_EDGES,
  buildSampleRun as buildCanvasRun,
  toCanvasEdges,
  toCanvasNodes,
} from "@/canvas/sampleWorkflow";
import { ConfidenceSparkbar, DecisionBadge } from "@/decision";
import { RelativeTime, SortableHeader } from "@/data";
import { SlaChip } from "@/human";
import { makeBooleanDecision, makeChoiceDecision, makeScoreDecision } from "@/lib/decisionBuilders";
import {
  Inspector,
  KeyValueList,
  PortTypeLabel,
  TimingBreakdown,
  WorkflowDiffSummary,
} from "@/inspector";
import { installLayoutStubs } from "@/node/flowTestStubs";
import {
  BarChart,
  Heatmap,
  LatencyHistogram,
  MetricTile,
  Sparkline,
  StackedAreaChart,
  TimeSeriesChart,
} from "@/observability";
import { buildOverviewSample } from "@/observability/sampleData";
import { emptyWorkflowDiff } from "@/lib/workflowDiff";
import { Avatar, Badge, Hint, Kbd, Shortcut, StatusChip, Switch, Tooltip } from "@/primitives";
import { installDomStubs } from "@/primitives/testStubs";
import { RunStatusTimeline, TraceTimeRuler, TraceTimeline } from "@/trace";
import { SAMPLE_TRANSITIONS, buildSampleRun } from "@/trace/sampleRun";
import type { NodeRunView, WorkflowDiff, WorkflowNodeView } from "@/types";

installDomStubs();
let restoreLayout: () => void = () => undefined;
beforeAll(() => {
  restoreLayout = installLayoutStubs();
  // No animations: charts render their final frame, so none is cancelled mid-flight when a
  // test unmounts (axe does not need the transitions).
  MotionGlobalConfig.skipAnimations = true;
});
afterAll(() => {
  restoreLayout();
  MotionGlobalConfig.skipAnimations = false;
});
afterEach(cleanup);

async function violations(root: Element): Promise<string[]> {
  const result = await axe.run(root, { rules: { "color-contrast": { enabled: false } } });
  return result.violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.html.slice(0, 160)}`));
}

async function expectNoViolations(ui: ReactElement) {
  const { container } = render(<main>{ui}</main>);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  expect(await violations(container)).toEqual([]);
}

const NODE: WorkflowNodeView = {
  id: "n_intent",
  kind: "task",
  nodeType: "flowaid.decision.choice",
  category: "decision",
  name: "Classify intent",
  description: "Route the ticket to a team",
  provider: "jev-latest",
  inputs: [{ id: "ticket", label: "ticket", type: "message", required: true }],
  outputs: [{ id: "decision", label: "decision", type: "decision" }],
};

const RUN: NodeRunView = {
  id: "nr_1",
  nodeId: "n_intent",
  nodeName: "Classify intent",
  nodeType: "flowaid.decision.choice",
  category: "decision",
  status: "completed",
  attempt: 1,
  startedAt: "2026-09-21T08:14:03.048Z",
  endedAt: "2026-09-21T08:14:03.460Z",
  durationMs: 412,
  decision: makeChoiceDecision({
    probabilities: { billing: 0.81, technical: 0.19 },
    provider: "jev",
    model: "jev-latest",
    latencyMs: 388,
  }),
  input: { ticket: "hi" },
  output: { intent: "billing" },
};

const DIFF: WorkflowDiff = {
  ...emptyWorkflowDiff(),
  nodes: {
    added: ["n5"],
    removed: ["n3"],
    changed: [{ id: "n1", patch: [{ op: "replace", path: "/config/threshold", value: 0.9 }] }],
  },
  edges: { added: ["e9"], removed: [] },
};

const sample = buildOverviewSample();
const HOUR = 3_600_000;
const T0 = Date.parse("2026-09-14T00:00:00Z");
const timestamps = Array.from({ length: 24 }, (_, i) => T0 + i * HOUR);

describe("axe: touched components have no violations", () => {
  it("FlowCanvas with a run, labelled edges, diagnostics and the palette button", async () => {
    await expectNoViolations(
      <div style={{ width: 1200, height: 800 }}>
        <FlowCanvas
          nodes={applyAutoLayout(toCanvasNodes(), SAMPLE_EDGES)}
          edges={toCanvasEdges()}
          onNodesChange={() => undefined}
          onEdgesChange={() => undefined}
          onConnect={() => undefined}
          catalog={SAMPLE_CATALOG}
          run={buildCanvasRun(6)}
          diagnostics={SAMPLE_DIAGNOSTICS}
          defaultShowMinimap={false}
        />
      </div>,
    );
  });

  it("the canvas connect list", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <div style={{ width: 1200, height: 800 }}>
        <FlowCanvas
          nodes={applyAutoLayout(toCanvasNodes(), SAMPLE_EDGES)}
          edges={toCanvasEdges()}
          onNodesChange={() => undefined}
          onEdgesChange={() => undefined}
          onConnect={() => undefined}
          defaultShowMinimap={false}
        />
      </div>,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    const node = container.querySelector(".react-flow__node");
    if (!(node instanceof HTMLElement)) throw new Error("no node");
    node.focus();
    await user.keyboard("c");
    const list = await screen.findByRole("dialog");
    expect(await violations(list)).toEqual([]);
  });

  it("Inspector with a rename heading, hints and a run", async () => {
    await expectNoViolations(<Inspector node={NODE} nodeRun={RUN} onRename={() => undefined} />);
  });

  it("inspector pieces: KeyValueList, PortTypeLabel, TimingBreakdown, WorkflowDiffSummary", async () => {
    await expectNoViolations(
      <div>
        <KeyValueList
          items={[{ label: "Model", value: "jev-latest", title: "typesafe:jev-latest (pinned)" }]}
        />
        <PortTypeLabel type="string" required />
        <TimingBreakdown timing={{ queueMs: 12, executionMs: 380, retryMs: 40 }} />
        <WorkflowDiffSummary diff={DIFF} onSelectNode={() => undefined} />
      </div>,
    );
  });

  it("charts: StackedAreaChart, TimeSeriesChart, BarChart, LatencyHistogram, Heatmap, Sparkline, MetricTile", async () => {
    await expectNoViolations(
      <div>
        <StackedAreaChart
          timestamps={timestamps}
          series={[
            { id: "a", label: "OpenAI", values: timestamps.map((_, i) => i) },
            { id: "b", label: "Anthropic", values: timestamps.map((_, i) => 24 - i) },
          ]}
          width={600}
          height={200}
        />
        <TimeSeriesChart
          timestamps={timestamps}
          series={[{ id: "runs", label: "Runs", values: timestamps.map((_, i) => i * 3) }]}
          width={600}
          height={200}
        />
        <BarChart
          data={[
            { id: "a", label: "Intent", value: 212 },
            { id: "b", label: "Reply", value: 2140 },
          ]}
          width={400}
          height={160}
          label="P50 by node"
        />
        <LatencyHistogram values={sample.latencies.slice(0, 200)} width={500} height={200} />
        <Heatmap
          rows={["Mon", "Tue"]}
          columns={["00", "01", "02"]}
          values={[
            [0, 5, 10],
            [2, 0, 8],
          ]}
          width={300}
          label="Runs by hour"
        />
        <Sparkline data={[1, 3, 2, 5]} label="Trend" />
        <MetricTile label="Runs" value={1200} trend={[1, 2, 3, 2, 4]} />
      </div>,
    );
  });

  it("DecisionBadge as a button, closed and with its distribution open", async () => {
    const user = userEvent.setup();
    const choice = makeChoiceDecision({ probabilities: { security: 0.81, billing: 0.19 } });
    const { container } = render(
      <main>
        <DecisionBadge result={choice} question="Which team?" />
        <DecisionBadge result={makeBooleanDecision({ pYes: 0.96 })} />
        <DecisionBadge
          result={makeScoreDecision({
            probabilities: { "1": 0.1, "2": 0.2, "3": 0.7 },
            levels: ["Low", "Mid", "High"],
          })}
          distribution={false}
        />
      </main>,
    );
    expect(await violations(container)).toEqual([]);
    await user.click(screen.getByRole("button", { name: "security 0.81" }));
    expect(await violations(await screen.findByRole("dialog"))).toEqual([]);
  });

  it("primitives: Badge, Kbd, Shortcut, Avatar, Tooltip, Switch, StatusChip, Hint", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <main>
        <Badge category="decision">
          <span aria-hidden="true">●</span>
        </Badge>
        <Badge size="sm">sm</Badge>
        <Kbd>K</Kbd>
        <Kbd size="sm">K</Kbd>
        <Shortcut shortcut="mod+shift+p" platform="mac" separate />
        <Avatar name="Ada Lovelace" size="xs" />
        <Avatar name="Ada Lovelace" size="md" />
        <Tooltip content="Save" shortcut="mod+s">
          <button type="button">Save</button>
        </Tooltip>
        <Switch aria-label="Follow live run" />
        <StatusChip status="failed" compact />
        <Hint hint="Waiting since request">4 m</Hint>
      </main>,
    );
    expect(await violations(container)).toEqual([]);
    await user.hover(screen.getByRole("button", { name: "Save" }));
    const tip = await screen.findByRole("tooltip");
    expect(await violations(tip)).toEqual([]);
  });

  it("trace: TraceTimeRuler, TraceTimeline, RunStatusTimeline", async () => {
    await expectNoViolations(
      <div>
        <TraceTimeRuler totalMs={240_000} live />
        <TraceTimeline run={buildSampleRun("completed")} className="h-[400px]" />
        <RunStatusTimeline transitions={SAMPLE_TRANSITIONS} />
      </div>,
    );
  });

  it("hint replacements: SlaChip, RelativeTime, SortableHeader, ConfidenceSparkbar", async () => {
    const now = Date.parse("2026-09-22T14:06:00Z");
    await expectNoViolations(
      <div>
        <SlaChip expiresAt={now + 4 * 60_000} now={now} ticking={false} />
        <RelativeTime date={new Date(now - 60_000)} tooltip={false} />
        <RelativeTime date={new Date(now - 60_000)} />
        <table>
          <thead>
            <tr>
              <th scope="col" aria-sort="ascending">
                <SortableHeader sorted="asc">Started</SortableHeader>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <ConfidenceSparkbar value={0.72} thresholds={{ review: 0.6, auto: 0.9 }} />
              </td>
            </tr>
          </tbody>
        </table>
      </div>,
    );
  });
});
