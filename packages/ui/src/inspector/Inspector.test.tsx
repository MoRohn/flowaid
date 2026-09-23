import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NodeRunView, WorkflowNodeView } from "@/types";
import { installDomStubs } from "@/primitives/testStubs";
import { makeChoiceDecision } from "@/lib/decisionBuilders";
import { Inspector } from "./Inspector";

installDomStubs();
afterEach(cleanup);

const NODE: WorkflowNodeView = {
  id: "n_intent",
  kind: "task",
  nodeType: "flowaid.decision.choice",
  category: "decision",
  name: "Classify intent",
  provider: "jev-latest",
  inputs: [{ id: "ticket", label: "ticket", type: "message", required: true }],
  outputs: [{ id: "decision", label: "decision", type: "decision" }],
};

const RUN: NodeRunView = {
  id: "nr_1",
  nodeId: "n_intent",
  nodeName: "Classify intent",
  nodeType: "flowaid.decision.choice",
  category: "decision",
  status: "completed",
  attempt: 1,
  startedAt: "2026-09-21T08:14:03.048Z",
  endedAt: "2026-09-21T08:14:03.460Z",
  durationMs: 412,
  decision: makeChoiceDecision({
    probabilities: { billing: 0.81, technical: 0.19 },
    provider: "jev",
    model: "jev-latest",
    latencyMs: 388,
  }),
  input: { ticket: "hi" },
  output: { intent: "billing" },
  logs: Array.from({ length: 12 }, (_, i) => ({
    at: "2026-09-21T08:14:03.049Z",
    level: "info" as const,
    message: `line ${i}`,
  })),
  error: { code: "NODE_EXECUTION_ERROR", message: "boom", retryable: false },
};

describe("Inspector", () => {
  it("shows count badges for logs and errors", () => {
    render(<Inspector node={NODE} nodeRun={RUN} />);
    const logs = screen.getByRole("tab", { name: /Logs/ });
    expect(within(logs).getByText("12")).toBeInTheDocument();
    const errors = screen.getByRole("tab", { name: /Errors/ });
    expect(within(errors).getByText("1")).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(8);
  });

  it("hides tabs without data when asked, keeping Config", () => {
    render(<Inspector node={{ ...NODE, inputs: [], outputs: [] }} hideEmptyTabs />);
    const names = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(names).toEqual(["Config"]);
  });

  it("respects the tabs allow-list and order", () => {
    render(<Inspector node={NODE} nodeRun={RUN} tabs={["errors", "logs"]} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent?.replace(/\d+$/, ""))).toEqual([
      "Errors",
      "Logs",
    ]);
  });

  it("renders an empty state per tab for an unrun node", async () => {
    const user = userEvent.setup();
    render(<Inspector node={NODE} defaultTab="decision" />);
    expect(screen.getByText("No decision yet")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Logs" }));
    expect(screen.getByText("No logs")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Timing" }));
    expect(screen.getByText("No timing yet")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Errors" }));
    expect(screen.getByText("No errors")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Config" }));
    expect(screen.getByText("Nothing to configure")).toBeInTheDocument();
    expect(screen.getByText("Not run")).toBeInTheDocument();
  });

  it("renders the DecisionCard and the run error", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <Inspector
        node={NODE}
        nodeRun={RUN}
        defaultTab="decision"
        thresholds={{ review: 0.6, auto: 0.9 }}
      />,
    );
    expect(container.textContent).toContain("billing");
    expect(screen.getAllByText("0.81").length).toBeGreaterThanOrEqual(1);
    await user.click(screen.getByRole("tab", { name: /Errors/ }));
    expect(screen.getByRole("alert")).toHaveTextContent("NODE_EXECUTION_ERROR");
    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  it("uses a custom decision renderer when given", () => {
    render(
      <Inspector
        node={NODE}
        nodeRun={RUN}
        defaultTab="decision"
        renderDecision={(d) => <p>custom {String(d.value)}</p>}
      />,
    );
    expect(screen.getByText("custom billing")).toBeInTheDocument();
  });

  it("is controllable through tab / onTabChange", async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();
    render(<Inspector node={NODE} nodeRun={RUN} tab="config" onTabChange={onTabChange} />);
    await user.click(screen.getByRole("tab", { name: "Output" }));
    expect(onTabChange).toHaveBeenCalledWith("output");
    expect(screen.getByRole("tab", { name: "Config" })).toHaveAttribute("data-state", "active");
  });

  it("renames inline: Enter commits, Escape cancels, blank is ignored", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(<Inspector node={NODE} onRename={onRename} />);
    // The heading is the name; the rename button sits inside it, named by the name and
    // described as the rename action.
    const heading = screen.getByRole("heading", { level: 2, name: "Classify intent" });
    const rename = within(heading).getByRole("button", {
      name: "Classify intent",
      description: "Rename node",
    });
    expect(rename.querySelector("h2")).toBeNull();
    await user.click(rename);
    const input = screen.getByRole("textbox", { name: "Node name" });
    await user.clear(input);
    await user.type(input, "Route ticket{Enter}");
    expect(onRename).toHaveBeenCalledWith("Route ticket");

    await user.click(
      screen.getByRole("button", { name: "Classify intent", description: "Rename node" }),
    );
    await user.type(screen.getByRole("textbox", { name: "Node name" }), " changed");
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Node name" }), { key: "Escape" });
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("textbox")).toBeNull();

    await user.click(
      screen.getByRole("button", { name: "Classify intent", description: "Rename node" }),
    );
    await user.clear(screen.getByRole("textbox", { name: "Node name" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Node name" }), { key: "Enter" });
    expect(onRename).toHaveBeenCalledTimes(1);
  });

  it("wires the footer and close actions", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onRunFromHere = vi.fn();
    const onOpenTrace = vi.fn();
    render(
      <Inspector
        node={NODE}
        onClose={onClose}
        onRunFromHere={onRunFromHere}
        onOpenTrace={onOpenTrace}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Run from here" }));
    await user.click(screen.getByRole("button", { name: "Open trace" }));
    await user.click(screen.getByRole("button", { name: "Close inspector" }));
    expect(onRunFromHere).toHaveBeenCalledTimes(1);
    expect(onOpenTrace).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByText("n_intent")).toBeInTheDocument();
  });

  it("applies the width prop", () => {
    const { container, rerender } = render(<Inspector node={NODE} width={400} />);
    expect(container.firstElementChild).toHaveStyle({ width: "400px" });
    rerender(<Inspector node={NODE} width="fill" />);
    expect(container.firstElementChild).not.toHaveStyle({ width: "400px" });
  });
});
