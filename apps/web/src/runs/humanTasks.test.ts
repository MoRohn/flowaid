import { describe, expect, it } from "vitest";
import type { HumanTask } from "~/api/types";
import { ApiError } from "~/api/client";
import {
  alreadyAnswered,
  assigneeName,
  closedTaskNote,
  externalToApproval,
  humanizeId,
  inboxQuery,
  respondedRecord,
  taskToPending,
  tokenFromHash,
} from "./humanTasks";
import { taskClosedAt, taskOutcome } from "./ResolvedTasksTable";

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

describe("closed tasks", () => {
  it("asks for every closed status under Resolved, narrowed by outcome and workflow", () => {
    expect(inboxQuery("resolved")).toEqual({
      status: "responded,expired,cancelled",
      workflowId: undefined,
    });
    expect(inboxQuery("resolved", "expired", "w1")).toEqual({
      status: "expired",
      workflowId: "w1",
    });
    expect(inboxQuery("open")).toEqual({ status: "open" });
    expect(inboxQuery("mine")).toEqual({ status: "open", assignedToMe: true });
  });

  it("names the outcome and the closing time of tasks nobody answered", () => {
    const expired = {
      ...task,
      status: "expired",
      response: null,
      respondedAt: null,
      expiresAt: "2026-09-27T11:00:00.000Z",
    } as HumanTask;
    expect(taskOutcome(task)).toBe("approved");
    expect(taskOutcome(expired)).toBe("expired");
    expect(taskOutcome({ ...expired, status: "cancelled" })).toBe("cancelled");
    expect(taskClosedAt(expired)).toBe("2026-09-27T11:00:00.000Z");
    expect(taskClosedAt(task)).toBe("2026-09-27T10:00:00.000Z");
  });

  it("treats an answer the API already has as done, and other conflicts as failures", () => {
    expect(alreadyAnswered(new ApiError(409, "CONFLICT", "the task is already responded"))).toBe(
      true,
    );
    expect(
      alreadyAnswered(new ApiError(409, "CONFLICT", "the task was answered concurrently")),
    ).toBe(true);
    expect(alreadyAnswered(new ApiError(409, "CONFLICT", "the task is already expired"))).toBe(
      false,
    );
    expect(alreadyAnswered(new ApiError(500, "INTERNAL", "responded"))).toBe(false);
  });

  it("names assignees: roles in words, people by name", () => {
    const members = [{ userId: "u1", name: "Rohn", email: "r@example.com" }] as never;
    expect(assigneeName("role:admin")).toBe("Admins");
    expect(assigneeName("u1", members)).toBe("Rohn");
    expect(assigneeName("u2", members)).toBe("u2");
  });

  it("says why a task closed from how its run ended", () => {
    expect(closedTaskNote("cancelled", "timed_out")).toMatch(/time limit/);
    expect(closedTaskNote("cancelled", "cancelled")).toMatch(/was cancelled/);
    expect(closedTaskNote("cancelled", "failed")).toMatch(/failed/);
    expect(closedTaskNote("expired", "completed")).toMatch(/expired/);
  });
});

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
