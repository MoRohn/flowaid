import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { NodeRunView, RunView } from "@flowaid/ui";
import { installDomStubs } from "@/primitives/testStubs";
import { RunResult, summarizeRun } from "./RunResult";

beforeAll(() => installDomStubs());
afterEach(cleanup);

const nodeRun = (nodeId: string, status: NodeRunView["status"]): NodeRunView =>
  ({
    id: `nr-${nodeId}`,
    nodeId,
    nodeName: nodeId === "answer" ? "Answer" : nodeId,
    status,
  }) as NodeRunView;

const run = (over: Partial<RunView>): RunView => ({
  id: "01a0e9a9-646a-7519-b20c-b7ef938c5340",
  workflowId: "w",
  workflowName: "W",
  version: "draft",
  status: "completed",
  origin: "ui",
  createdAt: "2026-09-29T10:00:00.000Z",
  nodeRuns: [],
  ...over,
});

describe("summarizeRun", () => {
  it("counts finished steps and names where a failed run stopped", () => {
    const s = summarizeRun(
      run({
        status: "failed",
        nodeRuns: [
          nodeRun("start", "completed"),
          nodeRun("retrieve", "completed"),
          nodeRun("answer", "failed"),
        ],
        error: {
          code: "PROVIDER_ERROR",
          message: "Ollama could not be reached",
          retryable: true,
          nodeId: "answer",
        },
      }),
    );
    expect(s.headline).toBe("Failed at “Answer” after 2 steps finished.");
    expect(s.failedNodeId).toBe("answer");
    expect(s.next).toMatch(/may be temporary/);
  });

  it("never claims progress it does not have", () => {
    expect(summarizeRun(run({ status: "queued" })).headline).toMatch(/^Queued/);
    expect(
      summarizeRun(run({ status: "running", nodeRuns: [nodeRun("a", "completed")] })).headline,
    ).toBe("Running: 1 step finished so far.");
    expect(summarizeRun(run({ status: "waiting_for_human" })).next).toMatch(/Human tasks/);
  });
});

describe("RunResult", () => {
  it("offers the failed step, the full run, and says when the draft changed since", () => {
    const onShowNode = vi.fn();
    render(
      <RunResult
        run={run({
          status: "failed",
          nodeRuns: [nodeRun("answer", "failed")],
          error: {
            code: "PROVIDER_ERROR",
            message: "Ollama could not be reached",
            retryable: false,
            nodeId: "answer",
          },
        })}
        ws="default"
        stale
        onShowNode={onShowNode}
      />,
    );
    expect(screen.getByText("Ollama could not be reached")).toBeTruthy();
    expect(screen.getByText(/changed the draft after this run started/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open the full run/ }).getAttribute("href")).toBe(
      "/default/runs/01a0e9a9-646a-7519-b20c-b7ef938c5340",
    );
    fireEvent.click(screen.getByRole("button", { name: "Show the failed step" }));
    expect(onShowNode).toHaveBeenCalledWith("answer");
  });
});
