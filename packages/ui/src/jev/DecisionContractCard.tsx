import { forwardRef, useMemo, type HTMLAttributes, type ReactNode } from "react";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatCompactNumber, formatPercent, formatProbability } from "@/lib/format";
import { Badge } from "@/primitives/Badge";
import { Card, CardBody, CardHeader } from "@/primitives/Card";
import { BlockTitle, ConsequenceBadge, ContractRefChip } from "./badges";
import { contractOutcomes, validateContract, type ContractIssue } from "./contract";
import { eceTone } from "./calibration";
import { effectiveZones } from "./routing";
import type { ContractVersionStatus, JevContractBody, JevDeploymentChip, JevRoute } from "./types";
import {
  CONFIGURABLE_CONSEQUENCES,
  ROUTE_LABEL,
  ROUTE_ORDER,
  ROUTE_TONE,
  toneVar,
} from "./vocabulary";

export interface DecisionContractStats {
  /** Decisions in the last 7 days. */
  volume7d: number;
  routeShare: Record<JevRoute, number>;
  ece: number | null;
  openAlarms: number;
}

export interface DecisionContractCardProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children"
> {
  contract: JevContractBody;
  status?: ContractVersionStatus;
  /** Canonical body hash (shown shortened). */
  hash?: string;
  deployments?: JevDeploymentChip[];
  stats?: DecisionContractStats;
  /** Diagnostics to count; computed with `validateContract` when omitted. */
  issues?: ContractIssue[];
  /** Makes the card clickable (opens the contract). */
  onOpen?: () => void;
  footer?: ReactNode;
}

const STATUS_TONE: Record<ContractVersionStatus, "ok" | "warn" | "danger" | "neutral"> = {
  approved: "ok",
  in_review: "warn",
  rejected: "danger",
  deprecated: "neutral",
};

const STATUS_LABEL: Record<ContractVersionStatus, string> = {
  approved: "Approved",
  in_review: "In review",
  rejected: "Rejected",
  deprecated: "Deprecated",
};

function thresholdText(autoAt: number | null, improveAt: number | null): string {
  if (autoAt === null && improveAt === null) return "human";
  const parts: string[] = [];
  if (autoAt !== null) parts.push(`auto ≥ ${formatProbability(autoAt)}`);
  if (improveAt !== null) parts.push(`improve ≥ ${formatProbability(improveAt)}`);
  return parts.join(" · ");
}

/**
 * Summary of one decision contract version (JEV_ENGINEERING.md §4, UI
 * addendum §17): identity, question shape, outcomes with escape hatches,
 * consequence and authority, zones per class, deployments per environment,
 * and — when stats are passed — 7-day volume, route mix, ECE and alarms.
 */
export const DecisionContractCard = forwardRef<HTMLDivElement, DecisionContractCardProps>(
  function DecisionContractCard(
    { contract, status, hash, deployments, stats, issues, onOpen, footer, className, ...rest },
    ref,
  ) {
    const computed = useMemo(() => issues ?? validateContract(contract), [issues, contract]);
    const errors = computed.filter((i) => i.severity === "error").length;
    const warnings = computed.length - errors;
    const q = contract.question;
    const outcomes = Object.entries(contractOutcomes(q));
    const governed = Boolean(contract.routing.governance?.approvedBy);

    return (
      <Card
        ref={ref}
        interactive={Boolean(onOpen)}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (onOpen && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            onOpen();
          }
        }}
        tabIndex={onOpen ? 0 : undefined}
        role={onOpen ? "button" : undefined}
        aria-label={onOpen ? `Open ${contract.title}` : undefined}
        className={cn("min-w-0", className)}
        {...rest}
      >
        <CardHeader>
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex min-w-0 items-center gap-2">
              <h3 className="m-0 truncate text-sm font-semibold tracking-tight text-ink">
                {contract.title}
              </h3>
              {status ? <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge> : null}
            </div>
            <ContractRefChip
              contract={{ key: contract.key, version: contract.version, hash }}
              showHash={Boolean(hash)}
            />
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <ConsequenceBadge value={contract.routing.consequenceClass} />
            <span className="text-2xs text-ink-3">{contract.owner}</span>
          </div>
        </CardHeader>
        <CardBody className="flex flex-col gap-4">
          <p className="m-0 line-clamp-2 text-xs text-ink-2">{contract.purpose}</p>

          <div className="flex flex-col gap-2">
            <BlockTitle
              meta={
                q.kind === "choice"
                  ? q.menu.source === "static"
                    ? `choice · ${outcomes.length} outcomes`
                    : `choice · live ≤ ${q.menu.maxOptions}`
                  : q.kind === "score"
                    ? `score · ${q.levels.length} levels`
                    : `noul · yes at ${formatProbability(q.yesAt)}`
              }
            >
              Question
            </BlockTitle>
            <p className="m-0 line-clamp-3 text-xs text-ink">{q.instructions}</p>
            {q.kind === "choice" ? (
              <ul className="m-0 flex list-none flex-wrap gap-1 p-0" aria-label="Outcomes">
                {q.menu.source === "dynamic" ? (
                  <li>
                    <Badge tone="accent" mono>
                      live options
                    </Badge>
                  </li>
                ) : null}
                {outcomes.map(([key, spec]) => (
                  <li key={key}>
                    <Badge tone={spec.escape ? "outline" : "neutral"} mono>
                      {key}
                      {spec.escape ? <span className="text-ink-4">escape</span> : null}
                      {spec.consequenceClass &&
                      spec.consequenceClass !== contract.routing.consequenceClass ? (
                        <span className="text-warn">{spec.consequenceClass}</span>
                      ) : null}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : q.kind === "score" ? (
              <ol className="m-0 flex list-none flex-wrap gap-1 p-0" aria-label="Levels">
                {q.levels.map((l, i) => (
                  <li key={i}>
                    <Badge tone="neutral">
                      <span className="font-mono text-ink-4">{i}</span> {l}
                    </Badge>
                  </li>
                ))}
              </ol>
            ) : null}
          </div>

          <div className="@container">
            <div className="grid gap-3 @md:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <BlockTitle meta={governed ? "governed" : "illustrative"}>Zones</BlockTitle>
                <dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 font-mono text-2xs tabular">
                  {CONFIGURABLE_CONSEQUENCES.map((cc) => {
                    const z = effectiveZones(contract.routing, cc);
                    return (
                      <div key={cc} className="contents">
                        <dt className="text-ink-3">{cc}</dt>
                        <dd className={cn("m-0", z.illustrative ? "text-ink-4" : "text-ink")}>
                          {z.zones ? thresholdText(z.zones.autoAt, z.zones.improveAt) : "human"}
                          {z.illustrative ? " (illustrative)" : ""}
                        </dd>
                      </div>
                    );
                  })}
                  <dt className="text-ink-3">irreversible</dt>
                  <dd className="m-0 text-ink">human</dd>
                </dl>
              </div>
              <div className="flex flex-col gap-1.5">
                <BlockTitle>Authority</BlockTitle>
                <div className="flex flex-wrap items-center gap-1">
                  {contract.allowedAction.kinds.map((k) => (
                    <Badge key={k} tone="outline" mono>
                      {k}
                    </Badge>
                  ))}
                </div>
                <p className="m-0 text-2xs text-ink-3">
                  ceiling {contract.allowedAction.maxConsequence}
                  {contract.allowedAction.externalSideEffects
                    ? " · external side effects"
                    : " · no external side effects"}
                  {contract.fallbackOutcome
                    ? ` · fallback ${contract.fallbackOutcome}`
                    : " · fallback human"}
                </p>
              </div>
            </div>
          </div>

          {deployments && deployments.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <BlockTitle>Deployments</BlockTitle>
              <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                {deployments.map((d) => (
                  <li
                    key={d.environment}
                    className="flex items-center gap-1.5 rounded-xs border border-border px-1.5 py-0.5 font-mono text-2xs tabular"
                  >
                    <span className="text-ink-2">{d.environment}</span>
                    {d.protected ? (
                      <ShieldCheck aria-label="protected" className="size-3 text-ink-3" />
                    ) : null}
                    <span className="text-ink">
                      {d.active ? `v${d.active.version}·${d.active.stage}` : "—"}
                    </span>
                    {d.candidate ? (
                      <span className="text-accent-text">
                        v{d.candidate.version}·{d.candidate.stage}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {stats ? (
            <div className="flex flex-col gap-1.5">
              <BlockTitle meta={`${formatCompactNumber(stats.volume7d)} decisions · 7d`}>
                Route mix
              </BlockTitle>
              <div
                className="flex h-2 w-full gap-[2px] overflow-hidden rounded-[2px]"
                role="img"
                aria-label={ROUTE_ORDER.map(
                  (r) => `${ROUTE_LABEL[r]} ${formatPercent(stats.routeShare[r])}`,
                ).join(", ")}
              >
                {ROUTE_ORDER.map((r) => (
                  <span
                    key={r}
                    className="block h-full"
                    style={{
                      flexGrow: Math.max(stats.routeShare[r], 0.001),
                      backgroundColor: toneVar(ROUTE_TONE[r]),
                    }}
                  />
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-2xs text-ink-3 tabular">
                {ROUTE_ORDER.map((r) => (
                  <span key={r}>
                    {r} {formatPercent(stats.routeShare[r])}
                  </span>
                ))}
                <span className="ml-auto flex items-center gap-2">
                  <Badge tone={eceTone(stats.ece)} mono>
                    ECE {stats.ece === null ? "—" : formatProbability(stats.ece, 3)}
                  </Badge>
                  {stats.openAlarms > 0 ? (
                    <Badge tone="warn" icon={<AlertTriangle />}>
                      {stats.openAlarms} alarm{stats.openAlarms === 1 ? "" : "s"}
                    </Badge>
                  ) : null}
                </span>
              </div>
            </div>
          ) : null}

          <div
            className="flex items-center gap-2 text-2xs text-ink-3"
            data-errors={errors}
            data-warnings={warnings}
          >
            {errors === 0 && warnings === 0 ? (
              <span className="text-ok">Lint clean</span>
            ) : (
              <>
                {errors > 0 ? (
                  <span className="text-danger">
                    {errors} error{errors === 1 ? "" : "s"}
                  </span>
                ) : null}
                {warnings > 0 ? (
                  <span className="text-warn">
                    {warnings} warning{warnings === 1 ? "" : "s"}
                  </span>
                ) : null}
              </>
            )}
            {footer ? <span className="ml-auto">{footer}</span> : null}
          </div>
        </CardBody>
      </Card>
    );
  },
);
