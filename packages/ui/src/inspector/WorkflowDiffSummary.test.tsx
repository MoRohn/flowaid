import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installDomStubs } from "@/primitives/testStubs";
import { emptyWorkflowDiff } from "@/lib/workflowDiff";
import type { WorkflowDiff } from "@/types";
import { WorkflowDiffSummary } from "./WorkflowDiffSummary";

installDomStubs();
afterEach(cleanup);

const DIFF: WorkflowDiff = {
  ...emptyWorkflowDiff(),
  nodes: {
    added: ["n5"],
    removed: ["n3"],
    changed: [{ id: "n1", patch: [{ op: "replace", path: "/config/threshold", value: 0.9 }] }],
  },
  edges: { added: ["e9"], removed: [] },
  variables: [{ op: "add", path: "/locale", value: { type: "string" } }],
};

describe("WorkflowDiffSummary", () => {
  it("lists node changes with their patch paths and selects on click", async () => {
    const user = userEvent.setup();
    const onSelectNode = vi.fn();
    const names: Record<string, string> = {
      n1: "Classify intent",
      n3: "Debug log",
      n5: "Redact PII",
    };
    render(
      <WorkflowDiffSummary diff={DIFF} nodeName={(id) => names[id]} onSelectNode={onSelectNode} />,
    );
    expect(screen.getByText("3 nodes changed")).toBeInTheDocument();
    expect(screen.getByText("/config/threshold")).toBeInTheDocument();
    expect(screen.getByText("edges +1 −0")).toBeInTheDocument();
    expect(screen.getByText("variables")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Debug log/ }));
    expect(onSelectNode).toHaveBeenCalledWith("n3");
  });

  it("has empty and layout-only messages", () => {
    const { rerender } = render(<WorkflowDiffSummary diff={emptyWorkflowDiff()} />);
    expect(screen.getByText("No changes between these versions.")).toBeInTheDocument();
    rerender(<WorkflowDiffSummary diff={emptyWorkflowDiff(true)} />);
    expect(screen.getByText("Only the layout differs between these versions.")).toBeInTheDocument();
  });
});
