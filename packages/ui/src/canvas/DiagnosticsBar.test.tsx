import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installDomStubs } from "@/primitives/testStubs";
import { DiagnosticsBar } from "./DiagnosticsBar";
import { SAMPLE_DIAGNOSTICS, SAMPLE_NODES } from "./sampleWorkflow";

installDomStubs();
afterEach(cleanup);

const nodeName = (id: string) => SAMPLE_NODES.find((n) => n.id === id)?.name;

describe("DiagnosticsBar", () => {
  it("summarises counts by severity", () => {
    render(<DiagnosticsBar diagnostics={SAMPLE_DIAGNOSTICS} />);
    expect(screen.getByText("1 error, 2 warnings, 1 note")).toBeInTheDocument();
  });

  it("is disabled and quiet when there is nothing to show", () => {
    render(<DiagnosticsBar diagnostics={[]} />);
    expect(screen.getByText("No diagnostics")).toBeInTheDocument();
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("opens the list sorted by severity and focuses the node on click", async () => {
    const user = userEvent.setup();
    const onFocusNode = vi.fn();
    const onFocusEdge = vi.fn();
    render(
      <DiagnosticsBar
        diagnostics={SAMPLE_DIAGNOSTICS}
        nodeName={nodeName}
        onFocusNode={onFocusNode}
        onFocusEdge={onFocusEdge}
      />,
    );
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    await user.click(screen.getByText("1 error, 2 warnings, 1 note"));
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent("Send reply");
    expect(items[0]).toHaveTextContent("E_CREDENTIAL_SLOT_UNBOUND");
    expect(items[3]).toHaveTextContent("W_UNREACHABLE_ROUTE");
    await user.click(
      screen.getByText("Credential zendesk_prod is not configured for the staging environment"),
    );
    expect(onFocusNode).toHaveBeenCalledWith("send");
    await user.click(screen.getByText("Route review is never taken in the last 200 runs"));
    expect(onFocusEdge).toHaveBeenCalledWith("c-gate-review");
  });

  it("offers the compiler quick fix on fixable rows", async () => {
    const user = userEvent.setup();
    const onApplyFix = vi.fn();
    render(<DiagnosticsBar diagnostics={SAMPLE_DIAGNOSTICS} defaultOpen onApplyFix={onApplyFix} />);
    expect(screen.getAllByRole("button", { name: "Set 5 s timeout" })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Set 5 s timeout" }));
    expect(onApplyFix).toHaveBeenCalledWith(expect.objectContaining({ code: "W_LOOSE_BOUNDS" }));
  });

  it("supports controlled open state", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <DiagnosticsBar diagnostics={SAMPLE_DIAGNOSTICS} open={false} onOpenChange={onOpenChange} />,
    );
    await user.click(screen.getByText("1 error, 2 warnings, 1 note"));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    rerender(<DiagnosticsBar diagnostics={SAMPLE_DIAGNOSTICS} open onOpenChange={onOpenChange} />);
    expect(screen.getByRole("list")).toBeInTheDocument();
  });
});
