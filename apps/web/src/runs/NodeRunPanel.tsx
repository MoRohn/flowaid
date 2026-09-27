"use client";
/**
 * Detail of one node run (UI.md §7.3): status and timing, the decision with its distribution,
 * the tool call, retry attempts, the error, streamed text while generating, input and output.
 */
import { X } from "lucide-react";
import type { NodeRunView } from "@flowaid/ui";
import { formatCost, formatMs, formatTokens } from "@flowaid/ui/lib";
import { Badge, CategoryDot, IconButton, StatusChip } from "@flowaid/ui/primitives";
import { JsonView } from "@flowaid/ui/data";
import { RetryAttempts, ToolCallCard, TraceDecisionDetail } from "@flowaid/ui/trace";

export interface NodeRunPanelProps {
  nodeRun: NodeRunView;
  /** Every attempt of this node in the same scope (ascending). */
  attempts: NodeRunView[];
  /** Text streamed by a generation that is still running. */
  streamed?: string;
  /** The stream dropped and resumed while this node ran: the text above may miss deltas. */
  partial?: boolean;
  onClose?: () => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-2xs font-semibold uppercase tracking-wide text-ink-3">{title}</h3>
      {children}
    </section>
  );
}

export function NodeRunPanel({
  nodeRun: n,
  attempts,
  streamed,
  partial,
  onClose,
}: NodeRunPanelProps) {
  const tokens = n.usage ? n.usage.inputTokens + n.usage.outputTokens : 0;
  return (
    <aside className="flex h-full min-h-0 flex-col" aria-label={`Node run ${n.nodeName}`}>
      <header className="flex items-start gap-2 border-b border-border px-4 py-3">
        <CategoryDot category={n.category} className="mt-1.5" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">{n.nodeName}</p>
          <p className="truncate font-mono text-2xs text-ink-3">
            {n.nodeType}
            {n.scope ? ` · ${n.scope}` : ""}
          </p>
        </div>
        <StatusChip status={n.status} size="sm" />
        {onClose ? (
          <IconButton label="Close details" variant="ghost" size="sm" onClick={onClose}>
            <X strokeWidth={1.75} />
          </IconButton>
        ) : null}
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto px-4 py-4">
        <dl className="grid grid-cols-3 gap-3 font-mono text-xs tabular">
          <div>
            <dt className="text-2xs text-ink-3">Duration</dt>
            <dd className="text-ink">
              {n.durationMs !== undefined ? formatMs(n.durationMs) : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-2xs text-ink-3">Cost</dt>
            <dd className="text-ink">{n.costUsd ? formatCost(n.costUsd) : "—"}</dd>
          </div>
          <div>
            <dt className="text-2xs text-ink-3">Tokens</dt>
            <dd className="text-ink">{tokens ? formatTokens(tokens) : "—"}</dd>
          </div>
          {n.queueLatencyMs !== undefined ? (
            <div>
              <dt className="text-2xs text-ink-3">Queued</dt>
              <dd className="text-ink">{formatMs(n.queueLatencyMs)}</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-2xs text-ink-3">Attempt</dt>
            <dd className="text-ink">{n.attempt}</dd>
          </div>
          {n.routeTaken ? (
            <div>
              <dt className="text-2xs text-ink-3">Route</dt>
              <dd className="truncate text-ink">{n.routeTaken}</dd>
            </div>
          ) : null}
        </dl>
        {n.reusedFromNodeRunId ? <Badge tone="ok">Reused a cached result</Badge> : null}
        {n.error ? (
          <Section title="Error">
            <div
              className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger-text"
              role="alert"
            >
              <p className="font-mono text-xs font-semibold">{n.error.code}</p>
              <p className="mt-1">{n.error.message}</p>
            </div>
          </Section>
        ) : null}
        {n.decision ? (
          <Section title="Decision">
            <TraceDecisionDetail
              decision={n.decision}
              {...(n.decisionQuestion ? { question: n.decisionQuestion } : {})}
            />
          </Section>
        ) : null}
        {n.toolCall ? (
          <Section title="Tool call">
            <ToolCallCard
              call={{ ...n.toolCall, ...(n.toolCall.error ? { error: n.toolCall.error } : {}) }}
              defaultOpenArgs
            />
          </Section>
        ) : null}
        {attempts.length > 1 ? (
          <Section title="Attempts">
            <RetryAttempts attempts={attempts} />
          </Section>
        ) : null}
        {streamed ? (
          <Section title="Streamed text">
            {partial ? (
              <p className="text-2xs text-warn-text">Stream resumed, partial text unavailable.</p>
            ) : null}
            <pre className="whitespace-pre-wrap rounded-md border border-border bg-surface-2 p-3 font-mono text-xs text-ink">
              {streamed}
            </pre>
          </Section>
        ) : null}
        {n.input !== undefined ? (
          <Section title="Input">
            <JsonView value={n.input} expandDepth={2} />
          </Section>
        ) : null}
        {n.output !== undefined ? (
          <Section title="Output">
            <JsonView value={n.output} expandDepth={2} />
          </Section>
        ) : null}
        {n.logs?.length ? (
          <Section title="Logs">
            <ul className="flex flex-col gap-1 font-mono text-2xs" role="list">
              {n.logs.map((l, i) => (
                <li key={i} className="text-ink-2">
                  <span className="text-ink-3">{l.level}</span> {l.message}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
      </div>
    </aside>
  );
}
