"use client";
/**
 * Checklists built from real application state: what a page needs before it is useful
 * (`Requirement`) and whether a draft is ready to save (`Check`). Neither is ever ticked by a
 * click; the caller computes each state from the data it already loaded.
 */
import type { ReactNode } from "react";
import {
  AlertTriangle,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Info,
  type LucideIcon,
} from "lucide-react";
import { Spinner } from "@flowaid/ui/primitives";

export type CheckState = "ok" | "blocker" | "warning" | "info" | "optional" | "checking";

export interface Check {
  id: string;
  label: ReactNode;
  state: CheckState;
  /** what it means, and how to fix it when it is not ok */
  detail?: ReactNode;
  /** a link or button that fixes it */
  fix?: ReactNode;
}

const ICON: Record<
  Exclude<CheckState, "checking">,
  { icon: LucideIcon; cls: string; sr: string }
> = {
  ok: { icon: CircleCheck, cls: "text-ok-text", sr: "Ready" },
  blocker: { icon: CircleAlert, cls: "text-danger-text", sr: "Needed" },
  warning: { icon: AlertTriangle, cls: "text-warn-text", sr: "Check" },
  info: { icon: Info, cls: "text-info-text", sr: "Note" },
  optional: { icon: CircleDashed, cls: "text-ink-3", sr: "Optional" },
};

export function CheckList({
  checks,
  className,
  "aria-label": label,
}: {
  checks: readonly Check[];
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <ul className={`m-0 flex list-none flex-col gap-2 p-0 ${className ?? ""}`} aria-label={label}>
      {checks.map((c) => {
        const meta = c.state === "checking" ? null : ICON[c.state];
        const Icon = meta?.icon;
        return (
          <li key={c.id} className="flex gap-2 text-sm leading-snug">
            <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
              {Icon && meta ? (
                <Icon className={`size-4 ${meta.cls}`} strokeWidth={1.75} aria-hidden />
              ) : (
                <Spinner size="xs" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="sr-only">{meta ? `${meta.sr}: ` : "Checking: "}</span>
              <span className="text-ink">{c.label}</span>
              {c.detail ? <span className="block text-xs text-ink-3">{c.detail}</span> : null}
              {c.fix && c.state !== "ok" ? (
                <span className="mt-0.5 block text-xs">{c.fix}</span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Blockers stop saving; warnings and notes do not. */
export function blockers(checks: readonly Check[]): Check[] {
  return checks.filter((c) => c.state === "blocker");
}

/**
 * Said wherever a draft passes its checks: valid settings save and run, but whether an AI
 * step answers well is only shown by trying it on real examples.
 */
export function QualityNote({ children }: { children?: ReactNode }) {
  return (
    <p className="m-0 flex gap-2 rounded-sm border border-border bg-surface-2 px-2.5 py-2 text-xs leading-snug text-ink-2">
      <Info className="mt-px size-3.5 shrink-0 text-info-text" strokeWidth={1.75} aria-hidden />
      <span>
        {children ??
          "These checks confirm the settings are complete and valid. They cannot tell you whether the results will be good: try it on a few real examples and look at what comes back."}
      </span>
    </p>
  );
}
