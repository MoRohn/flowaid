import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Badge } from "@/primitives/Badge";
import type { ConsequenceClass, JevContractRef, JevRoute, RolloutDisposition } from "./types";
import {
  CONSEQUENCE_LABEL,
  DISPOSITION_LABEL,
  ROUTE_LABEL,
  ROUTE_TONE,
  contractLabel,
  shortHash,
  type JevTone,
} from "./vocabulary";

export interface ConsequenceBadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  value: ConsequenceClass;
  /** Prefix the label with "consequence". */
  verbose?: boolean;
}

/**
 * Consequence class of the action a judgment may authorise: low ink, medium
 * warn, high danger-soft, irreversible solid danger (UI addendum §17).
 */
export const ConsequenceBadge = forwardRef<HTMLSpanElement, ConsequenceBadgeProps>(
  function ConsequenceBadge({ value, verbose = false, className, ...rest }, ref) {
    const label = `${verbose ? "Consequence " : ""}${CONSEQUENCE_LABEL[value].toLowerCase()}`;
    if (value === "irreversible")
      return (
        <Badge
          ref={ref}
          data-consequence={value}
          className={cn("bg-danger text-surface", className)}
          {...rest}
        >
          {label}
        </Badge>
      );
    return (
      <Badge
        ref={ref}
        data-consequence={value}
        tone={value === "low" ? "neutral" : value === "medium" ? "warn" : "danger"}
        className={className}
        {...rest}
      >
        {label}
      </Badge>
    );
  },
);

export interface RouteChipProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  route: JevRoute;
  disposition?: RolloutDisposition | null;
}

/** Route of a receipt in the gate tones (auto ok, improve info, human warn), with the rollout disposition when not active. */
export const RouteChip = forwardRef<HTMLSpanElement, RouteChipProps>(function RouteChip(
  { route, disposition, className, ...rest },
  ref,
) {
  return (
    <span
      ref={ref}
      className={cn("inline-flex items-center gap-1", className)}
      data-route={route}
      {...rest}
    >
      <Badge tone={ROUTE_TONE[route]} dot>
        {ROUTE_LABEL[route]}
      </Badge>
      {disposition && disposition !== "active" ? (
        <Badge tone="outline">{DISPOSITION_LABEL[disposition]}</Badge>
      ) : null}
    </span>
  );
});

export interface ContractRefChipProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  contract: Pick<JevContractRef, "key" | "version"> &
    Partial<Pick<JevContractRef, "hash" | "origin">>;
  /** Show the first hash characters after the label. */
  showHash?: boolean;
  trailing?: ReactNode;
}

/** `support.router@4` in mono, cobalt (the decision colour), optionally with its hash. */
export const ContractRefChip = forwardRef<HTMLSpanElement, ContractRefChipProps>(
  function ContractRefChip({ contract, showHash = false, trailing, className, ...rest }, ref) {
    return (
      <span
        ref={ref}
        className={cn(
          "inline-flex min-w-0 items-baseline gap-1.5 font-mono text-xs leading-none text-accent-text tabular",
          className,
        )}
        {...rest}
      >
        <span className="truncate">{contractLabel(contract)}</span>
        {contract.origin === "implicit" ? (
          <span className="text-2xs text-ink-3">implicit</span>
        ) : null}
        {showHash && contract.hash ? (
          <span className="text-2xs text-ink-4">#{shortHash(contract.hash)}</span>
        ) : null}
        {trailing}
      </span>
    );
  },
);

/** Small labelled number used across the group's panels. Internal. */
export function Stat({
  label,
  value,
  hint,
  tone,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: JevTone;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1 rounded-sm border border-border bg-surface-2 px-3 py-2",
        className,
      )}
      data-tone={tone}
    >
      <span className="truncate text-2xs font-medium text-ink-3">{label}</span>
      <span
        className={cn(
          "font-mono text-lg leading-none tabular",
          tone === "ok" && "text-ok",
          tone === "warn" && "text-warn",
          tone === "danger" && "text-danger",
          tone === "info" && "text-info",
          tone === "accent" && "text-accent-text",
          (!tone || tone === "neutral") && "text-ink",
        )}
      >
        {value}
      </span>
      {hint ? <span className="truncate font-mono text-2xs text-ink-4 tabular">{hint}</span> : null}
    </div>
  );
}

/** Eyebrow heading for a block inside a panel. Internal. */
export function BlockTitle({ children, meta }: { children: ReactNode; meta?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h4 className="m-0 text-eyebrow text-ink-3">{children}</h4>
      {meta ? <span className="font-mono text-2xs text-ink-4 tabular">{meta}</span> : null}
    </div>
  );
}
