import { forwardRef, useMemo, type HTMLAttributes, type ReactNode } from "react";
import { Clock, EyeOff, Link2, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatMs, formatPercent, formatTokens } from "@/lib/format";
import { Badge } from "@/primitives/Badge";
import { BlockTitle } from "./badges";
import {
  PACKET_SECTION_LABEL,
  PACKET_SECTION_PURPOSE,
  ROLE_SECTION,
  estimatePacketTokens,
  evidenceAgeMs,
  packetSections,
  tokenBudget,
  type PacketSectionKey,
} from "./packet";
import type { JevDataClass, JevPacketReport, JevStatePacket, JevStateSpec } from "./types";
import { JEV_LIMITS, dataClassRank, shortHash } from "./vocabulary";

// ---------------------------------------------------------------------------
// Token budget meter
// ---------------------------------------------------------------------------

export interface TokenBudgetMeterProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  tokens: number;
  maxTokens: number;
}

const BUDGET_TONE = {
  ok: "var(--ok)",
  near: "var(--warn)",
  over: "var(--danger)",
  limit: "var(--danger)",
} as const;

/**
 * Estimated packet tokens (chars / 3.5) against the contract's `maxTokens`
 * and TypeSafe's 32k state + question limit. Over budget the builder fails
 * with `packet_over_budget` — it never truncates silently.
 */
export const TokenBudgetMeter = forwardRef<HTMLDivElement, TokenBudgetMeterProps>(
  function TokenBudgetMeter({ tokens, maxTokens, className, ...rest }, ref) {
    const b = tokenBudget(tokens, maxTokens);
    const scale = Math.max(b.maxTokens, b.tokens) * 1.08;
    const label =
      b.status === "limit"
        ? "exceeds the 32k state + question limit"
        : b.status === "over"
          ? "over budget: packet_over_budget"
          : b.status === "near"
            ? "near budget"
            : "within budget";
    return (
      <div
        ref={ref}
        className={cn("flex min-w-0 flex-col gap-1.5", className)}
        data-status={b.status}
        {...rest}
      >
        <div className="flex items-baseline justify-between gap-3 font-mono text-2xs tabular">
          <span className="text-ink">
            {b.tokens.toLocaleString("en")} / {b.maxTokens.toLocaleString("en")} tok
            <span className="text-ink-3"> · {formatPercent(b.fraction)}</span>
          </span>
          <span style={{ color: BUDGET_TONE[b.status] }}>{label}</span>
        </div>
        <div
          role="meter"
          aria-label="Packet token budget"
          aria-valuemin={0}
          aria-valuemax={b.maxTokens}
          aria-valuenow={b.tokens}
          aria-valuetext={`${b.tokens} of ${b.maxTokens} tokens, ${label}`}
          className="relative h-2 w-full overflow-hidden rounded-[2px] bg-surface-3"
        >
          <span
            className="absolute inset-y-0 left-0 rounded-[2px]"
            style={{
              width: `${Math.min(100, (b.tokens / scale) * 100)}%`,
              backgroundColor: BUDGET_TONE[b.status],
            }}
          />
          <span
            aria-hidden="true"
            className="absolute inset-y-0 w-px bg-ink"
            style={{ left: `${(b.maxTokens / scale) * 100}%` }}
          />
        </div>
        <div className="flex items-center gap-2 font-mono text-2xs text-ink-3 tabular">
          <span className="h-1 w-16 overflow-hidden rounded-[2px] bg-surface-3" aria-hidden="true">
            <span
              className="block h-full bg-ink-3"
              style={{ width: `${Math.min(100, b.hardFraction * 100)}%` }}
            />
          </span>
          <span>
            {formatPercent(b.hardFraction, 1)} of {formatTokens(JEV_LIMITS.stateAndQuestionTokens)}{" "}
            · {formatTokens(b.questionHeadroom)} left for the longest question
          </span>
        </div>
      </div>
    );
  },
);

// ---------------------------------------------------------------------------
// Packet view
// ---------------------------------------------------------------------------

const DATA_CLASS_TONE: Record<JevDataClass, "neutral" | "info" | "warn" | "danger"> = {
  public: "neutral",
  internal: "info",
  sensitive: "warn",
  pii: "danger",
};

export interface EvidencePacketViewProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  packet: JevStatePacket;
  /** The contract's state spec: field descriptions, roles, data classes and the token budget. */
  spec?: JevStateSpec;
  /** The builder's report: provenance, redactions, truncations, drops and stale items. */
  report?: JevPacketReport;
  packetHash?: string;
  /** Token estimate; computed from the packet when omitted. */
  tokens?: number;
  /** Reference time for evidence age (ms since epoch). Defaults to the latest `observedAt`. */
  now?: number;
}

function formatValue(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return "null";
  return JSON.stringify(v);
}

function isRedacted(v: unknown): boolean {
  return typeof v === "string" && (v.startsWith("[REDACTED") || v.startsWith("sha256:"));
}

function ProvenanceChips({ refs }: { refs: readonly string[] | undefined }) {
  if (!refs || refs.length === 0) return null;
  return (
    <span className="flex flex-wrap items-center gap-1" aria-label="Provenance">
      {refs.map((r) => (
        <span
          key={r}
          className="inline-flex items-center gap-0.5 rounded-xs bg-surface-3 px-1 font-mono text-2xs text-ink-3"
        >
          <Link2 className="size-2.5" aria-hidden="true" />
          {r}
        </span>
      ))}
    </span>
  );
}

/**
 * The state packet exactly as sent to Jev (JEV_ENGINEERING.md §5): the seven
 * functional sections of Table IV in canonical order, each field with why it
 * is present, its data class, provenance chips and redaction markers;
 * evidence items with support relations, version and freshness; and the token
 * budget. A field nobody can explain is a review finding.
 */
export const EvidencePacketView = forwardRef<HTMLDivElement, EvidencePacketViewProps>(
  function EvidencePacketView(
    { packet, spec, report, packetHash, tokens, now, className, ...rest },
    ref,
  ) {
    const sections = useMemo(() => packetSections(packet), [packet]);
    const estimate = tokens ?? report?.tokens ?? estimatePacketTokens(packet);
    const reference =
      now ??
      Math.max(
        0,
        ...(packet.evidence ?? [])
          .map((e) => (e.observedAt ? Date.parse(e.observedAt) : 0))
          .filter((t) => Number.isFinite(t)),
      );
    const fields = spec ? Object.entries(spec.fields) : [];
    const fieldFor = (section: PacketSectionKey, name: string) =>
      fields.find(([n, f]) => n === name && ROLE_SECTION[f.role] === section);
    const fieldsIn = (section: PacketSectionKey) =>
      fields.filter(([, f]) => ROLE_SECTION[f.role] === section);
    const staleIds = new Set(report?.stale.map((s) => s.id) ?? []);
    const redactedFields = new Set(report?.redacted.map((r) => r.field) ?? []);
    const effective = report?.effectiveDataClass;
    const overPrivacy =
      effective && spec ? dataClassRank(effective) > dataClassRank(spec.privacyClass) : false;

    const keyValues = (
      section: "facts" | "constraints" | "options",
      record: Record<string, unknown>,
    ) => (
      <dl className="m-0 flex flex-col divide-y divide-border">
        {Object.entries(record).map(([k, v]) => {
          const field = fieldFor(section, k);
          const redacted = isRedacted(v) || redactedFields.has(k);
          return (
            <div key={k} className="grid gap-x-3 gap-y-0.5 py-1.5 sm:grid-cols-[160px_1fr]">
              <dt className="flex min-w-0 items-center gap-1.5 font-mono text-xs text-ink-2">
                <span className="truncate">{k}</span>
                {field ? (
                  <Badge size="sm" tone={DATA_CLASS_TONE[field[1].dataClass]}>
                    {field[1].dataClass}
                  </Badge>
                ) : null}
              </dt>
              <dd className="m-0 flex min-w-0 flex-col gap-0.5">
                <span
                  className={cn(
                    "break-words font-mono text-xs",
                    redacted ? "text-ink-3" : "text-ink",
                  )}
                >
                  {redacted ? (
                    <EyeOff className="mr-1 inline size-3 align-[-2px]" aria-label="redacted" />
                  ) : null}
                  {formatValue(v)}
                </span>
                {field ? <span className="text-2xs text-ink-3">{field[1].description}</span> : null}
                <ProvenanceChips refs={report?.provenance[k]} />
              </dd>
            </div>
          );
        })}
      </dl>
    );

    const body = (key: PacketSectionKey): ReactNode => {
      switch (key) {
        case "goal":
          return <p className="m-0 text-sm text-ink">{packet.goal}</p>;
        case "facts":
          return packet.facts ? keyValues("facts", packet.facts) : null;
        case "constraints":
          return packet.constraints ? keyValues("constraints", packet.constraints) : null;
        case "options":
          return packet.options ? keyValues("options", packet.options) : null;
        case "stateVersion":
          return <code className="font-mono text-xs text-ink">{packet.stateVersion}</code>;
        case "artifacts":
          return (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {(packet.artifacts ?? []).map((a) => (
                <li key={a.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
                  <span className="font-mono text-ink">{a.id}</span>
                  <Badge size="sm" tone="outline">
                    {a.kind}
                  </Badge>
                  {a.ref ? <span className="font-mono text-ink-3">{a.ref}</span> : null}
                  {a.hash ? (
                    <span className="font-mono text-2xs text-ink-4">#{shortHash(a.hash)}</span>
                  ) : null}
                  {a.summary ? <span className="basis-full text-ink-2">{a.summary}</span> : null}
                </li>
              ))}
            </ul>
          );
        case "evidence":
          return (
            <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Evidence items">
              {(packet.evidence ?? []).map((e) => {
                const age = evidenceAgeMs(e, reference);
                const stale = staleIds.has(e.id);
                return (
                  <li
                    key={e.id}
                    data-stale={stale || undefined}
                    className={cn(
                      "flex flex-col gap-1 rounded-sm border px-2.5 py-2",
                      stale ? "border-warn bg-warn-soft" : "border-border bg-surface-2",
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-xs font-medium text-ink">{e.id}</span>
                      <Badge size="sm" tone="outline">
                        {e.kind}
                      </Badge>
                      {e.verified ? (
                        <Badge size="sm" tone="ok" icon={<ShieldCheck />}>
                          verified
                        </Badge>
                      ) : null}
                      {stale ? (
                        <Badge size="sm" tone="warn" icon={<Clock />}>
                          stale
                        </Badge>
                      ) : null}
                      <span className="ml-auto font-mono text-2xs text-ink-4 tabular">
                        {e.version ? `v ${e.version}` : "unversioned"}
                        {age !== null ? ` · ${formatMs(age)} old` : ""}
                      </span>
                    </div>
                    {e.summary ? <p className="m-0 text-xs text-ink-2">{e.summary}</p> : null}
                    {e.supports.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="text-2xs text-ink-4">supports</span>
                        {e.supports.map((s) => (
                          <Badge key={s} size="sm" tone="accent" mono>
                            {s}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                    {e.source?.uri || e.source?.ref ? (
                      <span className="truncate font-mono text-2xs text-ink-3">
                        {e.source.ref ?? e.source.uri}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          );
      }
    };

    return (
      <div ref={ref} className={cn("flex min-w-0 flex-col gap-4", className)} {...rest}>
        <div className="flex flex-col gap-3 rounded-md border border-border bg-surface p-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono text-xs text-ink">{packet.stateVersion}</span>
            {packetHash ? (
              <span className="font-mono text-2xs text-ink-4">packet #{shortHash(packetHash)}</span>
            ) : null}
            {effective ? (
              <Badge tone={overPrivacy ? "danger" : DATA_CLASS_TONE[effective]}>
                {effective}
                {spec ? ` ≤ ${spec.privacyClass}` : ""}
              </Badge>
            ) : spec ? (
              <Badge tone={DATA_CLASS_TONE[spec.privacyClass]}>privacy {spec.privacyClass}</Badge>
            ) : null}
            {spec ? <span className="text-2xs text-ink-3">{spec.latencyClass}</span> : null}
          </div>
          <TokenBudgetMeter tokens={estimate} maxTokens={spec?.maxTokens ?? 8000} />
        </div>

        {sections.map((s) => {
          const declared = fieldsIn(s.key);
          return (
            <section
              key={s.key}
              className="flex flex-col gap-1.5"
              aria-label={PACKET_SECTION_LABEL[s.key]}
              data-section={s.key}
            >
              <BlockTitle meta={`${s.size} · ~${s.tokens} tok`}>
                {PACKET_SECTION_LABEL[s.key]}
              </BlockTitle>
              <p className="m-0 text-2xs text-ink-4">
                {PACKET_SECTION_PURPOSE[s.key]}
                {(s.key === "evidence" || s.key === "artifacts") && declared.length > 0
                  ? ` · from ${declared.map(([n]) => n).join(", ")}`
                  : ""}
              </p>
              {(s.key === "evidence" || s.key === "artifacts") && declared.length > 0 ? (
                <ProvenanceChips refs={declared.flatMap(([n]) => report?.provenance[n] ?? [])} />
              ) : null}
              {body(s.key)}
            </section>
          );
        })}

        {report &&
        (report.excluded.length > 0 ||
          report.truncated.length > 0 ||
          report.droppedEvidence.length > 0 ||
          report.redacted.length > 0) ? (
          <section
            className="flex flex-col gap-1.5 rounded-sm border border-dashed border-border-strong p-3"
            aria-label="Builder report"
          >
            <BlockTitle>Not sent</BlockTitle>
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-xs text-ink-2">
              {report.excluded.map((x) => (
                <li key={`x-${x.field}`}>
                  <span className="font-mono">{x.field}</span> excluded (
                  {x.reason.replace("_", " ")})
                </li>
              ))}
              {report.redacted.map((x) => (
                <li key={`r-${x.field}`}>
                  <span className="font-mono">{x.field}</span>{" "}
                  {x.mode === "drop" ? "dropped" : `${x.mode}ed`} ({x.dataClass} above provider
                  eligibility)
                </li>
              ))}
              {report.truncated.map((x) => (
                <li key={`t-${x.field}`}>
                  <span className="font-mono">{x.field}</span> truncated{" "}
                  {x.originalChars.toLocaleString("en")} → {x.keptChars.toLocaleString("en")} chars
                  (marked)
                </li>
              ))}
              {report.droppedEvidence.length > 0 ? (
                <li>
                  evidence dropped by declared selection:{" "}
                  <span className="font-mono">{report.droppedEvidence.join(", ")}</span>
                </li>
              ) : null}
            </ul>
          </section>
        ) : null}
      </div>
    );
  },
);
