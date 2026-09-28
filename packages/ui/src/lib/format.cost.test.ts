import { describe, expect, it } from "vitest";
import { formatCost } from "./format";

describe("formatCost", () => {
  it("writes small amounts as plain decimals, never in scientific notation", () => {
    expect(formatCost(0.000012)).toBe("$0.000012");
    expect(formatCost(0.0000123)).toBe("$0.000012");
    expect(formatCost(0.00009)).toBe("$0.00009");
    expect(formatCost(0.0000004)).toBe("<$0.000001");
    expect(formatCost(0.0042)).toBe("$0.00420");
    expect(formatCost(0)).toBe("$0");
    expect(formatCost(12.5)).toBe("$12.50");
  });
});
