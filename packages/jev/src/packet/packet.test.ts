import { describe, expect, it } from "vitest";
import { buildPacket, truncationMarker } from "./build.js";
import { planBundle } from "../bundle.js";
import { toDecisionQuestion, toSystemOneQuestion } from "../question.js";
import { templateContract } from "../test-fixtures.js";

const body = templateContract("support.ticket_router");
const SV = "0190a1b2-0000-7000-8000-000000000001:@4";
const NOW = "2026-09-23T10:00:00.000Z";
const message = [
  { id: "msg_1", kind: "customer_message", summary: "I was charged twice for order A-104" },
];

describe("state packets", () => {
  it("builds a compact packet from declared fields only, with a stable hash", () => {
    const r = buildPacket(
      body.state,
      { message, channel: "email", transcript: "hello" },
      { stateVersion: SV, now: NOW },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.packet).toEqual({
      goal: body.state.goal,
      facts: { channel: "email" },
      evidence: [
        {
          id: "msg_1",
          kind: "customer_message",
          supports: [],
          summary: "I was charged twice for order A-104",
        },
      ],
      stateVersion: SV,
    });
    expect(r.value.report.included).toEqual(["channel", "message"]);
    expect(r.value.report.excluded.map((e) => e.field)).toContain("transcript");
    expect(r.value.packetHash).toMatch(/^[0-9a-f]{64}$/);
    const again = buildPacket(
      body.state,
      { channel: "email", message },
      { stateVersion: SV, now: NOW },
    );
    expect(again.ok && again.value.packetHash).toBe(r.value.packetHash);
    expect(r.value.tokens).toBeGreaterThan(0);
  });

  it("fails on a missing required field and on an invalid clock", () => {
    const missing = buildPacket(body.state, { channel: "email" }, { stateVersion: SV, now: NOW });
    expect(missing.ok).toBe(false);
    const clock = buildPacket(body.state, { message }, { stateVersion: SV, now: "yesterday" });
    expect(clock.ok).toBe(false);
  });

  it("keeps pii out of a provider that may only receive internal data", () => {
    const r = buildPacket(
      body.state,
      { message, channel: "email" },
      { stateVersion: SV, now: NOW, eligibleClass: "internal" },
    );
    expect(r.ok).toBe(false);
  });

  it("marks truncation with the dropped character count", () => {
    expect(truncationMarker(42)).toBe("…[truncated 42 chars]");
  });
});

describe("bundle planning", () => {
  it("plans one TypeSafe request per packet and counts tokens", () => {
    const p = buildPacket(body.state, { message, channel: "chat" }, { stateVersion: SV, now: NOW });
    if (!p.ok) throw new Error("packet");
    const question = toSystemOneQuestion(toDecisionQuestion(body));
    const plan = planBundle({
      bundleId: "b1",
      stateVersion: SV,
      questions: [
        {
          key: "route",
          question,
          packet: { packet: p.value.packet, packetHash: p.value.packetHash, stateVersion: SV },
          hop: { provider: "typesafe", model: "jev-latest" },
          credential: "TYPESAFE_API_KEY",
          privacyClass: "pii",
          latencyClass: "interactive",
        },
      ],
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.plan.requests).toHaveLength(1);
    const req = plan.plan.requests[0];
    expect(req?.questionKeys).toEqual(["route"]);
    expect(req?.request.model).toBe("jev-latest");
    expect(req?.tokens.total).toBe((req?.tokens.state ?? 0) + (req?.tokens.questions ?? 0));
  });

  it("refuses questions from a different snapshot", () => {
    const p = buildPacket(body.state, { message }, { stateVersion: SV, now: NOW });
    if (!p.ok) throw new Error("packet");
    const plan = planBundle({
      bundleId: "b2",
      stateVersion: "0190a1b2-0000-7000-8000-000000000001:@9",
      questions: [
        {
          key: "route",
          question: toSystemOneQuestion(toDecisionQuestion(body)),
          packet: { packet: p.value.packet, packetHash: p.value.packetHash, stateVersion: SV },
          hop: { provider: "typesafe", model: "jev-latest" },
          credential: null,
          privacyClass: "pii",
          latencyClass: "interactive",
        },
      ],
    });
    expect(plan.ok).toBe(false);
  });
});
