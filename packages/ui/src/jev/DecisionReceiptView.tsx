import { forwardRef, useMemo, type HTMLAttributes, type ReactNode } from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatCost, formatMs, formatProbability } from "@/lib/format";
import { DistributionList } from "@/decision/DistributionList";
import { ProbabilityRuler } from "@/decision/ProbabilityRuler";
import { Badge } from "@/primitives/Badge";
import { BlockTitle, ConsequenceBadge, ContractRefChip, RouteChip } from "./badges";
import {
  RECEIPT_STAGE_LABEL,
  authorizedActionLabel,
  distributionMargin,
  receiptTimeline,
  type ReceiptTimelineStep,
} from "./receipt";
import type { JevReceipt, JevRoutingRecord, JevThresholdApplied } from "./types";
import { DISPOSITION_LABEL, ROUTE_REASON_LABEL, shortHash, toneVar } from "./vocabulary";

export interface DecisionReceiptViewProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  receipt: JevReceipt;
  /** Display labels for outcome keys (score receipts use their rubric automatically). */
  labels?: Record<string, string>;
  /** Rows of the distribution list before "+N more". */
  maxRows?: number;
}

function time(at: string | null): string {
  if (!at) return "";
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? at : d.toISOString().slice(11, 23);
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[112px_1fr] gap-2 text-xs">
      <dt className="text-ink-3">{label}</dt>
      <dd className="m-0 min-w-0 break-words font-mono text-ink tabular">{children}</dd>
    </div>
  );
}

/** The zones of the applied threshold with the routing confidence marked. */
function ThresholdStrip({ t }: { t: JevThresholdApplied }) {
  const auto = t.autoAt;
  const improve = t.improveAt;
  const zones: { from: number; to: number; color: string; soft: string; label: string }[] = [];
  if (t.consequenceClass === "irreversible" || (auto === null && improve === null)) {
    zones.push({ from: 0, to: 1, color: "var(--warn)", soft: "var(--warn-soft)", label: "human" });
  } else {
    const humanTo = improve ?? auto ?? 1;
    if (humanTo > 0)
      zones.push({
        from: 0,
        to: humanTo,
        color: "var(--warn)",
        soft: "var(--warn-soft)",
        label: "human",
      });
    if (improve !== null)
      zones.push({
        from: improve,
        to: auto ?? 1,
        color: "var(--info)",
        soft: "var(--info-soft)",
        label: "improve",
      });
    if (auto !== null)
      zones.push({ from: auto, to: 1, color: "var(--ok)", soft: "var(--ok-soft)", label: "auto" });
  }
  const c = t.confidence;
  return (
    <div className="flex flex-col gap-1">
      <div
        className="relative flex h-3 w-full overflow-visible rounded-[2px]"
        role="img"
        aria-label={`Zones: ${zones.map((z) => `${z.label} ${formatProbability(z.from)}–${formatProbability(z.to)}`).join(", ")}${c !== null ? `; confidence ${formatProbability(c)}` : ""}`}
      >
        {zones.map((z) => (
          <span
            key={z.label}
            className="block h-full first:rounded-l-[2px] last:rounded-r-[2px]"
            style={{
              width: `${(z.to - z.from) * 100}%`,
              backgroundColor: z.soft,
              borderTop: `2px solid ${z.color}`,
            }}
          />
        ))}
        {c !== null ? (
          <span
            aria-hidden="true"
            className="absolute -top-1 h-5 w-0.5 rounded-full bg-ink"
            style={{ left: `calc(${Math.min(1, Math.max(0, c)) * 100}% - 1px)` }}
          />
        ) : null}
      </div>
      <div className="flex justify-between font-mono text-2xs text-ink-4 tabular">
        <span>0</span>
        <span>
          {improve !== null ? `improve ${formatProbability(improve)}` : ""}
          {improve !== null && auto !== null ? " · " : ""}
          {auto !== null ? `auto ${formatProbability(auto)}` : ""}
        </span>
        <span>1</span>
      </div>
    </div>
  );
}

function RoutingDetail({ r }: { r: JevRoutingRecord }) {
  const t = r.threshold;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <RouteChip route={r.route} disposition={r.disposition} />
        <ConsequenceBadge value={r.consequenceClass} verbose />
        {t.illustrative ? <Badge tone="warn">illustrative thresholds</Badge> : null}
        <span className="ml-auto font-mono text-2xs text-ink-4">{r.routedBy.nodeId}</span>
      </div>
      <ThresholdStrip t={t} />
      <dl className="m-0 flex flex-col gap-1">
        <Row label="Thresholds">
          {t.consequenceClass} · auto{" "}
          {t.autoAt === null ? "never" : `≥ ${formatProbability(t.autoAt)}`} · improve{" "}
          {t.improveAt === null ? "none" : `≥ ${formatProbability(t.improveAt)}`}
          {t.minMargin !== null ? ` · margin ≥ ${formatProbability(t.minMargin)}` : ""}
        </Row>
        <Row label="Applied to">
          confidence {t.confidence === null ? "—" : formatProbability(t.confidence)}
          {t.margin !== null ? ` · margin ${formatProbability(t.margin)}` : ""}
        </Row>
        <Row label="Source">{t.source}</Row>
        <Row label="Disposition">{DISPOSITION_LABEL[r.disposition]}</Row>
      </dl>
      <ul className="m-0 flex list-none flex-wrap gap-1 p-0" aria-label="Route reasons">
        {r.reasons.map((reason) => (
          <li key={reason}>
            <Badge tone="outline">
              <span className="font-mono text-ink-3">{reason}</span> {ROUTE_REASON_LABEL[reason]}
            </Badge>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-1 rounded-sm border border-border bg-surface-2 px-2.5 py-2">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-ink-3">Policy</span>
          <span className="font-mono text-ink">{r.policy.id}</span>
          <Badge
            tone={
              r.policy.verdict === "allow"
                ? "ok"
                : r.policy.verdict === "review"
                  ? "warn"
                  : "danger"
            }
          >
            {r.policy.verdict}
          </Badge>
          {r.policy.proofId ? (
            <span className="ml-auto font-mono text-2xs text-ink-4">
              proof #{shortHash(r.policy.proofId)}
            </span>
          ) : null}
        </div>
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0" aria-label="Policy checks">
          {r.policy.checks.map((c) => (
            <li key={c.name} className="flex items-start gap-1.5 text-xs">
              {c.ok ? (
                <Check className="mt-0.5 size-3 shrink-0 text-ok" aria-label="passed" />
              ) : (
                <X className="mt-0.5 size-3 shrink-0 text-danger" aria-label="failed" />
              )}
              <span className="font-mono text-ink-2">{c.name}</span>
              {c.detail ? <span className="text-ink-3">{c.detail}</span> : null}
            </li>
          ))}
        </ul>
        <p className="m-0 text-xs text-ink">
          <span className="text-ink-3">Authorised:</span>{" "}
          {authorizedActionLabel(r.authorizedAction)}
        </p>
      </div>
    </div>
  );
}

/**
 * One decision receipt as a timeline of the safe operating order — judge,
 * policy, execute, record (JEV_ENGINEERING.md §12, Table III): the contract
 * version, the state snapshot and evidence scope, the full distribution, each
 * routing with the thresholds applied and the policy verdict, the executed
 * action and any override. Never winner-only.
 */
export const DecisionReceiptView = forwardRef<HTMLDivElement, DecisionReceiptViewProps>(
  function DecisionReceiptView({ receipt, labels, maxRows = 6, className, ...rest }, ref) {
    const steps = useMemo(() => receiptTimeline(receipt), [receipt]);
    const outcomeLabels = useMemo(() => {
      if (labels) return labels;
      if (receipt.rubric)
        return Object.fromEntries(receipt.rubric.map((text, i) => [String(i), text]));
      return undefined;
    }, [labels, receipt.rubric]);
    const hasDistribution = Object.keys(receipt.distribution).length > 0;
    const first = receipt.routings[0];

    const detail = (s: ReceiptTimelineStep): ReactNode => {
      switch (s.kind) {
        case "contract":
          return (
            <dl className="m-0 flex flex-col gap-1">
              <Row label="Contract">
                <ContractRefChip contract={receipt.contract} showHash />
              </Row>
              <Row label="Model">
                {receipt.model.provider}:{receipt.model.requested} →{" "}
                {receipt.model.resolved ?? "unresolved"}
              </Row>
              <Row label="Bundle">
                {receipt.bundleId}
                {receipt.batchId ? ` · ${receipt.batchId}` : " · no request"}
              </Row>
            </dl>
          );
        case "snapshot":
          return (
            <dl className="m-0 flex flex-col gap-1">
              <Row label="State version">{receipt.stateReference.stateVersion}</Row>
              <Row label="Packet">
                #{shortHash(receipt.stateReference.packetHash, 12)} ·{" "}
                {receipt.stateReference.fidelity.replace("_", " ")}
              </Row>
              <Row label="Evidence scope">
                {receipt.evidenceScope.fields.join(", ")}
                {receipt.evidenceScope.evidenceIds.length > 0
                  ? ` · ${receipt.evidenceScope.evidenceIds.join(", ")}`
                  : ""}
              </Row>
              {receipt.optionSet ? (
                <Row label="Option set">
                  {receipt.optionSet.source} · {receipt.optionSet.size} options · #
                  {shortHash(receipt.optionSet.version)}
                  {receipt.optionSet.ageMs !== null
                    ? ` · ${formatMs(receipt.optionSet.ageMs)} old`
                    : ""}
                  {receipt.optionSet.escapeKeys.length > 0
                    ? ` · escapes ${receipt.optionSet.escapeKeys.join(", ")}`
                    : ""}
                </Row>
              ) : null}
              {receipt.staleness.staleEvidence.length > 0 || receipt.staleness.raceRecorded ? (
                <Row label="Staleness">
                  <span className="text-warn">
                    {receipt.staleness.staleEvidence.length > 0
                      ? `stale ${receipt.staleness.staleEvidence.join(", ")}`
                      : ""}
                    {receipt.staleness.raceRecorded ? " · state race recorded" : ""}
                  </span>
                </Row>
              ) : null}
            </dl>
          );
        case "judgment":
          return (
            <div className="flex flex-col gap-2.5">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-xs tabular">
                <span className="text-ink">
                  {receipt.outcome !== null
                    ? (outcomeLabels?.[receipt.outcome] ?? receipt.outcome)
                    : "no outcome"}
                </span>
                {receipt.escape ? <Badge tone="outline">escape {receipt.escape}</Badge> : null}
                <span className="text-ink-3">
                  confidence{" "}
                  {receipt.confidence === null ? "—" : formatProbability(receipt.confidence)}
                </span>
                {hasDistribution ? (
                  <span className="text-ink-3">
                    margin {formatProbability(distributionMargin(receipt.distribution))}
                  </span>
                ) : null}
                <span className="ml-auto text-2xs text-ink-4">
                  {formatMs(receipt.latencyMs)} · {formatCost(receipt.costUsd)}
                </span>
              </div>
              {hasDistribution ? (
                <>
                  <ProbabilityRuler
                    distribution={receipt.distribution}
                    chosen={receipt.outcome ?? undefined}
                    labels={outcomeLabels}
                    sort={receipt.kind !== "score"}
                    showLabels
                  />
                  <DistributionList
                    distribution={receipt.distribution}
                    chosen={receipt.outcome ?? undefined}
                    labels={outcomeLabels}
                    maxRows={maxRows}
                    density="compact"
                    showKeys
                  />
                </>
              ) : (
                <p className="m-0 text-xs text-ink-3">
                  No distribution:{" "}
                  {receipt.batchId
                    ? "fallback outcome"
                    : "held back before evaluation (no provider call)"}
                  .
                </p>
              )}
              {receipt.bandMass ? (
                <p className="m-0 font-mono text-2xs text-ink-3 tabular">
                  band mass{" "}
                  {Object.entries(receipt.bandMass)
                    .map(([b, m]) => `${b} ${formatProbability(m)}`)
                    .join(" · ")}
                </p>
              ) : null}
              {receipt.reused ? (
                <p className="m-0 text-xs text-warn">
                  Reused an earlier distribution: the blind-retry guard made no provider call.
                </p>
              ) : null}
            </div>
          );
        case "routing": {
          const r = s.index !== undefined ? receipt.routings[s.index] : undefined;
          return r ? <RoutingDetail r={r} /> : null;
        }
        case "action": {
          const a = receipt.executedAction ?? null;
          if (!a)
            return (
              <p className="m-0 text-xs text-ink-3">
                {receipt.routings.length === 0
                  ? "Routing is external; the receipt waits for a route node."
                  : "No executed action recorded yet."}
              </p>
            );
          return (
            <dl className="m-0 flex flex-col gap-1">
              <Row label="Kind">
                {a.kind.replace("_", " ")} · {a.nodeId ?? a.toolCallId ?? a.humanTaskId ?? "—"}
              </Row>
              <Row label="Status">
                <span
                  className={
                    a.status === "completed"
                      ? "text-ok"
                      : a.status === "failed"
                        ? "text-danger"
                        : "text-ink-3"
                  }
                >
                  {a.status}
                  {a.failure ? ` (${a.failure.replace("_", " ")})` : ""}
                </span>
              </Row>
            </dl>
          );
        }
        case "override": {
          const o = s.index !== undefined ? receipt.overrides?.[s.index] : undefined;
          if (!o) return null;
          return (
            <dl className="m-0 flex flex-col gap-1">
              <Row label="Changed">
                {o.from ?? "—"} → <span className="text-warn">{o.to}</span>
                {o.route ? ` · route ${o.route}` : ""}
              </Row>
              <Row label="By">
                {o.by} via {o.source.replace("_", " ")}
              </Row>
              {o.reason ? <Row label="Reason">{o.reason}</Row> : null}
            </dl>
          );
        }
      }
    };

    return (
      <div ref={ref} className={cn("flex min-w-0 flex-col gap-4", className)} {...rest}>
        <header className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="m-0 font-mono text-sm font-semibold text-ink">{receipt.question}</h3>
            <ContractRefChip contract={receipt.contract} />
            {receipt.mode !== "live" ? <Badge tone="accent">{receipt.mode}</Badge> : null}
            {first ? (
              <RouteChip route={first.route} disposition={first.disposition} className="ml-auto" />
            ) : null}
          </div>
          <p className="m-0 font-mono text-2xs text-ink-4 tabular">
            receipt {receipt.receiptId.slice(0, 8)} · run {receipt.runId.slice(0, 8)} ·{" "}
            {receipt.nodeId} · {receipt.at}
          </p>
        </header>

        <ol className="m-0 flex list-none flex-col p-0" aria-label="Receipt timeline">
          {steps.map((s, i) => {
            const prevStage = i > 0 ? steps[i - 1]?.stage : undefined;
            return (
              <li key={s.id} data-step={s.kind} className="grid grid-cols-[64px_16px_1fr] gap-x-2">
                <span className="pt-0.5 text-right text-eyebrow text-ink-4">
                  {s.stage !== prevStage ? RECEIPT_STAGE_LABEL[s.stage] : ""}
                </span>
                <span className="relative flex justify-center" aria-hidden="true">
                  <span className="absolute inset-y-0 w-px bg-border" />
                  <span
                    className="relative mt-1 size-2.5 rounded-full border-2 border-surface"
                    style={{
                      backgroundColor: toneVar(s.tone),
                      boxShadow: `0 0 0 1px ${toneVar(s.tone)}`,
                    }}
                  />
                </span>
                <div className="flex min-w-0 flex-col gap-2 pb-4">
                  <BlockTitle meta={time(s.at)}>{s.title}</BlockTitle>
                  {detail(s)}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    );
  },
);
