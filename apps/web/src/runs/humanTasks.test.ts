import { describe, expect, it } from "vitest";
import type { HumanTask } from "~/api/types";
import {
  externalToApproval,
  humanizeId,
  respondedRecord,
  taskToPending,
  tokenFromHash,
} from "./humanTasks";

const task = {
  id: "t1",
  runId: "r1",
  nodeRunId: "nr1",
  nodeId: "approve_refund",
  scope: "",
  workflowId: "w1",
  request: {
    title: "Approve the refund",
    context: { amount: 42 },
    mode: { type: "approval" },
    assignees: ["u1"],
    expiresAt: null,
    externalReview: true,
    origin: "human_node",
  },
  status: "responded",
  assignees: ["u1"],
  response: { action: "approve" },
  respondedBy: "review_token:abc",
  respondedAt: "2026-09-27T10:00:00.000Z",
  expiresAt: null,
  createdAt: "2026-09-27T09:00:00.000Z",
} as HumanTask;

describe("human task views", () => {
  it("humanizes node ids", () => {
    expect(humanizeId("approve_refund")).toBe("Approve refund");
    expect(humanizeId("x")).toBe("X");
  });

  it("maps a task to an inbox row with the assignee's name", () => {
    const row = taskToPending(task, "Refunds", [
      {
        userId: "u1",
        email: "ada@example.com",
        name: "Ada",
        role: "editor",
        status: "active",
        joinedAt: "",
      },
    ]);
    expect(row).toMatchObject({
      nodeName: "Approve refund",
      workflowName: "Refunds",
      assigneeName: "Ada",
    });
  });

  it("names external reviewers without exposing the token id", () => {
    expect(respondedRecord(task)).toMatchObject({
      by: "External reviewer",
      response: { action: "approve" },
    });
    expect(respondedRecord({ ...task, response: null })).toBeUndefined();
  });

  it("reads only well-formed tokens from the fragment", () => {
    expect(tokenFromHash("#t=jrgmoNaNvCn8IkeifDfhEBhIybgBDfu7SNRHs4-DcI0")).toBe(
      "jrgmoNaNvCn8IkeifDfhEBhIybgBDfu7SNRHs4-DcI0",
    );
    expect(tokenFromHash("")).toBeNull();
    expect(tokenFromHash("#t=short")).toBeNull();
    expect(tokenFromHash("#t=<script>alert(1)</script>xxxxxxxx")).toBeNull();
  });

  it("builds the external card from the review view only: no run or node ids", () => {
    const a = externalToApproval({
      title: "Approve the refund",
      mode: { type: "approval" },
      context: { amount: 42 },
      expiresAt: "2026-10-01T00:00:00.000Z",
      workflowName: "Refunds",
    });
    expect(a.id).toBe("");
    expect(a.runId).toBe("");
    expect(JSON.stringify(a)).not.toMatch(/r1|nr1|approve_refund/);
    expect(a.request).toMatchObject({
      title: "Approve the refund",
      externalReview: true,
      assignees: [],
    });
  });
});
