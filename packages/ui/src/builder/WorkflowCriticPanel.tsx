import { forwardRef, useState, type HTMLAttributes } from "react";
import {
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Lightbulb,
  RefreshCw,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { formatCost, formatMs } from "@/lib/format";
import {
  Badge,
  Button,
  CollapsibleContent,
  CollapsibleRoot,
  EmptyState,
  Panel,
} from "@/primitives";
import type { CriticFindingView } from "@/types";

export type CriticSeverity = CriticFindingView["severity"];
export type CriticCategory = CriticFindingView["category"];

export interface CriticSummary {
  total: number;
  bySeverity: Record<CriticSeverity, number>;
  byCategory: Record<CriticCategory, number>;
  /** Findings with an automatic fix. */
  fixable: number;
  /** Sum of estimated savings across findings that declare any. */
  savings: { costUsd: number; latencyMs: number; calls: number };
}

export const CRITIC_CATEGORIES: CriticCategory[] = [
  "safety",
  "correctness",
  "reliability",
  "cost",
  "performance",
  "style",
];

export const CRITIC_CATEGORY_LABEL: Record<CriticCategory, string> = {
  cost: "Cost",
  safety: "Safety",
  reliability: "Reliability",
  correctness: "Correctness",
  performance: "Performance",
  style: "Style",
};

const SEVERITY_ORDER: Record<CriticSeverity, number> = { error: 0, warning: 1, suggestion: 2 };

/** Counts findings by severity and category and totals the estimated savings. */
export function criticSummary(findings: readonly CriticFindingView[]): CriticSummary {
  const bySeverity: Record<CriticSeverity, number> = { error: 0, warning: 0, suggestion: 0 };
  const byCategory: Record<CriticCategory, number> = {
    cost: 0,
    safety: 0,
    reliability: 0,
    correctness: 0,
    performance: 0,
    style: 0,
  };
  const savings = { costUsd: 0, latencyMs: 0, calls: 0 };
  let fixable = 0;
  for (const f of findings) {
    bySeverity[f.severity] += 1;
    byCategory[f.category] += 1;
    if (f.fixAvailable) fixable += 1;
    savings.costUsd += f.savings?.costUsd ?? 0;
    savings.latencyMs += f.savings?.latencyMs ?? 0;
    savings.calls += f.savings?.calls ?? 0;
  }
  return { total: findings.length, bySeverity, byCategory, fixable, savings };
}

/** Formats a finding's savings as a short mono string, or empty when none. */
export function formatSavings(s: CriticFindingView["savings"]): string {
  if (!s) return "";
  const parts: string[] = [];
  if (s.costUsd) parts.push(`${formatCost(s.costUsd)}/1k`);
  if (s.latencyMs) parts.push(formatMs(s.latencyMs));
  if (s.calls) parts.push(`${s.calls} calls`);
  return parts.join(" · ");
}

export interface WorkflowCriticPanelProps extends HTMLAttributes<HTMLDivElement> {
  findings: CriticFindingView[];
  /** Names of the checks that ran; listed in the empty state. */
  checks?: string[];
  /** Resolve a node id to a display name. */
  nodeName?: (nodeId: string) => string;
  onFocusNode?: (nodeId: string) => void;
  onApplyFix?: (finding: CriticFindingView) => void;
  onRerun?: () => void;
  reviewing?: boolean;
  /** When the review last ran, e.g. "2 min ago". */
  reviewedAt?: string;
  flush?: boolean;
}

function SeverityIcon({ severity }: { severity: CriticSeverity }) {
  const cls = "size-4 shrink-0";
  if (severity === "error")
    return (
      <CircleAlert className={cn(cls, "text-danger-text")} strokeWidth={1.75} aria-label="Error" />
    );
  if (severity === "warning")
    return (
      <TriangleAlert
        className={cn(cls, "text-warn-text")}
        strokeWidth={1.75}
        aria-label="Warning"
      />
    );
  return <Lightbulb className={cn(cls, "text-ink-3")} strokeWidth={1.75} aria-label="Suggestion" />;
}

function FindingRow({
  finding,
  nodeName,
  onFocusNode,
  onApplyFix,
}: {
  finding: CriticFindingView;
  nodeName: (id: string) => string;
  onFocusNode?: (id: string) => void;
  onApplyFix?: (f: CriticFindingView) => void;
}) {
  const [open, setOpen] = useState(false);
  const savings = formatSavings(finding.savings);
  return (
    <CollapsibleRoot open={open} onOpenChange={setOpen} asChild>
      <li className="group/finding" data-severity={finding.severity}>
        <div className="grid grid-cols-[16px_1fr_auto] items-start gap-x-2 px-3 py-2 sm:grid-cols-[16px_1fr_minmax(80px,auto)_auto]">
          <span className="mt-0.5">
            <SeverityIcon severity={finding.severity} />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              className="inline-flex max-w-full cursor-pointer items-center gap-1 self-start text-left text-xs font-medium text-ink"
            >
              <span className="min-w-0">{finding.title}</span>
              <ChevronRight
                className={cn(
                  "size-3.5 shrink-0 text-ink-3 transition-transform duration-(--dur-fast) ease-(--ease-out)",
                  open && "rotate-90",
                )}
                strokeWidth={1.75}
                aria-hidden="true"
              />
            </button>
            {finding.nodeIds && finding.nodeIds.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {finding.nodeIds.map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onFocusNode?.(id)}
                    className="inline-flex h-[18px] items-center rounded-xs border border-border bg-surface-2 px-1.5 font-mono text-2xs text-ink-2 hover:border-border-strong hover:text-ink"
                  >
                    {nodeName(id)}
                  </button>
                ))}
              </div>
            ) : null}
            {savings ? (
              <span className="font-mono text-2xs text-ok-text tabular sm:hidden">
                saves {savings}
              </span>
            ) : null}
          </div>
          <span className="hidden justify-self-end pt-0.5 font-mono text-2xs text-ok-text tabular sm:block">
            {savings}
          </span>
          <div className="col-start-3 justify-self-end sm:col-start-4">
            {finding.fixAvailable ? (
              <Button
                size="sm"
                onClick={() => onApplyFix?.(finding)}
                leadingIcon={<Wrench strokeWidth={1.75} aria-hidden="true" />}
              >
                Apply fix
              </Button>
            ) : null}
          </div>
        </div>
        <CollapsibleContent className="pb-2.5 pl-9 pr-3 pt-0">
          <p className="text-xs leading-normal text-ink-2">{finding.detail}</p>
        </CollapsibleContent>
      </li>
    </CollapsibleRoot>
  );
}

/**
 * Results of the static workflow review. Findings are grouped by category in
 * a fixed order (safety first), each row expands to its detail, links to the
 * nodes it concerns and offers "Apply fix" when a fix is available.
 */
export const WorkflowCriticPanel = forwardRef<HTMLDivElement, WorkflowCriticPanelProps>(
  function WorkflowCriticPanel(
    {
      findings,
      checks = [],
      nodeName = (id) => id,
      onFocusNode,
      onApplyFix,
      onRerun,
      reviewing = false,
      reviewedAt,
      flush = false,
      className,
      ...rest
    },
    ref,
  ) {
    const summary = criticSummary(findings);
    const groups = CRITIC_CATEGORIES.map((category) => ({
      category,
      items: findings
        .filter((f) => f.category === category)
        .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]),
    })).filter((g) => g.items.length > 0);

    return (
      <Panel
        ref={ref}
        title="Review"
        meta={reviewedAt}
        padded={false}
        flush={flush}
        toolbar={
          <Button
            size="sm"
            variant="ghost"
            loading={reviewing}
            onClick={onRerun}
            leadingIcon={<RefreshCw strokeWidth={1.75} aria-hidden="true" />}
          >
            Re-run review
          </Button>
        }
        className={className}
        {...rest}
      >
        {summary.total === 0 ? (
          <EmptyState
            size="sm"
            icon={<CircleCheck className="text-ok-text" strokeWidth={1.75} aria-hidden="true" />}
            title="No issues found"
            description={
              checks.length > 0
                ? `${checks.length} checks ran: ${checks.join(", ")}.`
                : "Every check passed."
            }
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
              {summary.bySeverity.error > 0 ? (
                <Badge tone="danger" dot mono>
                  {summary.bySeverity.error} {summary.bySeverity.error === 1 ? "error" : "errors"}
                </Badge>
              ) : null}
              {summary.bySeverity.warning > 0 ? (
                <Badge tone="warn" dot mono>
                  {summary.bySeverity.warning}{" "}
                  {summary.bySeverity.warning === 1 ? "warning" : "warnings"}
                </Badge>
              ) : null}
              {summary.bySeverity.suggestion > 0 ? (
                <Badge tone="neutral" dot mono>
                  {summary.bySeverity.suggestion}{" "}
                  {summary.bySeverity.suggestion === 1 ? "suggestion" : "suggestions"}
                </Badge>
              ) : null}
              <span className="ml-auto font-mono text-2xs text-ink-3 tabular">
                {summary.fixable} fixable
                {summary.savings.costUsd > 0 ? ` · ${formatCost(summary.savings.costUsd)}/1k` : ""}
              </span>
            </div>
            <div className="divide-y divide-border">
              {groups.map((g) => (
                <section key={g.category} aria-label={CRITIC_CATEGORY_LABEL[g.category]}>
                  <header className="flex h-7 items-center gap-2 bg-surface-2 px-3">
                    <h3 className="text-eyebrow">{CRITIC_CATEGORY_LABEL[g.category]}</h3>
                    <span className="font-mono text-2xs text-ink-3 tabular">{g.items.length}</span>
                    <span className="ml-auto hidden font-mono text-2xs text-ink-3 sm:block">
                      est. savings
                    </span>
                  </header>
                  <ul className="divide-y divide-border">
                    {g.items.map((f) => (
                      <FindingRow
                        key={f.id}
                        finding={f}
                        nodeName={nodeName}
                        onFocusNode={onFocusNode}
                        onApplyFix={onApplyFix}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </>
        )}
      </Panel>
    );
  },
);
