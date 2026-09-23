import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { installDomStubs } from "@/primitives/testStubs";
import { HumanNodeCard, formatElapsed } from "./HumanNodeCard";
import { mkRun, triage, triageRuns } from "./fixtures";

installDomStubs();
afterEach(cleanup);

describe("formatElapsed", () => {
  it("formats seconds, minutes, hours and days", () => {
    expect(formatElapsed(0)).toBe("0 s");
    expect(formatElapsed(12_400)).toBe("12 s");
    expect(formatElapsed(4 * 60_000 + 7_000)).toBe("4 m 07 s");
    expect(formatElapsed(63 * 60_000)).toBe("1 h 03 m");
    expect(formatElapsed(53 * 3_600_000)).toBe("2 d 05 h");
    expect(formatElapsed(-5)).toBe("0 s");
    expect(formatElapsed(Number.NaN)).toBe("0 s");
  });
});

describe("HumanNodeCard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-22T14:10:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ticks the waiting timer every second while waiting", () => {
    const run = mkRun(triage.approve, {
      status: "waiting",
      startedAt: "2026-09-22T14:06:00.000Z",
      endedAt: undefined,
      durationMs: undefined,
    });
    render(
      <ReactFlowProvider>
        <HumanNodeCard node={triage.approve} run={run} />
      </ReactFlowProvider>,
    );
    expect(screen.getByText("4 m 00 s")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(screen.getByText("4 m 03 s")).toBeInTheDocument();
    expect(screen.getByText("Maya Chen")).toBeInTheDocument();
  });

  it("offers Open review only while waiting and reports the node id", () => {
    const onOpenReview = vi.fn();
    const { rerender } = render(
      <ReactFlowProvider>
        <HumanNodeCard
          node={triage.approve}
          run={triageRuns.approveWaiting}
          onOpenReview={onOpenReview}
        />
      </ReactFlowProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open review" }));
    expect(onOpenReview).toHaveBeenCalledWith("approve");

    rerender(
      <ReactFlowProvider>
        <HumanNodeCard
          node={triage.approve}
          run={triageRuns.approved}
          onOpenReview={onOpenReview}
        />
      </ReactFlowProvider>,
    );
    expect(screen.queryByRole("button", { name: "Open review" })).not.toBeInTheDocument();
    expect(screen.getByText("Approved")).toHaveAttribute("data-outcome", "Approved");
  });
});
