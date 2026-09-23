import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { installDomStubs } from "@/primitives/testStubs";
import { NodeCard } from "./NodeCard";
import { diagnosticsSummary, worstSeverity } from "./NodeDiagnosticsMarker";
import { mkRun, triage } from "./fixtures";

installDomStubs();
afterEach(cleanup);

function renderCard(ui: React.ReactElement) {
  return render(<ReactFlowProvider>{ui}</ReactFlowProvider>);
}

describe("NodeCard", () => {
  it("renders name, kind label, description and typed handles", () => {
    renderCard(<NodeCard node={triage.lookup} />);
    expect(screen.getByText("Lookup account")).toBeInTheDocument();
    expect(screen.getByText("http")).toBeInTheDocument();
    const input = screen.getByLabelText("input (input)");
    expect(input).toHaveAttribute("data-typed", "true");
    expect(input.style.getPropertyValue("--fa-handle-c")).toBe("var(--cat-tool)");
    expect(screen.getByLabelText("customer (output)")).toHaveAttribute("data-typed", "true");
  });

  it("shows the diagnostics marker with the worst severity and a summary", () => {
    const node = {
      ...triage.lookup,
      diagnostics: [
        {
          code: "E_CREDENTIAL_SLOT_UNBOUND" as const,
          severity: "error" as const,
          message: "Credential missing",
          location: {},
        },
        {
          code: "W_LOOSE_BOUNDS" as const,
          severity: "warning" as const,
          message: "Timeout low",
          location: {},
        },
        {
          code: "W_RETRY_SIDE_EFFECT" as const,
          severity: "warning" as const,
          message: "No retries",
          location: {},
        },
      ],
    };
    renderCard(<NodeCard node={node} />);
    const marker = screen.getByRole("button", { name: "1 error, 2 warnings" });
    expect(marker).toHaveAttribute("data-severity", "error");
  });

  it("uses the warning marker when there are no errors and none when empty", () => {
    const { rerender } = renderCard(
      <NodeCard
        node={{
          ...triage.intent,
          diagnostics: [
            {
              code: "W_UNREACHABLE_ROUTE",
              severity: "warning",
              message: "Unused option",
              location: {},
            },
          ],
        }}
      />,
    );
    expect(screen.getByRole("button", { name: "1 warning" })).toHaveAttribute(
      "data-severity",
      "warning",
    );
    rerender(
      <ReactFlowProvider>
        <NodeCard node={{ ...triage.intent, diagnostics: [] }} />
      </ReactFlowProvider>,
    );
    expect(screen.queryByRole("button", { name: /warning|error/ })).not.toBeInTheDocument();
  });

  it("exposes state through data attributes and the off badge", () => {
    const run = mkRun(triage.intent, {
      status: "failed",
      error: { code: "TIMEOUT_ERROR", message: "Provider timed out", retryable: true },
    });
    const { container } = renderCard(<NodeCard node={triage.intent} run={run} selected disabled />);
    const root = container.querySelector(".fa-node");
    expect(root).toHaveAttribute("data-status", "failed");
    expect(root).toHaveAttribute("data-selected", "true");
    expect(root).toHaveAttribute("data-disabled", "true");
    expect(screen.getByText("off")).toBeInTheDocument();
    expect(screen.getByText("TIMEOUT_ERROR")).toBeInTheDocument();
    expect(screen.getByText("Provider timed out")).toBeInTheDocument();
  });

  it("prints status, provider and duration in the footer", () => {
    renderCard(<NodeCard node={triage.intent} run={mkRun(triage.intent, { durationMs: 412 })} />);
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("412 ms")).toBeInTheDocument();
    expect(screen.getByText(/jev-latest/)).toBeInTheDocument();
  });

  it("derives prefixed handle ids: control-in notch, data-ins, control-outs above data-outs", () => {
    const { container } = renderCard(<NodeCard node={triage.lookup} />);
    const handles = Array.from(container.querySelectorAll("[data-handleid]"));
    expect(handles.map((h) => h.getAttribute("data-handleid"))).toEqual([
      "ctl-in",
      "in:in",
      "ctl:done",
      "out:out",
    ]);
    expect(handles.map((h) => h.getAttribute("data-handlepos"))).toEqual([
      "top",
      "left",
      "right",
      "right",
    ]);
    expect(screen.getByLabelText("done (control output)")).toHaveAttribute(
      "data-handle-kind",
      "ctl",
    );
    expect(screen.getByLabelText("control in (control input)")).toHaveStyle({ left: "14px" });
  });

  it("dims incompatible handles and states the reason in their label", () => {
    renderCard(
      <NodeCard
        node={triage.lookup}
        compatibleHandles={["ctl-in"]}
        handleReasons={{ "in:in": "decision does not fit input" }}
      />,
    );
    const rejected = screen.getByLabelText("input (input): decision does not fit input");
    expect(rejected).toHaveAttribute("role", "img");
    expect(rejected).toHaveAttribute("data-compatible", "false");
    expect(rejected).toHaveAttribute("data-reason", "decision does not fit input");
    expect(rejected).toHaveTextContent("decision does not fit input");
    expect(screen.getByLabelText("control in (control input)")).toHaveAttribute(
      "data-compatible",
      "true",
    );
  });

  it("omits output handles for route cards", () => {
    renderCard(<NodeCard node={triage.lookup} handles="inputs" />);
    expect(screen.queryByLabelText("customer (output)")).not.toBeInTheDocument();
    expect(screen.getByLabelText("input (input)")).toBeInTheDocument();
  });
});

describe("diagnostics helpers", () => {
  it("picks the worst severity", () => {
    expect(worstSeverity([])).toBeUndefined();
    expect(
      worstSeverity([{ code: "I_CONTROL_AND", severity: "info", message: "", location: {} }]),
    ).toBe("info");
    expect(
      worstSeverity([
        { code: "I_CONTROL_AND", severity: "info", message: "", location: {} },
        { code: "W_LOOSE_BOUNDS", severity: "warning", message: "", location: {} },
      ]),
    ).toBe("warning");
  });
  it("summarises counts", () => {
    expect(
      diagnosticsSummary([
        { code: "E_SCHEMA", severity: "error", message: "", location: {} },
        { code: "E_SCHEMA", severity: "error", message: "", location: {} },
        { code: "I_CONTROL_AND", severity: "info", message: "", location: {} },
      ]),
    ).toBe("2 errors, 1 note");
  });
});
