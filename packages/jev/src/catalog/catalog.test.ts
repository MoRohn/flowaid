import { describe, expect, it } from "vitest";
import { FAILURE_MODES, failureModesForCode, failureModesForReason } from "./failureModes.js";
import { JEV_DIAGNOSTIC_CODES, isJevDiagnosticCode, severityOf } from "./codes.js";
import { exactRuleMatch, isMultiLabelPhrasing, isPraiseOnly, jaccard } from "../lint/text.js";

describe("failure-mode catalog", () => {
  it("covers the handbook's 31 failure modes and 45 diagnostic codes", () => {
    expect(FAILURE_MODES).toHaveLength(31);
    expect(JEV_DIAGNOSTIC_CODES).toHaveLength(45);
    expect(new Set(FAILURE_MODES.map((f) => f.id)).size).toBe(31);
  });

  it("links runtime route reasons and diagnostics back to failure modes", () => {
    expect(failureModesForReason("stale_option").length).toBeGreaterThan(0);
    for (const code of JEV_DIAGNOSTIC_CODES) expect(isJevDiagnosticCode(code)).toBe(true);
    expect(isJevDiagnosticCode("E_NOT_A_CODE")).toBe(false);
    const linked = JEV_DIAGNOSTIC_CODES.filter((c) => failureModesForCode(c).length > 0);
    expect(linked.length).toBeGreaterThan(0);
  });

  it("derives severity from the code prefix", () => {
    const e = JEV_DIAGNOSTIC_CODES.find((c) => c.startsWith("E_"));
    const w = JEV_DIAGNOSTIC_CODES.find((c) => c.startsWith("W_"));
    if (e) expect(severityOf(e)).toBe("error");
    if (w) expect(severityOf(w)).toBe("warning");
  });
});

describe("contract text lints", () => {
  it("flags exact rules that belong in code", () => {
    expect(exactRuleMatch("Is the amount greater than 50 dollars?")).toBe("numeric comparison");
    expect(exactRuleMatch("Is the customer frustrated with the delay?")).toBeNull();
  });

  it("flags multi-label phrasing that a single Choice cannot answer", () => {
    expect(isMultiLabelPhrasing("Which of these apply? Select all that apply")).toBe(true);
    expect(isMultiLabelPhrasing("Which team should handle this ticket?")).toBe(false);
  });

  it("detects praise-only option descriptions and measures overlap", () => {
    expect(isPraiseOnly("best")).toBe(true);
    expect(isPraiseOnly("Invoices, charges and refunds")).toBe(false);
    expect(jaccard("refund charge invoice", "refund charge invoice")).toBe(1);
    expect(jaccard("refund", "outage")).toBe(0);
  });
});
