import { describe, expect, it } from "vitest";
import { parseFilters } from "@flowaid/ui/data";
import { ago, evidenceLines, insightWindowFor, isInsightsReport, runsHref } from "./insights";

describe("insight helpers", () => {
  it("maps dashboard ranges to insight windows", () => {
    expect(insightWindowFor("1h")).toBe("24h");
    expect(insightWindowFor("24h")).toBe("24h");
    expect(insightWindowFor("7d")).toBe("7d");
    expect(insightWindowFor("30d")).toBe("30d");
    expect(insightWindowFor("90d")).toBe("30d");
  });

  it("links to the workflow's runs in the window, failed only when asked", () => {
    const window = { from: "2026-09-21T12:00:00.000Z", to: "2026-09-28T12:00:00.000Z" };
    const href = runsHref("default", "wf-1", window, true);
    expect(href.startsWith("/default/runs?")).toBe(true);
    const f = parseFilters(href.slice(href.indexOf("?")));
    expect(f.workflow).toEqual(["wf-1"]);
    expect(f.status).toEqual(["failed", "timed_out"]);
    expect(f.range).toEqual({ preset: "custom", ...window });
    expect(
      parseFilters(runsHref("default", "wf-1", window).split("?")[1] ?? "").status,
    ).toBeUndefined();
  });

  it("recognises the report shape and nothing else", () => {
    expect(isInsightsReport({ items: [] })).toBe(false);
    expect(isInsightsReport(null)).toBe(false);
    expect(
      isInsightsReport({
        attention: { openApprovals: { count: 0 }, failingWorkflows: [] },
        insights: [],
      }),
    ).toBe(true);
  });

  it("says how long ago, coarsely", () => {
    const now = Date.parse("2026-09-28T12:00:00Z");
    expect(ago("2026-09-28T11:59:40Z", now)).toBe("just now");
    expect(ago("2026-09-28T11:58:50Z", now)).toBe("1 minute ago");
    expect(ago("2026-09-28T11:30:00Z", now)).toBe("30 minutes ago");
    expect(ago("2026-09-28T09:00:00Z", now)).toBe("3 hours ago");
    expect(ago("2026-09-26T12:00:00Z", now)).toBe("2 days ago");
  });

  it("writes the evidence as checkable lines", () => {
    expect(
      evidenceLines({
        metric: "failure rate of finished runs",
        recent: { value: 0.5, n: 40, interval: { lo: 0.352, hi: 0.648 } },
        baseline: { value: 0.0333, n: 60, interval: { lo: 0.0092, hi: 0.1135 } },
        effect: { points: 46.7, ratio: 15 },
        test: "fisher_exact",
        pValue: 0.0000012,
        qValue: 0.0000048,
      }),
    ).toEqual([
      "Recent: 50.0% of 40 runs (95% CI 35.2%–64.8%)",
      "Before: 3.3% of 60 runs (95% CI 0.9%–11.3%)",
      "Change: +46.7 points",
      "Fisher's exact test (one-sided): p < 0.001, q < 0.001 after Benjamini–Hochberg",
    ]);
    expect(
      evidenceLines({
        metric: "runs failing with E_AUTH",
        recent: { value: 4, n: 100 },
        baseline: { value: 0, n: 200 },
        effect: {},
        test: "novelty",
        pValue: null,
        qValue: null,
      }),
    ).toEqual(["4 of 100 recent runs; 0 of 200 before", "New since the baseline (no test)"]);
  });
});
