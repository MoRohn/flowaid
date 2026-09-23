import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installDomStubs } from "@/primitives/testStubs";
import { EventLog, filterEvents } from "./EventLog";
import { SAMPLE_NODES, buildSampleEvents } from "./sampleRun";

beforeAll(() => installDomStubs());
afterEach(() => cleanup());

describe("filterEvents", () => {
  const events = buildSampleEvents();
  it("returns everything when no filter is set", () => {
    expect(filterEvents(events, {})).toHaveLength(events.length);
    expect(filterEvents(events, { families: [], query: "  " })).toHaveLength(events.length);
  });
  it("filters by family", () => {
    const decisions = filterEvents(events, { families: ["decision"] });
    expect(decisions.length).toBe(8);
    expect(
      decisions.every((e) => e.type === "DECISION_COMPLETED" || e.type === "DECISION_REQUESTED"),
    ).toBe(true);
    const mixed = filterEvents(events, { families: ["provider", "checkpoint"] });
    expect(mixed.map((e) => e.type).sort()).toEqual(["CHECKPOINT_CREATED", "PROVIDER_FAILOVER"]);
  });
  it("searches type, summary, node name and payload, case-insensitively", () => {
    expect(filterEvents(events, { query: "failover" }).map((e) => e.type)).toEqual([
      "PROVIDER_FAILOVER",
    ]);
    expect(filterEvents(events, { query: "cus_9Yt3LqA8" }).length).toBeGreaterThanOrEqual(2);
    expect(
      filterEvents(events, { query: "lookup account", nodes: SAMPLE_NODES }).length,
    ).toBeGreaterThanOrEqual(8);
    expect(filterEvents(events, { query: "lookup account" }).length).toBe(0);
    expect(filterEvents(events, { query: "ZZZ-nothing" })).toHaveLength(0);
  });
  it("combines family and query", () => {
    const r = filterEvents(events, { families: ["tool"], query: "503" });
    expect(r.map((e) => e.type)).toEqual(["TOOL_RETURNED"]);
  });
});

describe("EventLog", () => {
  it("renders seq, time, badge and summary for each event", () => {
    const events = buildSampleEvents();
    render(<EventLog events={events} nodes={SAMPLE_NODES} />);
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(events.length);
    expect(rows[0]).toHaveTextContent("RUN_CREATED");
    expect(rows[0]).toHaveTextContent("Created by Webhook (async)");
    expect(screen.getByText("Intent → security (0.81) · jev-1.13.0 · 84 ms")).toBeInTheDocument();
  });

  it("filters with the family chips and the search box", async () => {
    const user = userEvent.setup();
    const events = buildSampleEvents();
    render(<EventLog events={events} nodes={SAMPLE_NODES} />);
    await user.click(screen.getByRole("button", { name: "Human events" }));
    expect(screen.getAllByRole("row")).toHaveLength(1);
    expect(screen.getAllByRole("row")[0]).toHaveTextContent("HUMAN_APPROVAL_REQUESTED");
    await user.click(screen.getByRole("button", { name: "Human events" }));
    expect(screen.getAllByRole("row")).toHaveLength(events.length);

    await user.type(screen.getByRole("searchbox", { name: "Search events" }), "rate limited");
    expect(screen.getAllByRole("row")).toHaveLength(1);
    expect(screen.getAllByRole("row")[0]).toHaveTextContent("PROVIDER_FAILOVER");
    await user.clear(screen.getByRole("searchbox", { name: "Search events" }));
    await user.type(screen.getByRole("searchbox", { name: "Search events" }), "no such thing");
    expect(screen.queryAllByRole("row")).toHaveLength(0);
    expect(screen.getByText("No events match the current filter.")).toBeInTheDocument();
  });

  it("expands a payload with click and keyboard", async () => {
    const user = userEvent.setup();
    const events = buildSampleEvents();
    render(<EventLog events={events} nodes={SAMPLE_NODES} defaultFamilies={["provider"]} />);
    const row = screen.getAllByRole("row")[0];
    if (!row) throw new Error("row missing");
    expect(row).toHaveAttribute("aria-expanded", "false");
    await user.click(row);
    expect(row).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("payload")).toBeInTheDocument();
    expect(within(row.parentElement as HTMLElement).getByText(/"from"/)).toBeInTheDocument();
    row.focus();
    await user.keyboard("{ArrowLeft}");
    expect(row).toHaveAttribute("aria-expanded", "false");
    await user.keyboard("{Enter}");
    expect(row).toHaveAttribute("aria-expanded", "true");
  });

  it("uses the node category for NODE_* badges and danger for failures", () => {
    const events = buildSampleEvents();
    render(<EventLog events={events} nodes={SAMPLE_NODES} defaultFamilies={["node"]} />);
    const failed = screen.getAllByRole("row").find((r) => r.dataset.type === "NODE_FAILED");
    expect(failed?.querySelector(".bg-danger-soft")).not.toBeNull();
    const started = screen
      .getAllByRole("row")
      .find((r) => r.dataset.type === "NODE_STARTED" && r.textContent?.includes("Intent"));
    expect(started?.querySelector("[data-category=decision]")).not.toBeNull();
  });
});
