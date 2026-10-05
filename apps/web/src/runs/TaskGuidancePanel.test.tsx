import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { installDomStubs } from "@/primitives/testStubs";
import type { HumanTask } from "~/api/types";
import { TaskGuidancePanel } from "./TaskGuidancePanel";

beforeAll(() => installDomStubs());
afterEach(cleanup);

const request: HumanTask["request"] = {
  title: "Approve the refund",
  context: {},
  mode: { type: "approval" },
  assignees: [],
  expiresAt: null,
  externalReview: false,
  origin: "task_suspend",
};

describe("TaskGuidancePanel", () => {
  it("is open on a waiting task and says what each answer does", () => {
    const { container } = render(
      <TaskGuidancePanel task={{ request, expiresAt: null, status: "open" }} node={undefined} />,
    );
    expect(container.querySelector("details")?.open).toBe(true);
    expect(screen.getByText(/tool call marked as needing approval/)).toBeTruthy();
    expect(screen.getByText("Reject")).toBeTruthy();
    expect(screen.getByText(/waits until someone answers/)).toBeTruthy();
  });

  it("is folded and told in the past once the task is answered", () => {
    const { container } = render(
      <TaskGuidancePanel
        task={{ request, expiresAt: "2026-09-30T00:00:00Z", status: "responded" }}
        node={undefined}
      />,
    );
    expect(container.querySelector("details")?.open).toBe(false);
    expect(screen.getByText("About this task")).toBeTruthy();
    expect(screen.queryByText("Before you answer")).toBeNull();
    expect(screen.queryByText(/Was due|Expires/)).toBeNull();
  });

  it("says when an expired task expired, and nothing about a due time once cancelled", () => {
    const expired = render(
      <TaskGuidancePanel
        task={{ request, expiresAt: "2026-09-30T00:00:00Z", status: "expired" }}
        node={undefined}
      />,
    );
    expect(screen.getByText(/^Expired/)).toBeTruthy();
    expired.unmount();
    render(
      <TaskGuidancePanel
        // the run ended first: the task was still 13 minutes from its due time
        task={{ request, expiresAt: "2099-09-30T00:00:00Z", status: "cancelled" }}
        node={undefined}
      />,
    );
    expect(screen.queryByText(/Was due|Expire/)).toBeNull();
  });
});
