import { describe, expect, it } from "vitest";
import { monthlyBudgetOf, utcMonth } from "./budget.js";

describe("utcMonth", () => {
  it("bounds the calendar month in UTC, whatever the local time zone", () => {
    expect(utcMonth(new Date("2030-03-31T23:59:59.999Z"))).toEqual({
      key: "2030-03",
      start: new Date("2030-03-01T00:00:00Z"),
      end: new Date("2030-04-01T00:00:00Z"),
    });
    expect(utcMonth(new Date("2030-04-01T00:00:00Z")).key).toBe("2030-04");
    expect(utcMonth(new Date("2030-12-15T00:00:00Z")).end).toEqual(
      new Date("2031-01-01T00:00:00Z"),
    );
  });
});

describe("monthlyBudgetOf", () => {
  it("reads a positive budget and ignores anything else", () => {
    expect(monthlyBudgetOf({ budgets: { monthlyCostUsd: 250 } })).toBe(250);
    expect(monthlyBudgetOf({ budgets: { monthlyCostUsd: 0 } })).toBeNull();
    expect(monthlyBudgetOf({ budgets: { monthlyCostUsd: "250" } })).toBeNull();
    expect(monthlyBudgetOf({})).toBeNull();
    expect(monthlyBudgetOf(null)).toBeNull();
  });
});
