import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import {
  RelativeTime,
  formatAbsoluteTime,
  formatRelativeTime,
  relativeTimeRefreshMs,
} from "./RelativeTime";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const NOW = new Date("2026-09-22T14:03:11.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe("formatRelativeTime", () => {
  it("reads 'just now' under five seconds", () => {
    expect(formatRelativeTime(ago(0), NOW)).toBe("just now");
    expect(formatRelativeTime(ago(4999), NOW)).toBe("just now");
  });

  it("uses compact units in short style", () => {
    expect(formatRelativeTime(ago(12_000), NOW)).toBe("12 s ago");
    expect(formatRelativeTime(ago(3 * 60_000), NOW)).toBe("3 m ago");
    expect(formatRelativeTime(ago(2 * 3_600_000 + 5 * 60_000), NOW)).toBe("2 h ago");
    expect(formatRelativeTime(ago(5 * 86_400_000), NOW)).toBe("5 d ago");
    expect(formatRelativeTime(ago(3 * 7 * 86_400_000), NOW)).toBe("3 w ago");
    expect(formatRelativeTime(ago(65 * 86_400_000), NOW)).toBe("2 mo ago");
    expect(formatRelativeTime(ago(400 * 86_400_000), NOW)).toBe("1 y ago");
  });

  it("spells units out in long style with plurals", () => {
    expect(formatRelativeTime(ago(60_000), NOW, "long")).toBe("1 minute ago");
    expect(formatRelativeTime(ago(3 * 60_000), NOW, "long")).toBe("3 minutes ago");
    expect(formatRelativeTime(ago(86_400_000), NOW, "long")).toBe("1 day ago");
  });

  it("handles future dates and invalid input", () => {
    expect(formatRelativeTime(new Date(NOW.getTime() + 2 * 3_600_000), NOW)).toBe("in 2 h");
    expect(formatRelativeTime("not a date", NOW)).toBe("—");
  });

  it("accepts ISO strings and epoch numbers", () => {
    expect(formatRelativeTime(ago(90_000).toISOString(), NOW.getTime())).toBe("1 m ago");
  });
});

describe("formatAbsoluteTime / relativeTimeRefreshMs", () => {
  it("formats an absolute timestamp", () => {
    expect(formatAbsoluteTime(new Date(2026, 8, 22, 14, 3, 11))).toBe("22 Sep 2026, 14:03:11");
    expect(formatAbsoluteTime(new Date(2026, 8, 22, 14, 3, 11), false)).toBe("22 Sep 2026, 14:03");
    expect(formatAbsoluteTime("nope")).toBe("—");
  });

  it("refreshes faster for recent timestamps", () => {
    expect(relativeTimeRefreshMs(ago(10_000), NOW)).toBe(1000);
    expect(relativeTimeRefreshMs(ago(10 * 60_000), NOW)).toBe(15_000);
    expect(relativeTimeRefreshMs(ago(3 * 3_600_000), NOW)).toBe(60_000);
  });
});

describe("RelativeTime", () => {
  it("renders a <time> with dateTime and updates on the shared ticker", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const date = ago(58_000);
    render(<RelativeTime date={date} tooltip={false} />);
    const el = screen.getByText(/^58 s ago/);
    expect(el.tagName).toBe("TIME");
    expect(el).toHaveAttribute("datetime", date.toISOString());
    // No native title: without its tooltip the absolute time is visually hidden text.
    expect(el).not.toHaveAttribute("title");
    expect(within(el).getByText(`(${formatAbsoluteTime(date)})`)).toHaveClass("sr-only");
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByText(/^1 m ago/)).toBeInTheDocument();
  });
});
