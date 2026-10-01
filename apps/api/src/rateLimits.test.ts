import { describe, expect, it } from "vitest";
import { rateLimitsFrom } from "./context.js";

describe("rate limits from RATE_LIMIT_MAX", () => {
  it("keeps the defaults when unset, and scales all three from the session value", () => {
    expect(rateLimitsFrom(undefined)).toEqual({ session: 600, apiKey: 1200, public: 120 });
    expect(rateLimitsFrom("5000")).toEqual({ session: 5000, apiKey: 10000, public: 1000 });
    expect(rateLimitsFrom(3)).toEqual({ session: 3, apiKey: 6, public: 1 });
  });

  it("ignores values that are not a positive number", () => {
    expect(rateLimitsFrom("lots")).toEqual({ session: 600, apiKey: 1200, public: 120 });
    expect(rateLimitsFrom(0)).toEqual({ session: 600, apiKey: 1200, public: 120 });
  });
});
