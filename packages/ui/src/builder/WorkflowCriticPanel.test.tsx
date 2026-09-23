import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installDomStubs } from "@/primitives/testStubs";
import type { CriticFindingView } from "@/types";
import { WorkflowCriticPanel, criticSummary, formatSavings } from "./WorkflowCriticPanel";

installDomStubs();
afterEach(cleanup);

const FINDINGS: CriticFindingView[] = [
  {
    id: "1",
    severity: "error",
    category: "safety",
    title: "Unguarded refund",
    detail: "Add an approval gate.",
    nodeIds: ["send"],
    fixAvailable: true,
  },
  {
    id: "2",
    severity: "warning",
    category: "reliability",
    title: "No retries",
    detail: "Add backoff.",
    nodeIds: ["send"],
    savings: { calls: 41 },
    fixAvailable: true,
  },
  {
    id: "3",
    severity: "suggestion",
    category: "cost",
    title: "Compact model",
    detail: "Cheaper.",
    nodeIds: ["urgency"],
    savings: { costUsd: 0.34, latencyMs: 180 },
    fixAvailable: true,
  },
  {
    id: "4",
    severity: "suggestion",
    category: "cost",
    title: "Cache lookup",
    detail: "Fewer calls.",
    savings: { costUsd: 0.06, calls: 310 },
  },
  {
    id: "5",
    severity: "error",
    category: "correctness",
    title: "Dangling exit",
    detail: "Connect it.",
  },
];

describe("criticSummary", () => {
  it("counts by severity and category", () => {
    const s = criticSummary(FINDINGS);
    expect(s.total).toBe(5);
    expect(s.bySeverity).toEqual({ error: 2, warning: 1, suggestion: 2 });
    expect(s.byCategory).toEqual({
      cost: 2,
      safety: 1,
      reliability: 1,
      correctness: 1,
      performance: 0,
      style: 0,
    });
  });

  it("counts fixable findings and sums savings", () => {
    const s = criticSummary(FINDINGS);
    expect(s.fixable).toBe(3);
    expect(s.savings.costUsd).toBeCloseTo(0.4);
    expect(s.savings.latencyMs).toBe(180);
    expect(s.savings.calls).toBe(351);
  });

  it("handles no findings", () => {
    const s = criticSummary([]);
    expect(s.total).toBe(0);
    expect(s.fixable).toBe(0);
    expect(s.savings).toEqual({ costUsd: 0, latencyMs: 0, calls: 0 });
  });
});

describe("formatSavings", () => {
  it("joins the present parts in mono-friendly text", () => {
    expect(formatSavings({ costUsd: 0.34, latencyMs: 180 })).toBe("$0.3400/1k · 180 ms");
    expect(formatSavings({ calls: 41 })).toBe("41 calls");
    expect(formatSavings(undefined)).toBe("");
  });
});

describe("WorkflowCriticPanel", () => {
  it("groups findings by category with safety first and shows severity chips", () => {
    render(<WorkflowCriticPanel findings={FINDINGS} />);
    const groups = screen.getAllByRole("region");
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual([
      "Safety",
      "Correctness",
      "Reliability",
      "Cost",
    ]);
    expect(screen.getByText("2 errors")).toBeInTheDocument();
    expect(screen.getByText("1 warning")).toBeInTheDocument();
    expect(screen.getByText("2 suggestions")).toBeInTheDocument();
  });

  it("expands a finding to its detail and fires node focus and fix callbacks", async () => {
    const onFocusNode = vi.fn();
    const onApplyFix = vi.fn();
    render(
      <WorkflowCriticPanel
        findings={FINDINGS}
        nodeName={(id) => (id === "send" ? "Ticket update" : id)}
        onFocusNode={onFocusNode}
        onApplyFix={onApplyFix}
      />,
    );
    const toggle = screen.getByRole("button", { name: "Unguarded refund" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Add an approval gate.")).toBeInTheDocument();

    await userEvent.click(
      screen.getAllByRole("button", { name: "Ticket update" })[0] as HTMLElement,
    );
    expect(onFocusNode).toHaveBeenCalledWith("send");

    const fixes = screen.getAllByRole("button", { name: "Apply fix" });
    expect(fixes).toHaveLength(3);
    await userEvent.click(fixes[0] as HTMLElement);
    expect(onApplyFix).toHaveBeenCalledWith(expect.objectContaining({ id: "1" }));
  });

  it("renders the empty state with the checks that ran and a re-run button", async () => {
    const onRerun = vi.fn();
    render(
      <WorkflowCriticPanel
        findings={[]}
        checks={["unguarded tools", "naming"]}
        onRerun={onRerun}
      />,
    );
    expect(screen.getByText("No issues found")).toBeInTheDocument();
    expect(screen.getByText(/2 checks ran: unguarded tools, naming\./)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Re-run review" }));
    expect(onRerun).toHaveBeenCalledTimes(1);
  });

  it("sorts findings inside a group by severity", () => {
    render(
      <WorkflowCriticPanel
        findings={[
          { id: "a", severity: "suggestion", category: "cost", title: "Later", detail: "" },
          { id: "b", severity: "error", category: "cost", title: "First", detail: "" },
        ]}
      />,
    );
    const group = screen.getByRole("region", { name: "Cost" });
    const titles = within(group)
      .getAllByRole("button", { expanded: false })
      .map((b) => b.textContent);
    expect(titles).toEqual(["First", "Later"]);
  });
});
