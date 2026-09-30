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

  it("is folded once the task is answered", () => {
    const { container } = render(
      <TaskGuidancePanel
        task={{ request, expiresAt: "2026-09-30T00:00:00Z", status: "responded" }}
        node={undefined}
      />,
    );
    expect(container.querySelector("details")?.open).toBe(false);
    expect(screen.getByText(/Was due/)).toBeTruthy();
  });
});
