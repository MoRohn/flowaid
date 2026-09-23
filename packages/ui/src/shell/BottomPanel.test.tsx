import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installDomStubs } from "@/primitives/testStubs";
import { BottomPanel, type BottomPanelTab } from "./BottomPanel";
import { SaveIndicator } from "./SaveIndicator";
import { topBarDensity } from "./TopBar";

beforeAll(() => installDomStubs());
afterEach(cleanup);

const tabs: BottomPanelTab[] = [
  { id: "trace", label: "Trace", count: 10, content: <div>Trace rows</div> },
  {
    id: "problems",
    label: "Problems",
    count: 4,
    countTone: "danger",
    content: <div>Problem rows</div>,
  },
];

describe("BottomPanel", () => {
  it("switches tabs and shows counts", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<BottomPanel tabs={tabs} defaultValue="trace" onValueChange={onValueChange} />);
    expect(screen.getByText("Trace rows")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Problems/ })).toHaveTextContent("4");
    await user.click(screen.getByRole("tab", { name: /Problems/ }));
    expect(onValueChange).toHaveBeenCalledWith("problems");
    expect(screen.getByText("Problem rows")).toBeInTheDocument();
  });

  it("wires the follow, clear, expand and close tools", async () => {
    const user = userEvent.setup();
    const onFollowChange = vi.fn();
    const onClear = vi.fn();
    const onExpandedChange = vi.fn();
    const onClose = vi.fn();
    render(
      <BottomPanel
        tabs={tabs}
        follow={false}
        onFollowChange={onFollowChange}
        onClear={onClear}
        expanded={false}
        onExpandedChange={onExpandedChange}
        onClose={onClose}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Follow output" }));
    expect(onFollowChange).toHaveBeenCalledWith(true);
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(onClear).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Expand panel" }));
    expect(onExpandedChange).toHaveBeenCalledWith(true);
    await user.click(screen.getByRole("button", { name: "Close panel" }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("SaveIndicator", () => {
  it("announces each state", () => {
    const { rerender } = render(<SaveIndicator state="saved" />);
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
    rerender(<SaveIndicator state="saving" />);
    expect(screen.getByRole("status", { name: "" })).toHaveTextContent("Saving");
    rerender(<SaveIndicator state="unsaved" />);
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    rerender(<SaveIndicator state="error" compact />);
    expect(screen.getByRole("status")).toHaveAttribute("data-state", "error");
    expect(screen.getByText("Save failed")).toHaveClass("sr-only");
  });
});

describe("topBarDensity", () => {
  it("collapses progressively as the bar narrows", () => {
    expect(topBarDensity(1280)).toBe("full");
    expect(topBarDensity(1080)).toBe("full");
    expect(topBarDensity(1000)).toBe("medium");
    expect(topBarDensity(839)).toBe("dense");
  });
});
