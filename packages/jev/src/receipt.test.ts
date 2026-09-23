import { describe, expect, it } from "vitest";
import {
  buildReceipt,
  buildReceiptChain,
  checkReceipt,
  receiptHash,
  verifyReceiptChain,
  type BuildReceiptInput,
} from "./receipt.js";
import { contractRef } from "./contract.js";
import { DecisionReceiptSchema } from "./wire.js";
import { choiceDecision, templateContract } from "./test-fixtures.js";

const body = templateContract("support.ticket_router");
const keys = ["billing", "account_access", "technical", "general", "none"];
let n = 0;
const id = (): string => `0190a1b2-0000-7000-8000-${String((n += 1)).padStart(12, "0")}`;

function input(top = "billing", p = 0.92): BuildReceiptInput {
  return {
    receiptId: id(),
    runId: id(),
    nodeRunId: id(),
    nodeId: "route",
    scope: "",
    question: "route",
    bundleId: "b1",
    batchId: "b1#1",
    mode: "live",
    contract: body,
    contractRef: contractRef(body, "registry"),
    stateReference: {
      stateVersion: "run:@1",
      packetHash: "a".repeat(64),
      snapshotId: null,
      fidelity: "exact",
    },
    evidenceScope: { fields: ["message"], evidenceIds: ["msg_1"] },
    decision: choiceDecision(Object.fromEntries(keys.map((k) => [k, k === top ? p : (1 - p) / 4]))),
    model: { provider: "typesafe", requested: "jev-latest", resolved: "jev-1.13.0" },
    at: "2026-09-23T10:00:00.000Z",
  };
}

describe("decision receipts", () => {
  it("records the contract version, state reference and full distribution", () => {
    const r = buildReceipt(input());
    expect(DecisionReceiptSchema.parse(r)).toEqual(r);
    expect(r.contract.key).toBe("support.ticket_router");
    expect(r.outcome).toBe("billing");
    expect(Object.keys(r.distribution).sort()).toEqual([...keys].sort());
    expect(r.model.resolved).toBe("jev-1.13.0");
    expect(checkReceipt(r)).toEqual([]);
  });

  it("hashes receipts deterministically", () => {
    const i = input();
    expect(receiptHash(buildReceipt(i))).toBe(receiptHash(buildReceipt(i)));
  });

  it("detects tampering, reordering and truncation of a receipt chain", () => {
    const receipts = [
      buildReceipt(input("billing")),
      buildReceipt(input("technical")),
      buildReceipt(input("general")),
    ];
    const chain = buildReceiptChain(receipts);
    expect(verifyReceiptChain(chain, receipts)).toMatchObject({ ok: true });
    const tampered = receipts.map((r, i) => (i === 1 ? { ...r, outcome: "billing" } : r));
    expect(verifyReceiptChain(chain, tampered)).toMatchObject({
      ok: false,
      brokenAt: 1,
      reason: "receipt_hash",
    });
    const swapped = [chain[1], chain[0], chain[2]].filter((l) => l !== undefined);
    expect(verifyReceiptChain(swapped)).toMatchObject({ ok: false, brokenAt: 0 });
    expect(verifyReceiptChain(chain.slice(0, 2), receipts)).toMatchObject({
      ok: false,
      reason: "length",
    });
  });
});
