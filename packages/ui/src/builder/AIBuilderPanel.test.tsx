import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AIBuilderPanel, type BuilderPlan } from "./AIBuilderPanel";

afterEach(cleanup);

const PLAN: BuilderPlan = {
  outcome: "Every ticket is routed.",
  decisions: [
    {
      id: "intent",
      kind: "choice",
      question: "What is the customer asking for?",
      options: ["billing", "technical"],
    },
  ],
  tools: [
    { id: "zd", name: "Ticket update", credential: { type: "zendesk_oauth", configured: false } },
  ],
  risks: [{ id: "r1", action: "Issue a refund", gate: "Finance approval" }],
  thresholds: [{ nodeId: "intent", label: "Intent", thresholds: { review: 0.6, auto: 0.85 } }],
  workflow: {
    nodes: [
      { id: "a", name: "Start", type: "flow.start", category: "flow" },
      { id: "b", name: "Intent", type: "decision.choice", category: "decision" },
    ],
    edges: [{ source: "a", target: "b" }],
  },
  missingCredentials: ["zendesk_oauth"],
};

describe("AIBuilderPanel", () => {
  it("submits the prompt with mod+Enter and clears the composer", async () => {
    const onSubmit = vi.fn();
    render(<AIBuilderPanel status="idle" onSubmit={onSubmit} />);
    const box = screen.getByRole("textbox", { name: "Describe the workflow" });
    await userEvent.type(box, "Triage tickets");
    await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
    expect(onSubmit).toHaveBeenCalledWith("Triage tickets");
    expect(box).toHaveValue("");
  });

  it("also submits with ctrl+Enter and via the button, never with plain Enter", async () => {
    const onSubmit = vi.fn();
    render(<AIBuilderPanel status="idle" onSubmit={onSubmit} />);
    const box = screen.getByRole("textbox", { name: "Describe the workflow" });
    await userEvent.type(box, "Line one{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    expect(onSubmit).toHaveBeenCalledWith("Line one");
    await userEvent.type(box, "Again");
    await userEvent.click(screen.getByRole("button", { name: "Generate plan" }));
    expect(onSubmit).toHaveBeenLastCalledWith("Again");
  });

  it("does not submit an empty prompt and disables the button", async () => {
    const onSubmit = vi.fn();
    render(<AIBuilderPanel status="idle" onSubmit={onSubmit} />);
    expect(screen.getByRole("button", { name: "Generate plan" })).toBeDisabled();
    await userEvent.type(screen.getByRole("textbox"), "   ");
    await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("fills the composer from an example chip", async () => {
    render(
      <AIBuilderPanel
        status="idle"
        onSubmit={() => undefined}
        examplePrompts={["Label GitHub issues"]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Label GitHub issues" }));
    expect(screen.getByRole("textbox")).toHaveValue("Label GitHub issues");
  });

  it("renders the present plan sections, kind badges and the missing-credentials callout", () => {
    render(<AIBuilderPanel status="done" plan={PLAN} onSubmit={() => undefined} />);
    expect(screen.getByText("Every ticket is routed.")).toBeInTheDocument();
    expect(screen.getByText("choice")).toBeInTheDocument();
    expect(screen.getByText("risky")).toBeInTheDocument();
    expect(screen.getByText("zendesk_oauth · missing")).toBeInTheDocument();
    expect(screen.getByText("1 credential to configure before the first run")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /Confidence thresholds: review at 0.60, auto at 0.85/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply to canvas" })).toBeInTheDocument();
  });

  it("shows skeleton lines while streaming and no actions", () => {
    render(
      <AIBuilderPanel
        status="streaming"
        plan={{ outcome: "Partial" }}
        onSubmit={() => undefined}
      />,
    );
    expect(screen.getByText("Generating plan")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply to canvas" })).not.toBeInTheDocument();
  });

  it("says generating for a blocking request, without a streaming cursor", () => {
    const { container } = render(<AIBuilderPanel status="generating" onSubmit={() => undefined} />);
    expect(screen.getByText("generating")).toBeInTheDocument();
    expect(screen.queryByText("streaming")).not.toBeInTheDocument();
    expect(screen.getByText("Generating plan")).toBeInTheDocument();
    expect(container.querySelector(".fa-cursor")).toBeNull();
  });

  it("keeps the plan on screen while saving, with Apply busy and the rest disabled", () => {
    render(<AIBuilderPanel status="saving" plan={PLAN} onSubmit={() => undefined} />);
    expect(screen.getByText("saving")).toBeInTheDocument();
    expect(screen.queryByText("Generating plan")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Saving/ })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Refine" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Discard" })).toBeDisabled();
  });

  it("lists the diagnostics left to fix and the provenance line", () => {
    render(
      <AIBuilderPanel
        status="done"
        plan={{
          ...PLAN,
          diagnostics: [
            {
              severity: "error",
              message: "Input is not bound",
              code: "E_UNBOUND",
              nodeName: "Triage",
            },
            { severity: "warning", message: "No failover model" },
          ],
        }}
        provenance="Generated by anthropic/claude · 1.2k tokens · $0.004 · 2 compile passes"
        onSubmit={() => undefined}
      />,
    );
    const section = screen.getByText("Left to fix in the builder").closest("section");
    expect(section).toHaveTextContent("Triage: Input is not bound");
    expect(section).toHaveTextContent("E_UNBOUND");
    expect(section).toHaveTextContent("No failover model");
    expect(screen.getByText(/Generated by anthropic\/claude/)).toBeInTheDocument();
  });

  it("opens the refine composer and routes the follow-up to onRefine", async () => {
    const onRefine = vi.fn();
    const onSubmit = vi.fn();
    render(<AIBuilderPanel status="done" plan={PLAN} onSubmit={onSubmit} onRefine={onRefine} />);
    await userEvent.click(screen.getByRole("button", { name: "Refine" }));
    const box = screen.getByRole("textbox", { name: "Refine the plan" });
    expect(box).toHaveFocus();
    await userEvent.type(box, "Route billing to finance");
    await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
    expect(onRefine).toHaveBeenCalledWith("Route billing to finance");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows the error with retry and discard", async () => {
    const onRetry = vi.fn();
    render(
      <AIBuilderPanel
        status="error"
        error="Provider timed out."
        onSubmit={() => undefined}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Provider timed out.");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
