import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DEFAULT_SLA_THRESHOLDS, SlaChip, slaState } from "./SlaChip";
import { formatDurationShort, formatRelativeShort } from "./time";

afterEach(cleanup);

const NOW = Date.parse("2026-09-22T14:00:00Z");

describe("slaState", () => {
  it("classifies remaining time against the default thresholds", () => {
    expect(slaState(60 * 60_000)).toBe("ok");
    expect(slaState(DEFAULT_SLA_THRESHOLDS.warnMs)).toBe("warn");
    expect(slaState(DEFAULT_SLA_THRESHOLDS.warnMs + 1)).toBe("ok");
    expect(slaState(DEFAULT_SLA_THRESHOLDS.dangerMs)).toBe("danger");
    expect(slaState(1)).toBe("danger");
    expect(slaState(0)).toBe("expired");
    expect(slaState(-5_000)).toBe("expired");
    expect(slaState(Number.NaN)).toBe("expired");
  });

  it("honours custom thresholds", () => {
    const t = { warnMs: 60_000, dangerMs: 10_000 };
    expect(slaState(120_000, t)).toBe("ok");
    expect(slaState(30_000, t)).toBe("warn");
    expect(slaState(5_000, t)).toBe("danger");
  });
});

describe("formatDurationShort", () => {
  it("picks the two most significant units", () => {
    expect(formatDurationShort(12_000)).toBe("12s");
    expect(formatDurationShort(4 * 60_000 + 12_000)).toBe("4m 12s");
    expect(formatDurationShort(60 * 60_000 + 4 * 60_000)).toBe("1h 04m");
    expect(formatDurationShort(2 * 86_400_000 + 3 * 3_600_000)).toBe("2d 3h");
    expect(formatDurationShort(-10_000)).toBe("0s");
  });
});

describe("formatRelativeShort", () => {
  it("rounds to the nearest readable unit", () => {
    expect(formatRelativeShort(NOW - 10_000, NOW)).toBe("just now");
    expect(formatRelativeShort(NOW - 4 * 60_000, NOW)).toBe("4 min ago");
    expect(formatRelativeShort(NOW - 3 * 3_600_000, NOW)).toBe("3 h ago");
    expect(formatRelativeShort(NOW - 2 * 86_400_000, NOW)).toBe("2 d ago");
  });
});

describe("SlaChip", () => {
  it("renders the remaining time with the ok state", () => {
    render(<SlaChip expiresAt={NOW + 42 * 60_000} now={NOW} />);
    const chip = screen.getByRole("timer");
    expect(chip).toHaveAttribute("data-sla", "ok");
    expect(chip).toHaveTextContent("42m 00s");
  });

  it("turns warn and danger as the deadline approaches", () => {
    const { rerender } = render(<SlaChip expiresAt={NOW + 10 * 60_000} now={NOW} />);
    expect(screen.getByRole("timer")).toHaveAttribute("data-sla", "warn");
    rerender(<SlaChip expiresAt={NOW + 2 * 60_000} now={NOW} />);
    expect(screen.getByRole("timer")).toHaveAttribute("data-sla", "danger");
  });

  it("reads Expired once the deadline has passed", () => {
    render(<SlaChip expiresAt={NOW - 1_000} now={NOW} />);
    const chip = screen.getByRole("timer");
    expect(chip).toHaveAttribute("data-sla", "expired");
    expect(chip).toHaveTextContent("Expired");
    expect(chip).toHaveAccessibleName("SLA expired");
  });
});
