import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installDomStubs } from "@/primitives/testStubs";
import type { NodeRunView, RunView } from "@/types";
import { RunHeader, failedNode } from "./RunHeader";

beforeAll(() => installDomStubs());
afterEach(cleanup);

const node = (over: Partial<NodeRunView>): NodeRunView => ({
  id: "nr-1",
  nodeId: "fetch",
  nodeName: "Fetch order",
  nodeType: "flowaid.tools.http",
  category: "tool",
  status: "completed",
  attempt: 1,
  ...over,
});

const failedRun: RunView = {
  id: "run-1",
  workflowId: "wf-1",
  workflowName: "Order lookup",
  version: "draft",
  status: "failed",
  origin: "ui",
  createdAt: "2026-09-28T10:00:00.000Z",
  startedAt: "2026-09-28T10:00:00.000Z",
  endedAt: "2026-09-28T10:00:01.000Z",
  nodeRuns: [
    node({ id: "nr-0", nodeId: "start", nodeName: "Start", category: "flow" }),
    node({ status: "failed" }),
  ],
  error: {
    code: "NETWORK_ERROR",
    message: "request to https://orders.invalid failed",
    nodeId: "fetch",
    retryable: true,
  },
};

describe("RunHeader failure banner", () => {
  it("names the failed node and offers to show and retry it", async () => {
    const onShow = vi.fn();
    const onRetry = vi.fn();
    render(
      <RunHeader
        run={failedRun}
        now={Date.parse("2026-09-28T10:01:00.000Z")}
        onShowFailedNode={onShow}
        onRetryFailedNode={onRetry}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Fetch order failed");
    expect(alert.textContent).toContain("NETWORK_ERROR");
    await userEvent.click(screen.getByRole("button", { name: "Show node" }));
    await userEvent.click(screen.getByRole("button", { name: "Retry Fetch order" }));
    expect(onShow).toHaveBeenCalledWith(expect.objectContaining({ id: "nr-1" }));
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ id: "nr-1" }));
  });

  it("does not offer a retry for an error that will not change", () => {
    render(
      <RunHeader
        run={{ ...failedRun, error: { ...failedRun.error, retryable: false } as RunView["error"] }}
        onRetryFailedNode={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
  });

  it("finds the node the error names, else the last failed one", () => {
    expect(failedNode(failedRun)?.id).toBe("nr-1");
    const unnamed = {
      ...failedRun,
      error: { ...failedRun.error, nodeId: undefined } as RunView["error"],
    };
    expect(failedNode(unnamed)?.id).toBe("nr-1");
  });
});
