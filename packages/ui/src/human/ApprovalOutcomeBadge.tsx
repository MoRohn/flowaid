import { forwardRef, type ComponentType } from "react";
import { ArrowUpRight, Ban, Check, Pencil, TimerOff, X } from "lucide-react";
import { Badge, type BadgeProps } from "@/primitives";
import type { HumanResponse } from "@/types";
import { assertNever } from "@/types";

export type ApprovalOutcome =
  | "approved"
  | "rejected"
  | "edited"
  | "escalated"
  | "expired"
  /** closed unanswered because its run ended (cancelled, timed out or failed) */
  | "cancelled";

interface OutcomeSpec {
  label: string;
  tone: NonNullable<BadgeProps["tone"]>;
  icon: ComponentType<{
    className?: string;
    strokeWidth?: number;
    "aria-hidden"?: boolean | "true";
  }>;
}

const SPEC: Record<ApprovalOutcome, OutcomeSpec> = {
  approved: { label: "Approved", tone: "ok", icon: Check },
  rejected: { label: "Rejected", tone: "danger", icon: X },
  edited: { label: "Approved with edits", tone: "accent", icon: Pencil },
  escalated: { label: "Escalated", tone: "warn", icon: ArrowUpRight },
  expired: { label: "Expired", tone: "neutral", icon: TimerOff },
  cancelled: { label: "Cancelled", tone: "neutral", icon: Ban },
};

/** Human label for an outcome. */
export function approvalOutcomeLabel(outcome: ApprovalOutcome): string {
  return SPEC[outcome].label;
}

/**
 * Maps a submitted `HumanResponse` to its outcome. A `choose` or `submit`
 * answer completes the review, so it reads as approved; an `approve` that
 * carries an edited `value` (review mode) is "approved with edits".
 */
export function approvalOutcomeFor(response: HumanResponse): ApprovalOutcome {
  switch (response.action) {
    case "reject":
      return "rejected";
    case "escalate":
      return "escalated";
    case "approve":
      return response.value === undefined ? "approved" : "edited";
    case "choose":
    case "submit":
      return "approved";
    default:
      return assertNever(response, "human response");
  }
}

export interface ApprovalOutcomeBadgeProps extends Omit<
  BadgeProps,
  "tone" | "category" | "children"
> {
  outcome: ApprovalOutcome;
  /** Override the label (e.g. "Approved · refund"). */
  label?: string;
  /** Hide the leading icon. */
  noIcon?: boolean;
}

/** Status badge for a finished review: approved, rejected, edited, escalated, expired or cancelled. */
export const ApprovalOutcomeBadge = forwardRef<HTMLSpanElement, ApprovalOutcomeBadgeProps>(
  function ApprovalOutcomeBadge({ outcome, label, noIcon = false, ...rest }, ref) {
    const spec = SPEC[outcome];
    const Icon = spec.icon;
    return (
      <Badge
        ref={ref}
        tone={spec.tone}
        data-outcome={outcome}
        icon={noIcon ? undefined : <Icon strokeWidth={2.25} aria-hidden="true" />}
        {...rest}
      >
        {label ?? spec.label}
      </Badge>
    );
  },
);
