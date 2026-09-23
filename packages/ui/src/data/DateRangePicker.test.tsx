import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installDomStubs } from "@/primitives/testStubs";
import {
  DATE_RANGE_PRESETS,
  DateRangePanel,
  DateRangePicker,
  RangeCalendar,
  customDateRange,
  formatDateRangeLabel,
  parseDateRangeValue,
  resolveDateRange,
  serializeDateRangeValue,
} from "./DateRangePicker";

afterEach(cleanup);
beforeAll(() => installDomStubs());

const NOW = new Date(2026, 8, 22, 14, 0, 0); // 22 Sep 2026, local

describe("presets and values", () => {
  it("resolves each preset to a window ending now", () => {
    for (const p of DATE_RANGE_PRESETS) {
      const r = resolveDateRange({ preset: p.key }, NOW);
      expect(r.to).toEqual(NOW);
      expect(NOW.getTime() - r.from.getTime()).toBe(p.ms);
    }
  });

  it("resolves custom windows and orders them", () => {
    const r = resolveDateRange(
      { preset: "custom", from: "2026-09-22T00:00:00.000Z", to: "2026-09-01T00:00:00.000Z" },
      NOW,
    );
    expect(r.from.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-09-22T00:00:00.000Z");
  });

  it("serialises and parses", () => {
    expect(serializeDateRangeValue({ preset: "24h" })).toBe("24h");
    expect(parseDateRangeValue("24h")).toEqual({ preset: "24h" });
    const custom = customDateRange(new Date(2026, 8, 1), new Date(2026, 8, 10));
    expect(parseDateRangeValue(serializeDateRangeValue(custom))).toEqual(custom);
    expect(parseDateRangeValue("garbage")).toBeUndefined();
    expect(parseDateRangeValue("a..b")).toBeUndefined();
    expect(parseDateRangeValue("")).toBeUndefined();
  });

  it("labels values", () => {
    expect(formatDateRangeLabel(null)).toBe("Any time");
    expect(formatDateRangeLabel({ preset: "7d" })).toBe("Last 7 days");
    expect(formatDateRangeLabel(customDateRange(new Date(2026, 8, 1), new Date(2026, 8, 22)))).toBe(
      "1 Sep – 22 Sep 2026",
    );
    expect(formatDateRangeLabel(customDateRange(new Date(2026, 8, 5), new Date(2026, 8, 5)))).toBe(
      "5 Sep 2026",
    );
    expect(
      formatDateRangeLabel(customDateRange(new Date(2025, 11, 30), new Date(2026, 0, 2))),
    ).toBe("30 Dec 2025 – 2 Jan 2026");
  });
});

describe("RangeCalendar", () => {
  it("shows two months ending at today and disables future days", () => {
    render(<RangeCalendar today={NOW} />);
    expect(screen.getByRole("grid", { name: "August 2026" })).toBeInTheDocument();
    expect(screen.getByRole("grid", { name: "September 2026" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Wednesday 23 September 2026" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Tuesday 22 September 2026" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next month" })).toBeDisabled();
  });

  it("selects a range with the keyboard: arrows then Enter twice", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<RangeCalendar today={NOW} onSelect={onSelect} />);
    const today = screen.getByRole("button", { name: "Tuesday 22 September 2026" });
    expect(today).toHaveAttribute("tabindex", "0");
    today.focus();
    await user.keyboard("{ArrowLeft}{ArrowLeft}{ArrowUp}");
    expect(document.activeElement).toHaveAttribute("aria-label", "Sunday 13 September 2026");
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenLastCalledWith({ from: new Date(2026, 8, 13) });
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onSelect).toHaveBeenLastCalledWith({
      from: new Date(2026, 8, 13),
      to: new Date(2026, 8, 20),
    });
  });

  it("moves between months with PageUp and Home/End", async () => {
    const user = userEvent.setup();
    render(<RangeCalendar today={NOW} />);
    screen.getByRole("button", { name: "Tuesday 22 September 2026" }).focus();
    await user.keyboard("{Home}");
    expect(document.activeElement).toHaveAttribute("aria-label", "Monday 21 September 2026");
    // End would land on Sunday 27, in the future: focus clamps to today.
    await user.keyboard("{End}");
    expect(document.activeElement).toHaveAttribute("aria-label", "Tuesday 22 September 2026");
    await user.keyboard("{PageUp}{PageUp}");
    expect(screen.getByRole("grid", { name: "July 2026" })).toBeInTheDocument();
    expect(document.activeElement).toHaveAttribute("aria-label", "Wednesday 22 July 2026");
    await user.keyboard("{PageDown}");
    expect(document.activeElement).toHaveAttribute("aria-label", "Saturday 22 August 2026");
  });

  it("orders a backwards click selection", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<RangeCalendar today={NOW} onSelect={onSelect} />);
    await user.click(screen.getByRole("button", { name: "Friday 18 September 2026" }));
    await user.click(screen.getByRole("button", { name: "Monday 7 September 2026" }));
    expect(onSelect).toHaveBeenLastCalledWith({
      from: new Date(2026, 8, 7),
      to: new Date(2026, 8, 18),
    });
  });
});

describe("DateRangePanel / DateRangePicker", () => {
  it("emits presets and marks the active one", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onDone = vi.fn();
    render(
      <DateRangePanel value={{ preset: "7d" }} onChange={onChange} onDone={onDone} now={NOW} />,
    );
    expect(screen.getByRole("option", { name: /Last 7 days/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await user.click(screen.getByRole("option", { name: /Last hour/ }));
    expect(onChange).toHaveBeenCalledWith({ preset: "1h" });
    expect(onDone).toHaveBeenCalled();
  });

  it("emits a custom range after two day clicks", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DateRangePanel onChange={onChange} now={NOW} />);
    await user.click(screen.getByRole("button", { name: "Tuesday 1 September 2026" }));
    expect(screen.getByText(/pick an end day/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Thursday 10 September 2026" }));
    expect(onChange).toHaveBeenCalledWith(
      customDateRange(new Date(2026, 8, 1), new Date(2026, 8, 10)),
    );
  });

  it("opens from the trigger and closes after choosing a preset", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DateRangePicker value={null} onChange={onChange} now={NOW} label="Created" />);
    const trigger = screen.getByRole("button", { name: "Created: Any time" });
    await user.click(trigger);
    await user.click(await screen.findByRole("option", { name: /Last 30 days/ }));
    expect(onChange).toHaveBeenCalledWith({ preset: "30d" });
    expect(screen.queryByRole("listbox", { name: "Presets" })).not.toBeInTheDocument();
  });
});
