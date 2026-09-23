import { describe, expect, it } from "vitest";
import { parseContract } from "../contract.js";
import { route, routeAction, ILLUSTRATIVE_THRESHOLDS } from "./route.js";
import { topMargin } from "./confidence.js";
import { BlindRetryGuard, blindRetryKey } from "./retryGuard.js";
import { booleanDecision, choiceDecision, templateContract } from "../test-fixtures.js";

const router = templateContract("support.ticket_router");
const keys = ["billing", "account_access", "technical", "general", "none"];
function dist(top: string, p: number): Record<string, number> {
  const rest = keys.filter((k) => k !== top);
  const out: Record<string, number> = { [top]: p };
  for (const k of rest) out[k] = (1 - p) / rest.length;
  return out;
}

describe("confidence × consequence routing", () => {
  it("automates a calibrated, confident, low-consequence decision and names the port", () => {
    const r = route({
      contract: router,
      decision: choiceDecision(dist("billing", 0.93)),
      calibrated: true,
    });
    expect(r).toMatchObject({
      route: "auto",
      port: "billing",
      consequenceClass: "low",
      outcome: "billing",
    });
    expect(r.reasons).toEqual(["zone_auto"]);
    expect(routeAction(r)).toBeDefined();
  });

  it("sends uncalibrated providers to a human (conflict C3)", () => {
    const r = route({
      contract: router,
      decision: choiceDecision(dist("billing", 0.93)),
      calibrated: false,
    });
    expect(r.route).toBe("human");
    expect(r.reasons).toContain("provider_uncalibrated");
    expect(r.port).toBeNull();
  });

  it("routes below the automation threshold away from auto", () => {
    const r = route({
      contract: router,
      decision: choiceDecision(dist("billing", 0.6)),
      calibrated: true,
    });
    expect(r.route).not.toBe("auto");
  });

  it("uses the fallback outcome when evaluation could not run", () => {
    const r = route({ contract: router, decision: null, calibrated: true });
    expect(r).toMatchObject({ route: "human", outcome: "none", escape: "none" });
    expect(r.reasons).toContain("fallback_outcome");
  });

  it("never automates an escape outcome", () => {
    const r = route({
      contract: router,
      decision: choiceDecision(dist("none", 0.97)),
      calibrated: true,
    });
    expect(r.route).toBe("human");
    expect(r.reasons).toContain("escape_outcome");
  });

  it("routes irreversible consequences to a human at every confidence", () => {
    const irreversible = parseContract({
      ...router,
      routing: { ...router.routing, consequenceClass: "irreversible", thresholds: {} },
    });
    const r = route({
      contract: irreversible,
      decision: choiceDecision(dist("billing", 0.999)),
      calibrated: true,
    });
    expect(r.route).toBe("human");
    expect(r.reasons).toContain("consequence_irreversible");
  });

  it("is deterministic", () => {
    const input = {
      contract: router,
      decision: choiceDecision(dist("technical", 0.91)),
      calibrated: true,
    };
    expect(route(input)).toEqual(route(input));
  });

  it("routes a Noul decision with its own confidence", () => {
    const needsOwner = templateContract("ops.alert_needs_owner");
    const r = route({ contract: needsOwner, decision: booleanDecision(0.5), calibrated: true });
    expect(r.route).not.toBe("auto");
  });

  it("keeps illustrative defaults conservative: only low consequence may auto-act", () => {
    expect(ILLUSTRATIVE_THRESHOLDS.low.autoAt).toBe(0.9);
    expect(ILLUSTRATIVE_THRESHOLDS.medium.autoAt).toBeNull();
    expect(ILLUSTRATIVE_THRESHOLDS.high.autoAt).toBeNull();
  });

  it("computes the top-two margin", () => {
    expect(topMargin({ a: 0.7, b: 0.2, c: 0.1 })).toBeCloseTo(0.5, 10);
    expect(topMargin({ a: 1 })).toBe(1);
  });
});

describe("blind-retry guard", () => {
  it("blocks re-asking the same contract on the same packet", () => {
    const key = blindRetryKey({
      contractHash: "c".repeat(64),
      packetHash: "p".repeat(64),
      optionSetVersion: null,
    });
    const guard = new BlindRetryGuard<string>();
    expect(guard.check("route", "", key)).toBeNull();
    guard.record("route", "", key, "human");
    expect(guard.check("route", "", key)?.result).toBe("human");
    expect(guard.rounds("route", "")).toBe(1);
    expect(guard.check("route", "loop#1", key)).toBeNull();
  });

  it("changes the key when the evidence or the live menu changes", () => {
    const base = {
      contractHash: "c".repeat(64),
      packetHash: "p".repeat(64),
      optionSetVersion: null,
    };
    expect(blindRetryKey({ ...base, packetHash: "q".repeat(64) })).not.toBe(blindRetryKey(base));
    expect(blindRetryKey({ ...base, optionSetVersion: "v2" })).not.toBe(blindRetryKey(base));
  });
});
