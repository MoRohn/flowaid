/**
 * State-packet helpers for the packet viewer (JEV_ENGINEERING.md §5): the
 * canonical section order of Table IV, the chars / 3.5 token estimate and the
 * budget against the contract's `maxTokens` and TypeSafe's 32k limit.
 */
import type { JevEvidenceItem, JevStatePacket, PacketRole } from "./types";
import { JEV_LIMITS } from "./vocabulary";

/** Canonical JSON with sorted object keys (the builder's `stableStringify`). */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value))
    return `[${value.map((v) => (v === undefined ? "null" : canonicalJson(v))).join(",")}]`;
  const entries = Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** `ceil(chars / 3.5)` over the canonical packet — the estimator the provider guard uses. */
export function estimatePacketTokens(packet: unknown): number {
  return Math.ceil(canonicalJson(packet).length / JEV_LIMITS.charsPerToken);
}

export type BudgetStatus = "ok" | "near" | "over" | "limit";

export interface TokenBudget {
  tokens: number;
  maxTokens: number;
  /** tokens / maxTokens (may exceed 1). */
  fraction: number;
  /** tokens / 32 000 (state + longest question). */
  hardFraction: number;
  /** Tokens left for the longest question under the 32k limit. */
  questionHeadroom: number;
  status: BudgetStatus;
}

/**
 * Budget of a packet. `near` from 85 % of `maxTokens`; `over` above it (the
 * builder fails with `packet_over_budget`, never truncates silently); `limit`
 * when the packet alone leaves no room under the 32k state + question limit.
 */
export function tokenBudget(tokens: number, maxTokens: number): TokenBudget {
  const safeMax = maxTokens > 0 ? maxTokens : 1;
  const fraction = tokens / safeMax;
  const hardFraction = tokens / JEV_LIMITS.stateAndQuestionTokens;
  const status: BudgetStatus =
    tokens >= JEV_LIMITS.stateAndQuestionTokens
      ? "limit"
      : tokens > safeMax
        ? "over"
        : fraction >= 0.85
          ? "near"
          : "ok";
  return {
    tokens,
    maxTokens: safeMax,
    fraction,
    hardFraction,
    questionHeadroom: Math.max(0, JEV_LIMITS.stateAndQuestionTokens - tokens),
    status,
  };
}

export type PacketSectionKey =
  "goal" | "facts" | "artifacts" | "evidence" | "constraints" | "options" | "stateVersion";

export const PACKET_SECTION_ORDER: readonly PacketSectionKey[] = [
  "goal",
  "facts",
  "artifacts",
  "evidence",
  "constraints",
  "options",
  "stateVersion",
];

/** Table IV wording. */
export const PACKET_SECTION_LABEL: Record<PacketSectionKey, string> = {
  goal: "Goal",
  facts: "Facts",
  artifacts: "Artifacts",
  evidence: "Evidence",
  constraints: "Constraints",
  options: "Options",
  stateVersion: "Version",
};

export const PACKET_SECTION_PURPOSE: Record<PacketSectionKey, string> = {
  goal: "Defines success for the current task",
  facts: "What the system currently knows",
  artifacts: "Outputs that already exist",
  evidence: "Supports the next semantic judgment",
  constraints: "Boundaries the system may not cross",
  options: "What can happen now",
  stateVersion: "The exact evaluated snapshot",
};

/** Packet role → the section it is placed in (§5.2 placement). */
export const ROLE_SECTION: Record<PacketRole, PacketSectionKey> = {
  goal: "goal",
  fact: "facts",
  artifact: "artifacts",
  evidence: "evidence",
  constraint: "constraints",
  option: "options",
};

export interface PacketSection {
  key: PacketSectionKey;
  /** Items (evidence/artifacts), entries (facts/constraints/options), 1 for goal and version. */
  size: number;
  tokens: number;
}

/** The sections present in a packet, in canonical order, with their share of the estimate. */
export function packetSections(packet: JevStatePacket): PacketSection[] {
  const out: PacketSection[] = [];
  for (const key of PACKET_SECTION_ORDER) {
    const value = packet[key];
    if (value === undefined) continue;
    const size = Array.isArray(value)
      ? value.length
      : typeof value === "object"
        ? Object.keys(value).length
        : 1;
    if (size === 0) continue;
    out.push({ key, size, tokens: estimatePacketTokens({ [key]: value }) });
  }
  return out;
}

/** Age of an evidence item at `now`, or null without `observedAt`. */
export function evidenceAgeMs(
  item: Pick<JevEvidenceItem, "observedAt">,
  now: number,
): number | null {
  if (!item.observedAt) return null;
  const t = Date.parse(item.observedAt);
  return Number.isFinite(t) ? Math.max(0, now - t) : null;
}
