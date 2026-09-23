import { describe, expect, it } from "vitest";
import { addUsage, deadlineTimerId, money } from "./projections.js";

describe("projection helpers", () => {
  it("derives the run deadline timer id like the runtime", () => {
    expect(deadlineTimerId("00000000-0000-4000-8000-00000000abcd")).toBe(
      "315da7c8-fbc3-4d1b-8837-18ee2f31547b",
    );
  });

  it("adds usage and formats money", () => {
    expect(
      addUsage(
        { inputTokens: 1, outputTokens: 2 },
        { inputTokens: 3, outputTokens: 4, cacheReadTokens: 5 },
      ),
    ).toEqual({ inputTokens: 4, outputTokens: 6, cacheReadTokens: 5 });
    expect(addUsage({ inputTokens: 1, outputTokens: 2 }, null)).toEqual({
      inputTokens: 1,
      outputTokens: 2,
    });
    expect(money(0.1 + 0.2)).toBe("0.300000");
  });
});
