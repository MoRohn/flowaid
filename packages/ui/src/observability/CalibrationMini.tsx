import { forwardRef, useState, type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { formatProbability } from "@/lib/format";
import { ChartTooltip } from "./ChartTooltip";
import { makeLinearScale } from "./chartMath";

export interface CalibrationPoint {
  /** Mean predicted confidence in the bucket. */
  predicted: number;
  /** Observed accuracy in the bucket. */
  observed: number;
  /** Sample size; sizes the dot. */
  count?: number;
}

export interface CalibrationMiniProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  points: readonly CalibrationPoint[];
  /** Square plot size in px. */
  size?: number;
  /** Expected calibration error, shown in the corner when given. */
  ece?: number;
  color?: string;
  label?: string;
}

/**
 * Tiny reliability plot for a metrics grid: predicted confidence on x,
 * observed accuracy on y, the diagonal as the perfect-calibration reference.
 * Dots below the line are over-confident. Independent of the full
 * CalibrationChart in decision/ so the observability group has no cycle.
 */
export const CalibrationMini = forwardRef<HTMLDivElement, CalibrationMiniProps>(
  function CalibrationMini(
    { points, size = 120, ece, color = "var(--accent)", label, className, ...rest },
    ref,
  ) {
    const [active, setActive] = useState<number | null>(null);
    const pad = 6;
    const s = makeLinearScale([0, 1], [pad, size - pad], false);
    const yS = (v: number) => size - s(v);
    const maxCount = points.reduce((m, p) => Math.max(m, p.count ?? 1), 1);
    const activePoint = active === null ? undefined : points[active];

    return (
      <div
        ref={ref}
        className={cn("relative inline-flex flex-col gap-1", className)}
        style={{ width: size }}
        {...rest}
      >
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label={label ?? `Calibration across ${points.length} buckets`}
          className="block rounded-sm border border-border bg-surface-2"
        >
          <g aria-hidden="true">
            {[0.25, 0.5, 0.75].map((t) => (
              <g key={t}>
                <line x1={s(t)} x2={s(t)} y1={pad} y2={size - pad} stroke="var(--border)" />
                <line x1={pad} x2={size - pad} y1={yS(t)} y2={yS(t)} stroke="var(--border)" />
              </g>
            ))}
            <line
              x1={s(0)}
              y1={yS(0)}
              x2={s(1)}
              y2={yS(1)}
              stroke="var(--border-strong)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          </g>
          {points.map((p, i) => {
            const r = 2.5 + 2.5 * Math.sqrt((p.count ?? 1) / maxCount);
            return (
              <circle
                key={i}
                cx={s(p.predicted)}
                cy={yS(p.observed)}
                r={r}
                fill={color}
                stroke="var(--surface)"
                strokeWidth={2}
                paintOrder="stroke"
                tabIndex={0}
                aria-label={`Predicted ${formatProbability(p.predicted)}, observed ${formatProbability(p.observed)}`}
                onPointerEnter={() => setActive(i)}
                onPointerLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                className="outline-none focus-visible:stroke-accent"
                style={{ opacity: active === null || active === i ? 1 : 0.5 }}
              />
            );
          })}
          <text
            x={pad + 3}
            y={pad + 10}
            className="font-mono text-2xs"
            fill="var(--ink-3)"
            aria-hidden="true"
          >
            observed ↑
          </text>
          {ece !== undefined ? (
            <text
              x={size - pad - 2}
              y={size - pad - 4}
              textAnchor="end"
              className="font-mono text-2xs tabular"
              fill="var(--ink-2)"
              aria-hidden="true"
            >
              ECE {ece.toFixed(3)}
            </text>
          ) : null}
        </svg>
        <div className="flex justify-end font-mono text-2xs text-ink-3" aria-hidden="true">
          <span>predicted →</span>
        </div>
        {activePoint && active !== null ? (
          <ChartTooltip
            x={s(activePoint.predicted)}
            y={yS(activePoint.observed)}
            bounds={{ width: size, height: size }}
            rows={[
              {
                id: "pred",
                label: "Predicted",
                value: formatProbability(activePoint.predicted),
                swatch: "none",
              },
              {
                id: "obs",
                label: "Observed",
                value: formatProbability(activePoint.observed),
                color,
                swatch: "dot",
              },
              ...(activePoint.count !== undefined
                ? [
                    {
                      id: "n",
                      label: "n",
                      value: activePoint.count.toLocaleString("en"),
                      swatch: "none" as const,
                    },
                  ]
                : []),
            ]}
          />
        ) : null}
      </div>
    );
  },
);
