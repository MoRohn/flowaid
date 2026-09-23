/**
 * Receipt helpers (JEV_ENGINEERING.md §12): the safe operating order —
 * judge → policy → execute → record — as a timeline, the top-two margin of
 * a distribution and plain-language labels for authorised actions.
 */
import type { JevAuthorizedAction, JevReceipt } from "./types";
import { ROUTE_TONE, type JevTone } from "./vocabulary";

/** §1.2: "Jev judges; code checks policy; the tool executes; the trace records." */
export type ReceiptStage = "judge" | "policy" | "execute" | "record";

export const RECEIPT_STAGE_LABEL: Record<ReceiptStage, string> = {
  judge: "Judge",
  policy: "Policy",
  execute: "Execute",
  record: "Record",
};

export type ReceiptStepKind =
  "contract" | "snapshot" | "judgment" | "routing" | "action" | "override";

export interface ReceiptTimelineStep {
  id: string;
  kind: ReceiptStepKind;
  stage: ReceiptStage;
  title: string;
  at: string | null;
  tone: JevTone;
  /** Index into `receipt.routings` / `receipt.overrides` for those kinds. */
  index?: number;
}

/** The receipt as an ordered timeline. A missing executed action is shown as pending, never omitted. */
export function receiptTimeline(receipt: JevReceipt): ReceiptTimelineStep[] {
  const steps: ReceiptTimelineStep[] = [
    {
      id: "contract",
      kind: "contract",
      stage: "judge",
      title: "Contract",
      at: null,
      tone: "accent",
    },
    {
      id: "snapshot",
      kind: "snapshot",
      stage: "judge",
      title: "State snapshot",
      at: null,
      tone: "neutral",
    },
    {
      id: "judgment",
      kind: "judgment",
      stage: "judge",
      title: receipt.reused ? "Judgment (reused)" : "Judgment",
      at: receipt.at,
      tone: "accent",
    },
  ];
  receipt.routings.forEach((r, i) => {
    steps.push({
      id: `routing-${i}`,
      kind: "routing",
      stage: "policy",
      title:
        receipt.routings.length > 1
          ? `Routing ${i + 1} · ${r.routedBy.nodeId}`
          : "Routing and policy",
      at: r.at,
      tone: r.policy.verdict === "deny" ? "danger" : ROUTE_TONE[r.route],
      index: i,
    });
  });
  const executed = receipt.executedAction ?? null;
  steps.push({
    id: "action",
    kind: "action",
    stage: "execute",
    title: executed
      ? "Action executed"
      : receipt.routings.length === 0
        ? "Not routed yet"
        : "Action pending",
    at: executed?.at ?? null,
    tone: executed
      ? executed.status === "completed"
        ? "ok"
        : executed.status === "failed"
          ? "danger"
          : "neutral"
      : "neutral",
  });
  (receipt.overrides ?? []).forEach((o, i) => {
    steps.push({
      id: `override-${i}`,
      kind: "override",
      stage: "record",
      title: "Override",
      at: o.at,
      tone: "warn",
      index: i,
    });
  });
  return steps;
}

/** p(1) − p(2) of a distribution (0 for fewer than two entries). */
export function distributionMargin(distribution: Record<string, number>): number {
  const ps = Object.values(distribution)
    .filter((p) => Number.isFinite(p))
    .sort((a, b) => b - a);
  const first = ps[0] ?? 0;
  const second = ps[1] ?? 0;
  return ps.length < 2 ? 0 : Math.max(0, first - second);
}

export function authorizedActionLabel(a: JevAuthorizedAction): string {
  switch (a.kind) {
    case "fire_port":
      return `Fire port ${a.port}`;
    case "tool_call":
      return `Call tool ${a.tool}`;
    case "human_review":
      return a.inline
        ? "Human review (inline)"
        : a.port
          ? `Human review via ${a.port}`
          : "Human review";
    case "improve":
      return `Improve via ${a.port}`;
    case "legacy":
      return `Legacy path ${a.port}`;
    case "none":
      return a.reason === "shadow"
        ? "No action (shadow)"
        : a.reason === "denied"
          ? "No action (denied)"
          : "No action (external routing)";
  }
}
