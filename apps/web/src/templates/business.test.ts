import { describe, expect, it } from "vitest";
import { BUSINESS_AREAS, businessArea, splitBusinessFlows } from "./business";

const row = (category: string, builtIn = true) => ({ category, builtIn });

describe("business flows", () => {
  it("are the built-in templates of a business category", () => {
    expect(businessArea(row("finance"))).toBe("Finance");
    expect(businessArea(row("customer-service"))).toBe("Customer service");
    expect(businessArea(row("research"))).toBeUndefined();
    // a workspace's own template is not presented as a shipped business flow
    expect(businessArea(row("finance", false))).toBeUndefined();
  });

  it("split out in the server's order", () => {
    const rows = [row("support"), row("sales"), row("research"), row("it")];
    const { business, other } = splitBusinessFlows(rows);
    expect(business.map((t) => t.category)).toEqual(["sales", "it"]);
    expect(other.map((t) => t.category)).toEqual(["support", "research"]);
  });

  it("cover the four shipped areas", () => {
    expect(Object.keys(BUSINESS_AREAS).sort()).toEqual([
      "customer-service",
      "finance",
      "it",
      "sales",
    ]);
  });
});
