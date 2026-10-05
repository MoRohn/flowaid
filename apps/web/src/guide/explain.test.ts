import { describe, expect, it } from "vitest";
import { WorkflowDefinitionSchema, type WorkflowDefinition } from "@flowaid/workflow-core";
import type { NodeRunView } from "@flowaid/ui";
import {
  describeCalculation,
  describeRule,
  describeTemplate,
  explainRun,
  explainStep,
  explainWorkflow,
  nextForRun,
  words,
} from "./explain";

const port = (node: string, p: string, path?: string) => ({
  kind: "ref" as const,
  ref: { kind: "port" as const, node, port: p, ...(path ? { path } : {}) },
});

/** A small refund flow: the same shape as the business flow, with fewer fields. */
const def: WorkflowDefinition = WorkflowDefinitionSchema.parse({
  $schema: "https://flowaid.dev/schemas/workflow/v1",
  id: "e8b2f5a3-1c69-4d07-a3f4-5d8c2b0e9a71",
  outputs: { type: "object" },
  name: "Refunds",
  inputs: {
    type: "object",
    required: ["order_total"],
    properties: {
      order_total: { type: "number", title: "Order total (USD)", description: "What they paid." },
      note: { type: "string" },
    },
  },
  variables: [
    {
      name: "autoRefundLimit",
      schema: { type: "number" },
      default: 50,
      description: "Paid without a person up to this total.",
    },
  ],
  execution: {},
  nodes: [
    { id: "start", kind: "input", name: "Refund request" },
    {
      id: "assess",
      kind: "task",
      type: "flowaid.decision.batch",
      typeVersion: "1.0.0",
      name: "Assess the request",
      config: {
        questions: {
          reason: {
            kind: "choice",
            instructions: "Why do they want a refund?",
            options: { damaged: "Arrived damaged", changed_mind: "Changed their mind" },
          },
          eligible: {
            kind: "boolean",
            instructions: "Does the policy allow this refund?",
            criteria: { true: "Allowed", false: "Not allowed" },
          },
          risk: {
            kind: "score",
            instructions: "How risky is it?",
            levels: ["None", "Low", "Moderate", "High", "Very high"],
          },
        },
      },
      inputs: {},
    },
    {
      id: "limits",
      kind: "task",
      type: "flowaid.data.transform",
      typeVersion: "1.0.0",
      name: "Apply the limits",
      config: {
        expr: "{ refund: assess.answers.eligible.value && assess.answers.risk.value < 1.5 && start.order_total <= $vars.autoRefundLimit, decline: !assess.answers.eligible.value }",
      },
      inputs: {},
    },
    {
      id: "route",
      kind: "branch",
      name: "Decide automatically?",
      cases: [
        { port: "refund", when: "limits.result.refund" },
        { port: "decline", when: "limits.result.decline" },
      ],
      defaultPort: "review",
    },
    {
      id: "agent",
      kind: "human",
      name: "Agent review",
      mode: { type: "approval" },
      title: {
        kind: "template",
        source: "Refund ${{ start.order_total }} ({{ assess.answers.reason.value }})?",
      },
      expiresInMs: 172_800_000,
    },
    {
      id: "out_refund",
      kind: "output",
      name: "Refund automatically",
      outcome: "refunded",
      value: { kind: "object", fields: { total: port("start", "order_total") } },
    },
    {
      id: "out_decline",
      kind: "output",
      name: "Decline",
      value: { kind: "literal", value: null },
    },
    {
      id: "out_ok",
      kind: "output",
      name: "Refund (approved)",
      value: { kind: "literal", value: null },
    },
    {
      id: "out_no",
      kind: "output",
      name: "Decline (by an agent)",
      value: { kind: "literal", value: null },
    },
    {
      id: "out_late",
      kind: "output",
      name: "Not answered",
      value: { kind: "literal", value: null },
    },
    { id: "howto", kind: "note", name: "How to make it yours", text: "Change the limit." },
  ],
  edges: [
    { id: "e1", from: { node: "route", port: "refund" }, to: { node: "out_refund" } },
    { id: "e2", from: { node: "route", port: "decline" }, to: { node: "out_decline" } },
    { id: "e3", from: { node: "route", port: "review" }, to: { node: "agent" } },
    { id: "e4", from: { node: "agent", port: "approved" }, to: { node: "out_ok" } },
    { id: "e5", from: { node: "agent", port: "rejected" }, to: { node: "out_no" } },
    { id: "e6", from: { node: "agent", port: "expired" }, to: { node: "out_late" } },
  ],
  layout: {
    nodes: {
      start: { x: 0, y: 0 },
      assess: { x: 200, y: 0 },
      limits: { x: 400, y: 0 },
      route: { x: 600, y: 0 },
      agent: { x: 800, y: 100 },
    },
  },
});

const node = (id: string) => {
  const n = def.nodes.find((x) => x.id === id);
  if (!n) throw new Error(id);
  return n;
};

describe("words", () => {
  it("turns code names into plain words", () => {
    expect(words("autoRefundLimit")).toBe("auto refund limit");
    expect(words("needs_person")).toBe("needs person");
  });
});

describe("rules", () => {
  it("reads a yes/no value as a statement and names answers, inputs and settings", () => {
    expect(describeRule("limits.result.refund", def)).toBe(
      "the refund from “Apply the limits” is yes",
    );
    expect(describeRule("!assess.answers.eligible.value", def)).toBe("the eligible answer is no");
    expect(describeRule("start.order_total <= $vars.autoRefundLimit", def)).toBe(
      "the Order total (USD) is at most the auto refund limit setting (now 50)",
    );
  });

  it("groups an 'or' inside an 'and', so the sentence keeps its meaning", () => {
    expect(
      describeRule(
        "assess.answers.eligible.value && (start.order_total < 10 || assess.answers.risk.value == 0)",
        def,
      ),
    ).toBe(
      "the eligible answer is yes and either the Order total (USD) is less than 10 or the risk answer is 0",
    );
  });

  it("puts an if/otherwise inside a calculation in brackets", () => {
    expect(
      describeCalculation(
        "round(min(100, assess.answers.risk.value * 20 + (assess.answers.eligible.value ? 10 : 0)))",
        def,
      ),
    ).toEqual([
      "The smaller of 100 and the risk answer times 20 plus (10 if the eligible answer is yes, else 0), rounded",
    ]);
  });

  it("gives one line per field a calculation works out, even when the text has semicolons", () => {
    expect(describeCalculation('{ a: start.note == "x; y", b: 1 }', def)).toEqual([
      "A: the Note is “x; y”",
      "B: 1",
    ]);
  });

  it("falls back to the source when it does not parse", () => {
    expect(describeRule("start.(", def)).toBe("start.(");
    expect(describeCalculation("start.(", def)).toEqual(["start.("]);
  });

  it("marks each value in a template", () => {
    expect(describeTemplate("Refund ${{ start.order_total }}?", def)).toBe(
      "Refund $[the Order total (USD)]?",
    );
  });
});

describe("explainStep", () => {
  it("lists the fields a run asks for", () => {
    const s = explainStep(node("start"), def);
    expect(s.details).toEqual(["Order total (USD) (required): What they paid.", "Note (optional)"]);
  });

  it("gives each decision question with its possible answers", () => {
    const s = explainStep(node("assess"), def);
    expect(s.summary).toMatch(/^Asks TypeSafe 3 questions in one call/);
    expect(s.details).toEqual([
      "Reason: Why do they want a refund? One of: “damaged” and “changed mind”.",
      "Eligible: Does the policy allow this refund? Yes means “Allowed”; no means “Not allowed”.",
      "Risk: How risky is it? On a scale from “None” to “Very high”.",
    ]);
  });

  it("explains each rule of a branch and where it leads", () => {
    expect(explainStep(node("route"), def).details).toEqual([
      "If the refund from “Apply the limits” is yes, it goes to “Refund automatically”.",
      "If the decline from “Apply the limits” is yes, it goes to “Decline”.",
      "Otherwise it goes to “Agent review”.",
    ]);
  });

  it("explains a person's step: what they see, who answers, each outcome and the time limit", () => {
    expect(explainStep(node("agent"), def).details).toEqual([
      "A person sees: “Refund $[the Order total (USD)] ([the reason answer])?”.",
      "Anyone allowed to approve runs can answer.",
      "If approved, it goes to “Refund (approved)”.",
      "If rejected, it goes to “Decline (by an agent)”.",
      "If nobody answers within 2 days, it goes to “Not answered”.",
    ]);
  });

  it("explains a calculation one result per line", () => {
    expect(explainStep(node("limits"), def).details).toEqual([
      "Refund: the eligible answer is yes and the risk answer is less than 1.5 and the Order total (USD) is at most the auto refund limit setting (now 50)",
      "Decline: the eligible answer is no",
    ]);
  });

  it("names an end's outcome and what it returns", () => {
    const s = explainStep(node("out_refund"), def);
    expect(s.summary).toContain("the outcome “refunded”");
    expect(s.details).toEqual(["Total: the Order total (USD)"]);
  });

  it("uses a node type's own description for other tasks", () => {
    const task = { ...node("limits"), type: "flowaid.http.request", config: {} } as never;
    expect(
      explainStep(task, def, { metadata: { description: "Calls a web address." } } as never),
    ).toEqual({ summary: "Calls a web address.", details: [] });
  });
});

describe("explainWorkflow", () => {
  it("tells the steps in canvas order, then the outcomes and the settings", () => {
    const w = explainWorkflow(def);
    expect(w.steps.map((s) => s.name)).toEqual([
      "Refund request",
      "Assess the request",
      "Apply the limits",
      "Decide automatically?",
      "Agent review",
    ]);
    expect(w.outcomes).toEqual([
      "Refund automatically",
      "Decline",
      "Refund (approved)",
      "Decline (by an agent)",
      "Not answered",
    ]);
    expect(w.settings).toEqual([
      "Auto refund limit (now 50): Paid without a person up to this total.",
    ]);
  });
});

function nr(nodeId: string, at: number, extra: Partial<NodeRunView> = {}): NodeRunView {
  const n = node(nodeId);
  return {
    id: `nr-${nodeId}`,
    nodeId,
    nodeName: n.name,
    nodeType: n.kind === "task" ? n.type : n.kind,
    category: n.kind === "human" ? "human" : "logic",
    status: "completed",
    attempt: 1,
    startedAt: new Date(Date.UTC(2026, 8, 29, 12, 0, at)).toISOString(),
    ...extra,
  } as NodeRunView;
}

describe("explainRun", () => {
  const answers = {
    risk: { value: 0, confidence: 0.88 },
    reason: { value: "damaged", confidence: 0.97 },
    eligible: { value: true, confidence: 0.951 },
  };

  it("tells what happened, in the order it happened, with how sure each answer was", () => {
    const run = {
      status: "completed" as const,
      nodeRuns: [
        nr("out_ok", 20),
        nr("start", 0),
        nr("assess", 1, { output: { answers } }),
        nr("limits", 2),
        nr("route", 3, { routeTaken: "review", firedPorts: ["review"] }),
        nr("agent", 4, { routeTaken: "approved", firedPorts: ["approved"], durationMs: 17_300 }),
        nr("out_refund", 0, { status: "skipped" }),
      ],
    };
    expect(explainRun(run, def)).toEqual([
      "A request came in.",
      "TypeSafe checked it in “Assess the request”: reason: damaged (97% sure), eligible: yes (95% sure) and risk: none (88% sure).",
      "“Decide automatically?” chose “review”, so the run went to “Agent review”.",
      "A person approved “Agent review” after 17 seconds.",
      "It finished at “Refund (approved)”.",
    ]);
  });

  it("says where a run is waiting for a person", () => {
    const run = {
      status: "waiting_for_human" as const,
      nodeRuns: [nr("start", 0), nr("agent", 1, { status: "waiting" })],
    };
    expect(explainRun(run, def)).toEqual([
      "A request came in.",
      "It is waiting for a person to answer “Agent review” under Human tasks.",
    ]);
    expect(nextForRun(run)[0]).toMatch(/^Open Human tasks/);
  });

  it("says where and why a run stopped", () => {
    const run = {
      status: "failed" as const,
      nodeRuns: [
        nr("start", 0),
        nr("assess", 1, {
          status: "failed",
          error: {
            code: "NODE_EXECUTION_ERROR",
            message: "No TypeSafe key is set",
            retryable: false,
          },
        }),
      ],
      error: { code: "NODE_EXECUTION_ERROR", message: "No TypeSafe key is set", retryable: false },
    };
    expect(explainRun(run as never, def)).toEqual([
      "A request came in.",
      "It stopped at “Assess the request”: No TypeSafe key is set.",
    ]);
    expect(nextForRun(run as never).join(" ")).toContain("Retry");
  });

  it("takes how long a person took from the wait, not the step's run time", () => {
    const run = {
      status: "completed" as const,
      nodeRuns: [
        // the step itself ran in no time once answered; the person took 65 s
        nr("agent", 4, {
          firedPorts: ["rejected"],
          durationMs: 0,
          endedAt: new Date(Date.UTC(2026, 8, 29, 12, 1, 9)).toISOString(),
        }),
      ],
    };
    expect(explainRun(run, def)).toContain("A person rejected “Agent review” after 1 minute.");
    expect(
      explainRun(
        {
          ...run,
          nodeRuns: [
            nr("agent", 4, {
              firedPorts: ["approved"],
              durationMs: 0,
              endedAt: new Date(Date.UTC(2026, 8, 29, 12, 0, 21)).toISOString(),
            }),
          ],
        },
        def,
      ),
    ).toContain("A person approved “Agent review” after 17 seconds.");
  });

  it("never says a person answered when nobody did: cancelled and timed-out runs", () => {
    const unanswered = (status: "cancelled" | "timed_out" | "failed") => ({
      status,
      nodeRuns: [nr("start", 0), nr("agent", 1, { status: "cancelled", durationMs: 300_000 })],
    });
    expect(explainRun(unanswered("cancelled"), def)).toEqual([
      "A request came in.",
      "Nobody answered “Agent review” before the run was cancelled.",
      "It was cancelled.",
    ]);
    expect(explainRun(unanswered("timed_out"), def, { timeoutMs: 20_000 })).toEqual([
      "A request came in.",
      "Nobody answered “Agent review” before the run reached its time limit.",
      "It stopped at the run's time limit of 20 seconds.",
    ]);
    const failed = explainRun(unanswered("failed"), def);
    expect(failed).toContain("Nobody answered “Agent review” before the run failed.");
    // a step still marked waiting in a run that ended was not answered either
    expect(
      explainRun(
        { status: "timed_out", nodeRuns: [nr("agent", 1, { status: "waiting" })] },
        { ...def, execution: { ...def.execution, timeoutMs: 180_000 } },
      ),
    ).toEqual([
      "Nobody answered “Agent review” before the run reached its time limit.",
      "It stopped at the run's time limit of 3 minutes.",
    ]);
    for (const status of ["cancelled", "timed_out"] as const)
      expect(explainRun(unanswered(status), def).join(" ")).not.toMatch(
        /A person (answered|approved|rejected)/,
      );
  });

  it("gives a timed-out run its own next steps, with no failed step to open", () => {
    const next = nextForRun({ status: "timed_out", nodeRuns: [] }).join(" ");
    expect(next).toContain("time limit");
    expect(next).toContain("Replay");
    expect(next).not.toContain("marked failed");
  });

  it("tells a step retried in place once, as its latest attempt", () => {
    const error = {
      code: "NETWORK_ERROR" as const,
      message: "upstream returned 503",
      retryable: true,
    };
    const run = {
      status: "failed" as const,
      nodeRuns: [
        nr("start", 0),
        nr("assess", 1, { id: "a1", status: "failed", attempt: 1, error }),
        nr("assess", 5, { id: "a2", status: "failed", attempt: 2, error }),
      ],
      error,
    };
    expect(explainRun(run, def)).toEqual([
      "A request came in.",
      "It stopped at “Assess the request”: upstream returned 503.",
    ]);
  });

  it("still tells a short story without the definition", () => {
    expect(
      explainRun({
        status: "completed",
        nodeRuns: [nr("route", 1, { routeTaken: "refund" })],
      }),
    ).toEqual(["“Decide automatically?” chose “refund”.", "It finished."]);
  });
});
