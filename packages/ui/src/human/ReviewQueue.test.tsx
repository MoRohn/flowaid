import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installDomStubs } from "@/primitives/testStubs";
import type { HumanRequest } from "@/types";
import { ReviewQueue, sortBySla, type ReviewQueueItem } from "./ReviewQueue";

beforeAll(installDomStubs);
afterEach(cleanup);

const NOW = Date.parse("2026-09-22T14:00:00Z");
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

function item(
  partial: Partial<Omit<ReviewQueueItem, "request">> & {
    id: string;
    expiresAt?: string;
    assignee?: string;
  },
): ReviewQueueItem {
  const { expiresAt, assignee, ...rest } = partial;
  const request: HumanRequest = {
    title: `Review ${partial.id}`,
    context: {},
    mode: { type: "approval" },
    assignees: assignee ? [assignee] : [],
    expiresAt: expiresAt ?? null,
    externalReview: false,
    origin: "human_node",
  };
  return {
    runId: `run_${partial.id}`,
    nodeId: "approve",
    nodeName: "Approve refund",
    request,
    requestedAt: iso(-10 * 60_000),
    workflowName: "Support triage",
    ...rest,
  };
}

describe("sortBySla", () => {
  it("orders by soonest expiry, then longest wait, keeping items without an SLA last", () => {
    const items = [
      item({ id: "no-sla", requestedAt: iso(-60 * 60_000) }),
      item({ id: "late", expiresAt: iso(30 * 60_000) }),
      item({ id: "soon", expiresAt: iso(2 * 60_000) }),
      item({ id: "same-b", expiresAt: iso(10 * 60_000), requestedAt: iso(-5 * 60_000) }),
      item({ id: "same-a", expiresAt: iso(10 * 60_000), requestedAt: iso(-20 * 60_000) }),
    ];
    expect(sortBySla(items).map((i) => i.id)).toEqual([
      "soon",
      "same-a",
      "same-b",
      "late",
      "no-sla",
    ]);
  });

  it("is stable and does not mutate its input", () => {
    const items = [item({ id: "a" }), item({ id: "b" }), item({ id: "c" })];
    const out = sortBySla(items);
    expect(out.map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(out).not.toBe(items);
  });
});

describe("ReviewQueue", () => {
  it("renders rows in SLA order with live waiting time and opens on activation", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const items = [
      item({ id: "b", expiresAt: iso(40 * 60_000), requestedAt: iso(-4 * 60_000 - 12_000) }),
      item({ id: "a", expiresAt: iso(3 * 60_000), assignee: "Priya Shah" }),
    ];
    render(<ReviewQueue items={items} onOpen={onOpen} now={NOW} />);
    const rows = screen.getAllByRole("button", { name: /Support triage/ });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Review a");
    expect(rows[0]).toHaveAttribute("data-sla", "danger");
    expect(rows[1]).toHaveTextContent("4m 12s");
    expect(
      within(rows[0] as HTMLElement).getByRole("img", { name: "Priya Shah" }),
    ).toBeInTheDocument();

    await user.click(rows[1] as HTMLElement);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "b" }));
    (rows[0] as HTMLElement).focus();
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ id: "b" }));
  });

  it("shows the empty state when nothing is waiting", () => {
    render(<ReviewQueue items={[]} onOpen={vi.fn()} now={NOW} />);
    expect(screen.getByText("No reviews waiting")).toBeInTheDocument();
  });

  it("bulk-approves only selected low-risk items after confirmation", async () => {
    const user = userEvent.setup();
    const onBulkApprove = vi.fn();
    const items = [
      item({ id: "hi", risk: "high", expiresAt: iso(5 * 60_000) }),
      item({ id: "lo1", risk: "low", expiresAt: iso(20 * 60_000) }),
      item({ id: "lo2", risk: "low", expiresAt: iso(25 * 60_000) }),
    ];
    render(<ReviewQueue items={items} onOpen={vi.fn()} onBulkApprove={onBulkApprove} now={NOW} />);
    const approve = screen.getByRole("button", { name: /Approve selected/ });
    expect(approve).toBeDisabled();
    expect(screen.queryByRole("checkbox", { name: "Select Review hi" })).toBeNull();

    await user.click(screen.getByRole("checkbox", { name: "Select all low-risk reviews" }));
    expect(approve).toBeEnabled();
    await user.click(screen.getByRole("checkbox", { name: "Select Review lo2" }));
    await user.click(approve);
    expect(screen.getByRole("dialog")).toHaveTextContent("Approve 1 low-risk review");
    await user.click(screen.getByRole("button", { name: "Approve all" }));
    expect(onBulkApprove).toHaveBeenCalledWith(["lo1"]);
  });
});
