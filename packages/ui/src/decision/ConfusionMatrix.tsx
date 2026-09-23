/**
 * Confusion matrix for a choice decision (UI.md §8, Evaluations): rows are the expected
 * option, columns the option the decision picked. Cells are shaded by their share of the row,
 * in the accent ramp; the diagonal is outlined. Per-option recall and precision and the overall
 * accuracy sit in the margins. It is a real table, so screen readers get the counts.
 */
import { useMemo } from "react";
import { cn } from "@/lib/cn";
import { formatPercent } from "@/lib/format";

export interface ConfusionPair {
  expected: string;
  actual: string;
}

export interface ConfusionModel {
  labels: string[];
  /** counts[expected][actual] */
  counts: number[][];
  total: number;
  correct: number;
  recall: (number | null)[];
  precision: (number | null)[];
}

/** Builds the matrix from (expected, actual) pairs; label order is `labels` then first appearance. */
export function confusionModel(
  pairs: readonly ConfusionPair[],
  labels: readonly string[] = [],
): ConfusionModel {
  const order = [...labels];
  for (const p of pairs) {
    if (!order.includes(p.expected)) order.push(p.expected);
    if (!order.includes(p.actual)) order.push(p.actual);
  }
  const index = new Map(order.map((l, i) => [l, i]));
  const counts = order.map(() => order.map(() => 0));
  for (const p of pairs) {
    const r = index.get(p.expected) ?? 0;
    const c = index.get(p.actual) ?? 0;
    const row = counts[r];
    if (row) row[c] = (row[c] ?? 0) + 1;
  }
  const rowSum = counts.map((row) => row.reduce((a, b) => a + b, 0));
  const colSum = order.map((_, c) => counts.reduce((a, row) => a + (row[c] ?? 0), 0));
  const diag = order.map((_, i) => counts[i]?.[i] ?? 0);
  return {
    labels: order,
    counts,
    total: pairs.length,
    correct: diag.reduce((a, b) => a + b, 0),
    recall: diag.map((d, i) => ((rowSum[i] ?? 0) > 0 ? d / (rowSum[i] ?? 1) : null)),
    precision: diag.map((d, i) => ((colSum[i] ?? 0) > 0 ? d / (colSum[i] ?? 1) : null)),
  };
}

export interface ConfusionMatrixProps {
  pairs: readonly ConfusionPair[];
  /** Fixed label order (the node's options); unseen labels still get a row and column. */
  labels?: readonly string[];
  /** Caption / accessible name. */
  title?: string;
  className?: string;
}

const pct = (v: number | null) => (v === null ? "—" : formatPercent(v));

export function ConfusionMatrix({
  pairs,
  labels,
  title = "Confusion matrix",
  className,
}: ConfusionMatrixProps) {
  const model = useMemo(() => confusionModel(pairs, labels), [pairs, labels]);
  if (model.labels.length === 0)
    return <p className="text-xs text-ink-3">No evaluated decisions yet.</p>;
  return (
    <div className={cn("min-w-0 overflow-x-auto", className)}>
      <table className="border-separate border-spacing-0.5 text-2xs" aria-label={title}>
        <caption className="pb-1.5 text-left text-xs text-ink-2">
          {title} · accuracy{" "}
          <span className="font-mono tabular">
            {pct(model.total ? model.correct / model.total : null)}
          </span>{" "}
          <span className="text-ink-3">
            ({model.correct}/{model.total})
          </span>
        </caption>
        <thead>
          <tr>
            <th scope="col" className="px-1.5 text-left font-normal text-ink-3">
              expected ↓ / picked →
            </th>
            {model.labels.map((l) => (
              <th
                key={l}
                scope="col"
                className="max-w-24 truncate px-1.5 font-mono font-medium text-ink-2"
              >
                {l}
              </th>
            ))}
            <th scope="col" className="px-1.5 font-normal text-ink-3">
              recall
            </th>
          </tr>
        </thead>
        <tbody>
          {model.labels.map((expected, r) => {
            const row = model.counts[r] ?? [];
            const sum = row.reduce((a, b) => a + b, 0);
            return (
              <tr key={expected}>
                <th
                  scope="row"
                  className="max-w-32 truncate px-1.5 text-left font-mono font-medium text-ink-2"
                >
                  {expected}
                </th>
                {row.map((n, c) => {
                  const share = sum > 0 ? n / sum : 0;
                  const diagonal = r === c;
                  return (
                    <td
                      key={model.labels[c]}
                      className={cn(
                        "h-7 min-w-9 rounded-xs px-1.5 text-center font-mono tabular",
                        diagonal && "outline outline-1 -outline-offset-1 outline-accent",
                        share > 0.5 ? "text-accent-ink" : "text-ink-2",
                      )}
                      style={{
                        background:
                          n > 0
                            ? `color-mix(in oklab, var(--accent) ${Math.round(12 + share * 78)}%, transparent)`
                            : undefined,
                      }}
                    >
                      {n}
                      <span className="sr-only">
                        {` picked as ${model.labels[c] ?? ""}, ${formatPercent(share)} of ${expected}`}
                      </span>
                    </td>
                  );
                })}
                <td className="px-1.5 text-center font-mono text-ink-3 tabular">
                  {pct(model.recall[r] ?? null)}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" className="px-1.5 text-left font-normal text-ink-3">
              precision
            </th>
            {model.labels.map((l, c) => (
              <td key={l} className="px-1.5 text-center font-mono text-ink-3 tabular">
                {pct(model.precision[c] ?? null)}
              </td>
            ))}
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
