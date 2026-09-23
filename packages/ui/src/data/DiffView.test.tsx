import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installDomStubs } from "@/primitives/testStubs";
import { DiffView, toDiffText } from "./DiffView";

installDomStubs();
afterEach(cleanup);

const OLD = { name: "Support triage", version: 3, thresholds: { review: 0.6, auto: 0.85 } };
const NEW = {
  name: "Support triage",
  version: 4,
  thresholds: { review: 0.6, auto: 0.9 },
  extra: true,
};

function opsOf(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("[data-op]")).map(
    (el) => el.getAttribute("data-op") ?? "",
  );
}

describe("toDiffText", () => {
  it("passes strings through and pretty-prints JSON", () => {
    expect(toDiffText("a\nb")).toBe("a\nb");
    expect(toDiffText({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(toDiffText(undefined)).toBe("");
  });
});

describe("DiffView", () => {
  it("shows the +/− summary and tints added and removed lines", () => {
    const { container } = render(<DiffView oldValue={OLD} newValue={NEW} defaultMode="inline" />);
    // version, auto and the closing brace change (3 pairs); "extra" is new.
    expect(screen.getByText("+4")).toBeInTheDocument();
    expect(screen.getByText("−3")).toBeInTheDocument();
    const ops = opsOf(container);
    expect(ops.filter((o) => o === "add")).toHaveLength(4);
    expect(ops.filter((o) => o === "remove")).toHaveLength(3);
    const removed = container.querySelector('[data-op="remove"]');
    expect(removed?.className).toContain("bg-danger-soft");
    const added = container.querySelector('[data-op="add"]');
    expect(added?.className).toContain("bg-ok-soft");
  });

  it("pairs changed lines side by side and emphasises the changed tokens", () => {
    const { container } = render(<DiffView oldValue={OLD} newValue={NEW} defaultMode="split" />);
    const paired = container.querySelectorAll("[data-paired]");
    expect(paired.length).toBeGreaterThanOrEqual(2);
    const first = paired[0];
    if (!first) throw new Error("no paired row");
    const cells = first.querySelectorAll("[data-op]");
    expect(cells[0]).toHaveAttribute("data-op", "remove");
    expect(cells[1]).toHaveAttribute("data-op", "add");
    const removedToken = first.querySelector('[class*="bg-danger/25"]');
    const addedToken = first.querySelector('[class*="bg-ok/25"]');
    expect(removedToken?.textContent).toBe("3");
    expect(addedToken?.textContent).toBe("4");
  });

  it("switches mode through the toggle and reports it", async () => {
    const user = userEvent.setup();
    const onModeChange = vi.fn();
    const { container } = render(
      <DiffView oldValue="a\nb" newValue="a\nc" onModeChange={onModeChange} />,
    );
    expect(container.firstElementChild).toHaveAttribute("data-mode", "split");
    await user.click(screen.getByRole("radio", { name: "Inline" }));
    expect(onModeChange).toHaveBeenCalledWith("inline");
    expect(container.firstElementChild).toHaveAttribute("data-mode", "inline");
  });

  it("collapses unchanged regions and expands them on demand", async () => {
    const user = userEvent.setup();
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`);
    const oldText = [...lines, "old"].join("\n");
    const newText = [...lines, "new"].join("\n");
    const { container } = render(
      <DiffView oldValue={oldText} newValue={newText} context={2} defaultMode="inline" />,
    );
    expect(screen.getByRole("button", { name: "Expand 28 lines" })).toBeInTheDocument();
    expect(opsOf(container).filter((o) => o === "equal")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Expand 28 lines" }));
    expect(screen.queryByRole("button", { name: /Expand/ })).toBeNull();
    expect(opsOf(container).filter((o) => o === "equal")).toHaveLength(30);
  });

  it("says when there are no differences", () => {
    render(<DiffView oldValue={OLD} newValue={OLD} />);
    expect(screen.getByText("No differences")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Expand/ })).toBeNull();
  });
});
