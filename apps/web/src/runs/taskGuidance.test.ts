import { describe, expect, it } from "vitest";
import type { WorkflowNode } from "@flowaid/workflow-core";
import type { HumanTask } from "~/api/types";
import { taskGuidance } from "./taskGuidance";

const request = (over: Partial<HumanTask["request"]> = {}): HumanTask["request"] => ({
  title: "Approve the refund",
  context: {},
  mode: { type: "approval" },
  assignees: [],
  expiresAt: null,
  externalReview: false,
  origin: "human_node",
  ...over,
});

const humanNode = (over: Record<string, unknown> = {}) =>
  ({
    id: "approve",
    kind: "human",
    mode: { type: "approval" },
    title: "Approve",
    context: {},
    assignees: [],
    onExpire: "fail",
    externalReview: false,
    ...over,
  }) as unknown as WorkflowNode;

describe("taskGuidance", () => {
  it("explains approve and reject on a Human step that never expires", () => {
    const g = taskGuidance({ request: request(), expiresAt: null }, humanNode());
    expect(g.why).toMatch(/Human step/);
    expect(g.outcomes.map((o) => o.answer)).toEqual(["Approve", "Reject"]);
    expect(g.outcomes[1]?.effect).toMatch(/rejected path/);
    expect(g.timing).toEqual([]);
  });

  it("names each option of a choice", () => {
    const g = taskGuidance(
      {
        request: request({
          mode: {
            type: "choice",
            options: [
              { id: "refund", label: "Refund" },
              { id: "replace", label: "Replace" },
            ],
          },
        }),
        expiresAt: null,
      },
      undefined,
    );
    expect(g.outcomes.map((o) => o.answer)).toEqual(["Refund", "Replace"]);
    expect(g.outcomes[0]?.effect).toMatch(/“Refund” path/);
  });

  it("says a review continues with the edited value", () => {
    const g = taskGuidance(
      {
        request: request({ mode: { type: "review", value: {}, schema: {} } }),
        expiresAt: null,
      },
      undefined,
    );
    expect(g.outcomes[0]?.effect).toMatch(/edits included/);
  });

  it("follows the step's expiry rule", () => {
    const at = "2026-09-30T00:00:00.000Z";
    expect(
      taskGuidance(
        { request: request(), expiresAt: at },
        humanNode({ expiresInMs: 3_600_000, onExpire: "route" }),
      ).timing,
    ).toEqual(["If nobody answers in time, the run continues on this step's expired path."]);
    expect(
      taskGuidance({ request: request(), expiresAt: at }, humanNode({ expiresInMs: 7_200_000 }))
        .timing[0],
    ).toMatch(/this step fails/);
    const escalated = taskGuidance(
      { request: request(), expiresAt: at },
      humanNode({
        expiresInMs: 86_400_000,
        onExpire: "escalate",
        escalation: { afterMs: 1_800_000, to: ["role:admin"] },
      }),
    ).timing;
    expect(escalated[0]).toMatch(/After 30 minutes/);
    expect(escalated[1]).toMatch(/waits another 24 hours/);
  });

  it("explains an agent's tool approval", () => {
    const g = taskGuidance(
      { request: request({ origin: "task_suspend" }), expiresAt: null },
      undefined,
    );
    expect(g.why).toMatch(/tool call/);
    expect(g.outcomes[1]?.effect).toMatch(/not approved/);
  });

  it("explains a decision handed to a person", () => {
    const g = taskGuidance(
      { request: request({ origin: "decision_failover" }), expiresAt: "2026-09-30T00:00:00Z" },
      undefined,
    );
    expect(g.why).toMatch(/TypeSafe/);
    expect(g.outcomes).toHaveLength(1);
    expect(g.timing[0]).toMatch(/decision step fails/);
  });
});
