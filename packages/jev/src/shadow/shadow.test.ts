import { describe, expect, it } from "vitest";
import {
  compareShadow,
  mapProductionAnswer,
  summarizeShadow,
  type CompareShadowInput,
} from "./index.js";

const OUTCOMES = ["billing", "account_access", "technical", "general", "none"];
const HASH = "a".repeat(64);

let n = 0;
function uuid(): string {
  n += 1;
  return `0190a1b2-0000-7000-8000-${String(n).padStart(12, "0")}`;
}

function input(
  shadow: string,
  production: string | null,
  humanLabel: string | null = null,
): CompareShadowInput {
  return {
    id: uuid(),
    receiptId: uuid(),
    contract: { key: "support.ticket_router", version: 1, hash: HASH, origin: "registry" },
    runId: uuid(),
    nodeRunId: uuid(),
    question: "route",
    stateHash: HASH,
    jevModel: "jev-1.13.0",
    shadow: {
      outcome: shadow,
      confidence: 0.92,
      distribution: { [shadow]: 0.92 },
      wouldRoute: "auto",
    },
    production: {
      source: "llm",
      nodeId: "classify",
      nodeRunId: null,
      rawAnswer: production,
      confidence: null,
    },
    outcomes: OUTCOMES,
    aliases: { "Tech Support": "technical" },
    humanLabel,
    at: "2026-09-23T10:00:00.000Z",
  };
}

describe("mapProductionAnswer", () => {
  it("maps exact, normalised and aliased answers and rejects the rest", () => {
    expect(mapProductionAnswer("billing", OUTCOMES)).toBe("billing");
    expect(mapProductionAnswer("  Account Access ", OUTCOMES)).toBe("account_access");
    expect(mapProductionAnswer("account-access", OUTCOMES)).toBe("account_access");
    expect(mapProductionAnswer("tech support", OUTCOMES, { "Tech Support": "technical" })).toBe(
      "technical",
    );
    expect(mapProductionAnswer("sales", OUTCOMES)).toBeNull();
    expect(mapProductionAnswer(null, OUTCOMES)).toBeNull();
  });
});

describe("compareShadow", () => {
  it("never takes an action and records agreement", () => {
    const r = compareShadow(input("billing", "Billing"));
    expect(r.actionTaken).toBe(false);
    expect(r.agree).toBe(true);
    expect(r.production.answer).toBe("billing");
  });

  it("leaves agreement unknown when the production answer cannot be mapped", () => {
    expect(compareShadow(input("billing", "refund desk")).agree).toBeNull();
  });
});

describe("summarizeShadow", () => {
  it("separates agreement from accuracy against human labels", () => {
    const records = [
      compareShadow(input("billing", "billing", "billing")),
      compareShadow(input("technical", "billing", "technical")),
      compareShadow(input("technical", "general", "technical")),
      compareShadow(input("general", "nonsense")),
    ];
    const s = summarizeShadow(records);
    expect(s.total).toBe(4);
    expect(s.comparable).toBe(3);
    expect(s.unmappable).toBe(1);
    expect(s.agreement).toBeCloseTo(1 / 3, 10);
    expect(s.vsHuman).toEqual({ labeled: 3, shadowAccuracy: 1, productionAccuracy: 1 / 3 });
    expect(s.disagreements).toHaveLength(2);
    const bi = s.confusion.labels.indexOf("billing");
    const ti = s.confusion.labels.indexOf("technical");
    expect(s.confusion.matrix[bi]?.[ti]).toBe(1);
    expect(s.wouldRoute.auto).toBe(1);
  });

  it("handles an empty window", () => {
    const s = summarizeShadow([]);
    expect(s.agreement).toBeNull();
    expect(s.vsHuman.shadowAccuracy).toBeNull();
    expect(s.confusion.matrix).toEqual([]);
  });
});
