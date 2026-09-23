import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installDomStubs } from "@/primitives/testStubs";
import { TraceTimeline } from "./TraceTimeline";
import { SAMPLE_LOOP_TOTALS, SAMPLE_T0, buildSampleRun } from "./sampleRun";

beforeAll(() => installDomStubs());
afterEach(() => cleanup());

const NOW = SAMPLE_T0 + 6 * 60_000;

function rowsIn(tree: HTMLElement): HTMLElement[] {
  return within(tree).getAllByRole("treeitem");
}

describe("TraceTimeline", () => {
  it("renders one row per merged node run plus iteration groups, in order", () => {
    const run = buildSampleRun("waiting_for_human");
    render(<TraceTimeline run={run} now={NOW} loopTotals={SAMPLE_LOOP_TOTALS} />);
    const tree = screen.getByRole("tree");
    const rows = rowsIn(tree);
    // 20 node runs, 2 attempts merged into 1 row, + 3 iteration groups
    expect(rows).toHaveLength(20 - 1 + 3);
    expect(rows[0]).toHaveTextContent("Start");
    expect(screen.getByText("Iteration 2 of 3")).toBeInTheDocument();
    // retry badge on the merged row
    const lookup = rows.find((r) => r.dataset.nodeRunId === "nr_07b");
    expect(lookup).toHaveTextContent("×2");
    expect(lookup).toHaveTextContent("245 ms");
  });

  it("scales spans to the run window and hatches the failed attempt", () => {
    const run = buildSampleRun("waiting_for_human");
    render(<TraceTimeline run={run} now={NOW} loopTotals={SAMPLE_LOOP_TOTALS} />);
    const lookup = screen.getAllByRole("treeitem").find((r) => r.dataset.nodeRunId === "nr_07b");
    const segments = lookup?.querySelectorAll<HTMLElement>("[data-attempt]") ?? [];
    expect(segments).toHaveLength(2);
    const failed = segments[0];
    const ok = segments[1];
    expect(failed?.dataset.status).toBe("failed");
    expect(failed?.style.backgroundImage).toContain("repeating-linear-gradient");
    // window is 4462 ms (open human wait excluded); attempt 1 starts at 245 ms
    expect(parseFloat(failed?.style.left ?? "0")).toBeCloseTo((245 / 4462) * 100, 1);
    expect(parseFloat(ok?.style.left ?? "0")).toBeCloseTo((1560 / 4462) * 100, 1);
  });

  it("navigates with the keyboard: arrows move, right expands, left collapses, Enter selects", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const run = buildSampleRun("waiting_for_human");
    render(
      <TraceTimeline run={run} now={NOW} loopTotals={SAMPLE_LOOP_TOTALS} onSelectNode={onSelect} />,
    );
    const rows = screen.getAllByRole("treeitem");
    const first = rows[0];
    if (!first) throw new Error("no rows");
    first.focus();
    expect(first).toHaveFocus();

    await user.keyboard("{ArrowDown}{ArrowDown}");
    const intent = screen.getAllByRole("treeitem")[2];
    expect(intent).toHaveFocus();
    expect(intent).toHaveTextContent("Intent");
    expect(intent).toHaveAttribute("aria-expanded", "false");

    await user.keyboard("{ArrowRight}");
    expect(screen.getAllByRole("treeitem")[2]).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("security")).toBeInTheDocument();
    expect(screen.getByText("0.81")).toBeInTheDocument();

    await user.keyboard("{ArrowLeft}");
    expect(screen.getAllByRole("treeitem")[2]).toHaveAttribute("aria-expanded", "false");

    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "nr_03" }));

    await user.keyboard("{ArrowUp}");
    expect(screen.getAllByRole("treeitem")[1]).toHaveFocus();
    await user.keyboard("{End}");
    const all = screen.getAllByRole("treeitem");
    expect(all[all.length - 1]).toHaveFocus();
    await user.keyboard("{Home}");
    expect(screen.getAllByRole("treeitem")[0]).toHaveFocus();
  });

  it("collapses and expands iteration groups", async () => {
    const user = userEvent.setup();
    const run = buildSampleRun("waiting_for_human");
    render(<TraceTimeline run={run} now={NOW} loopTotals={SAMPLE_LOOP_TOTALS} />);
    const before = screen.getAllByRole("treeitem").length;
    const group = screen.getByText("Iteration 1 of 3").closest<HTMLElement>("[role=treeitem]");
    if (!group) throw new Error("group row missing");
    group.focus();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getAllByRole("treeitem")).toHaveLength(before - 2);
    await user.keyboard("{ArrowRight}");
    expect(screen.getAllByRole("treeitem")).toHaveLength(before);
  });

  it("highlights the selected row and shows the error for failed rows", async () => {
    const user = userEvent.setup();
    const run = buildSampleRun("failed");
    render(<TraceTimeline run={run} now={NOW} selectedNodeRunId="nr_07b" />);
    const row = screen.getAllByRole("treeitem").find((r) => r.dataset.nodeRunId === "nr_07b");
    if (!row) throw new Error("row missing");
    expect(row).toHaveAttribute("aria-selected", "true");
    expect(row.className).toContain("bg-accent-soft");
    await user.click(row);
    expect(
      screen.getAllByText(/503 Service Unavailable after 2 attempts/).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("virtualizes above the threshold", () => {
    const run = buildSampleRun("waiting_for_human");
    render(<TraceTimeline run={run} now={NOW} virtualizeThreshold={5} className="h-[200px]" />);
    // happy-dom reports zero height, so the virtualizer renders nothing but the tree keeps its total size
    const tree = screen.getByRole("tree");
    expect(tree.style.height).not.toBe("");
  });
});
