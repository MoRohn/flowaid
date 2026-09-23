/**
 * Question bundles over one state snapshot (JEV_ENGINEERING.md §8, handbook §VI).
 *
 * *"Same evidence may be evaluated together; new evidence requires a new snapshot"* (§VI.B).
 * A bundle is every question evaluated against one `stateVersion`; it becomes one TypeSafe
 * request per distinct packet (contracts with different projections produce different packets
 * of the same snapshot), grouped by provider hop, credential, privacy class and latency class,
 * checked against the 32k (state + longest question) limit and split under the 64k request
 * limit. `checkBundle` enforces the state boundary before anything is planned.
 */
import type { DataClass, ProviderHop } from "@flowaid/workflow-core";
import { stableStringify, type JsonObject } from "@flowaid/shared";
import { toJsonValue } from "./json.js";
import type { LatencyClass, StatePacket } from "./packet/spec.js";
import { questionTokens, type SystemOneQuestion, type SystemOneRequest } from "./question.js";
import { TYPESAFE_LIMITS, estimateTokens } from "./limits.js";
import type { JevDiagnostic } from "./catalog/codes.js";
import { jevDiagnostic } from "./catalog/codes.js";

/** One question of a bundle with the packet its contract projected. */
export interface BundleQuestion {
  /** Question key (the author's key in bundles, the node id for single decisions). */
  key: string;
  question: SystemOneQuestion;
  packet: { packet: StatePacket; packetHash: string; stateVersion: string; canonical?: string };
  hop: ProviderHop;
  /** Symbolic credential (secret name) the request is sent with; null for credential-less hops. */
  credential: string | null;
  privacyClass: DataClass;
  latencyClass: LatencyClass;
  /**
   * Question keys whose answers this question consumes. Anything that needs another answer is a
   * later node with a later snapshot — a dependency inside a bundle is refused (§VI.B).
   */
  dependsOn?: readonly string[];
  /** Label of the contract (for diagnostics). */
  contract?: string;
}

/** One planned `POST /v1/systemone`. */
export interface PlannedRequest {
  /** `<bundleId>#<n>` (n from 1). */
  batchId: string;
  stateVersion: string;
  packetHash: string;
  hop: ProviderHop;
  credential: string | null;
  privacyClass: DataClass;
  latencyClass: LatencyClass;
  questionKeys: string[];
  tokens: { state: number; questions: number; total: number };
  /** The wire body (the model is the hop's model for typesafe hops). */
  request: SystemOneRequest;
}

/** A question the planner refused before any call. */
export interface RejectedQuestion {
  key: string;
  reason: "state_plus_question_over_limit";
  message: string;
  tokens: { state: number; question: number };
}

/** The output of {@link planBundle}. */
export interface BundlePlan {
  bundleId: string;
  stateVersion: string;
  requests: PlannedRequest[];
  rejected: RejectedQuestion[];
}

export type PlanBundleResult =
  { ok: true; plan: BundlePlan } | { ok: false; issues: BundleIssue[] };

/** The packet as a plain JSON object (absent optional sections dropped) for the wire `state`. */
export function packetState(packet: StatePacket): JsonObject {
  const value = toJsonValue(packet);
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new TypeError("packet is not an object");
  return value;
}

function hopKey(hop: ProviderHop): string {
  switch (hop.provider) {
    case "typesafe":
      return `typesafe:${hop.model}`;
    case "llm":
      return `llm:${hop.model.provider}:${hop.model.model}`;
    case "custom":
      return `custom:${hop.id}:${hop.model ?? ""}`;
    case "rule":
    case "human":
      return hop.provider;
  }
}

function hopModel(hop: ProviderHop): string {
  switch (hop.provider) {
    case "typesafe":
      return hop.model;
    case "llm":
      return `${hop.model.provider}/${hop.model.model}`;
    case "custom":
      return hop.model ?? hop.id;
    case "rule":
    case "human":
      return hop.provider;
  }
}

/** A violation of the bundle's state boundary. */
export interface BundleIssue {
  kind: "duplicate_key" | "mixed_state_version" | "dependent_question" | "class_mix";
  question: string | null;
  message: string;
  /** The catalog diagnostic when one exists (`E_JEV_BUNDLE_CLASS_MIX`). */
  diagnostic: JevDiagnostic | null;
}

/**
 * State-boundary checks of a bundle (§VI.B–§VI.D, §8.3): unique keys, every packet built from
 * the bundle's snapshot (one bundle, one version of reality), no question consuming another's
 * answer, and — for an explicit bundle node — one privacy and latency class
 * (`E_JEV_BUNDLE_CLASS_MIX`: *"A sensitive approval judgment should not inherit a provider route
 * chosen for a low-cost internal classification"*).
 */
export function checkBundle(
  stateVersion: string,
  questions: readonly BundleQuestion[],
  options: { explicit?: boolean } = {},
): BundleIssue[] {
  const issues: BundleIssue[] = [];
  const keys = new Set<string>();
  for (const q of questions) {
    if (keys.has(q.key)) {
      issues.push({
        kind: "duplicate_key",
        question: q.key,
        message: `question key "${q.key}" appears twice in the bundle`,
        diagnostic: null,
      });
    }
    keys.add(q.key);
    if (q.packet.stateVersion !== stateVersion || q.packet.packet.stateVersion !== stateVersion) {
      issues.push({
        kind: "mixed_state_version",
        question: q.key,
        message: `question "${q.key}" was built from snapshot ${q.packet.stateVersion}, not the bundle's ${stateVersion}: one bundle describes one version of reality (§VI.C)`,
        diagnostic: null,
      });
    }
  }
  for (const q of questions) {
    for (const dep of q.dependsOn ?? []) {
      if (keys.has(dep)) {
        issues.push({
          kind: "dependent_question",
          question: q.key,
          message: `question "${q.key}" depends on "${dep}" in the same bundle; perform the evidence-creating step, update the state version, then ask again (§VI.B)`,
          diagnostic: null,
        });
      }
    }
  }
  if (options.explicit === true) {
    const privacy = new Set(questions.map((q) => q.privacyClass));
    const latency = new Set(questions.map((q) => q.latencyClass));
    if (privacy.size > 1 || latency.size > 1) {
      const message = `bundle mixes privacy classes [${[...privacy].join(", ")}] / latency classes [${[...latency].join(", ")}]; batch only within one class (§VI.D)`;
      issues.push({
        kind: "class_mix",
        question: null,
        message,
        diagnostic: jevDiagnostic("E_JEV_BUNDLE_CLASS_MIX", message),
      });
    }
  }
  return issues;
}

/**
 * Plans the TypeSafe requests of a bundle (§8.2): group by (packet, hop, credential, privacy
 * class, latency class); refuse a question whose packet + question exceeds 32k; split a group
 * whose packet + Σ questions exceeds 64k (largest questions first, first-fit, deterministic).
 */
export function planBundle(input: {
  bundleId: string;
  stateVersion: string;
  questions: readonly BundleQuestion[];
}): PlanBundleResult {
  const issues = checkBundle(input.stateVersion, input.questions);
  if (issues.length > 0) return { ok: false, issues };

  interface Group {
    first: BundleQuestion;
    members: { q: BundleQuestion; tokens: number }[];
    stateTokens: number;
  }
  const groups = new Map<string, Group>();
  const rejected: RejectedQuestion[] = [];
  for (const q of input.questions) {
    const canonical = q.packet.canonical ?? stableStringify(packetState(q.packet.packet));
    const st = estimateTokens(canonical);
    const qt = questionTokens(q.question);
    if (st + qt > TYPESAFE_LIMITS.maxStatePlusQuestionTokens) {
      rejected.push({
        key: q.key,
        reason: "state_plus_question_over_limit",
        message: `packet (${st}) + question (${qt}) exceed ${TYPESAFE_LIMITS.maxStatePlusQuestionTokens} tokens; chunk the evidence or narrow the menu`,
        tokens: { state: st, question: qt },
      });
      continue;
    }
    const groupKey = [
      q.packet.packetHash,
      hopKey(q.hop),
      q.credential ?? "",
      q.privacyClass,
      q.latencyClass,
    ].join("|");
    const group = groups.get(groupKey) ?? { first: q, members: [], stateTokens: st };
    group.members.push({ q, tokens: qt });
    groups.set(groupKey, group);
  }

  const requests: PlannedRequest[] = [];
  let n = 1;
  const orderedGroups = [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [, group] of orderedGroups) {
    const budget = TYPESAFE_LIMITS.maxRequestTokens - group.stateTokens;
    const sorted = [...group.members].sort((a, b) =>
      b.tokens === a.tokens ? (a.q.key < b.q.key ? -1 : 1) : b.tokens - a.tokens,
    );
    const bins: { members: typeof sorted; used: number }[] = [];
    for (const m of sorted) {
      const bin = bins.find((b) => b.used + m.tokens <= budget);
      if (bin) {
        bin.members.push(m);
        bin.used += m.tokens;
      } else {
        bins.push({ members: [m], used: m.tokens });
      }
    }
    for (const bin of bins) {
      const members = [...bin.members].sort((a, b) =>
        a.q.key < b.q.key ? -1 : a.q.key > b.q.key ? 1 : 0,
      );
      const questions: Record<string, SystemOneQuestion> = {};
      for (const m of members) questions[m.q.key] = m.q.question;
      const first = group.first;
      requests.push({
        batchId: `${input.bundleId}#${n}`,
        stateVersion: input.stateVersion,
        packetHash: first.packet.packetHash,
        hop: first.hop,
        credential: first.credential,
        privacyClass: first.privacyClass,
        latencyClass: first.latencyClass,
        questionKeys: members.map((m) => m.q.key),
        tokens: {
          state: group.stateTokens,
          questions: bin.used,
          total: group.stateTokens + bin.used,
        },
        request: { model: hopModel(first.hop), state: packetState(first.packet.packet), questions },
      });
      n += 1;
    }
  }
  return {
    ok: true,
    plan: { bundleId: input.bundleId, stateVersion: input.stateVersion, requests, rejected },
  };
}
