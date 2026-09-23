import { forwardRef, useId, useMemo, type HTMLAttributes } from "react";
import { monoTextWidth, useMeasuredWidth } from "./useMeasuredWidth";
import { cn } from "@/lib/cn";
import { formatPercent, formatProbability } from "@/lib/format";
import { FieldError } from "@/primitives/Field";
import { Label } from "@/primitives/Label";
import { NumberInput } from "@/primitives/NumberInput";
import { Slider } from "@/primitives/Slider";
import { useControllableState } from "@/primitives/useControllableState";
import {
  gateFromThresholds,
  gateOutcome as outcomeOf,
  thresholdsFromGate,
  type ConfidenceThresholds,
  type GateConfig,
  type GateOutcome,
} from "@/types";
import {
  GATE_LABEL,
  GATE_ORDER,
  gateColorVar,
  gateModel,
  gateShares,
  gateSoftVar,
  histogramBins,
  validateThresholds,
} from "./gate";

const DEFAULT_EDITOR_THRESHOLDS: ConfidenceThresholds = { review: 0.6, auto: 0.9 };

/** Half the slider thumb (14px) so the strips above it map linearly onto the same pixels as the thumb centres. */
const THUMB_INSET = 7;

export interface ConfidenceGateEditorProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "onChange" | "defaultValue"
> {
  /** Controlled thresholds in the UI's two-threshold model (`review` floor, `auto` = pass threshold). */
  value?: ConfidenceThresholds;
  defaultValue?: ConfidenceThresholds;
  onChange?: (value: ConfidenceThresholds) => void;
  /**
   * Controlled runtime config (ARCHITECTURE.md §6.3), mapped as `auto := threshold`,
   * `review := threshold − (reviewBand ?? threshold)`. Used when `value` is absent.
   */
  gate?: GateConfig;
  /** Uncontrolled runtime config; used when neither `value`, `gate` nor `defaultValue` is given. */
  defaultGate?: GateConfig;
  /** Called with the runtime config on every change: `threshold := auto`, `reviewBand := auto − review` (omitted when the floor is 0, the two-way gate); `requireValue` is carried over from `gate` / `defaultGate`. */
  onGateChange?: (config: GateConfig) => void;
  /** Historical confidences in [0, 1]; drawn as a histogram over the zones so thresholds are picked against real data. */
  histogram?: readonly number[];
  /** Histogram bins across [0, 1]. */
  binCount?: number;
  /** Height of the histogram in px. */
  histogramHeight?: number;
  /** Hide the numeric inputs and keep only the slider. */
  hideInputs?: boolean;
  /** Field label; also names the slider for assistive tech. */
  label?: string;
  disabled?: boolean;
  /** Called with the validation message (or null) whenever it changes. */
  onValidate?: (message: string | null) => void;
}

const ZONE_LABEL_FONT_PX = 11;
const ZONE_LABEL_PADDING_PX = 12;

function ZoneStrip({ t, disabled }: { t: ConfidenceThresholds; disabled: boolean }) {
  const zones: Array<{ outcome: GateOutcome; from: number; to: number }> = [
    { outcome: "fail", from: 0, to: Math.min(t.review, t.auto) },
    { outcome: "review", from: Math.min(t.review, t.auto), to: Math.max(t.review, t.auto) },
    { outcome: "pass", from: Math.max(t.review, t.auto), to: 1 },
  ];
  // Labels are hidden when their zone cannot hold them. With a measured
  // width that is decided in pixels (a 10% "auto" zone is 29px in a 320px
  // inspector, too narrow for the word); before layout it falls back to a
  // proportional rule.
  const { ref, width } = useMeasuredWidth<HTMLDivElement>();
  const fits = (widthPct: number, text: string) =>
    width > 0
      ? (widthPct / 100) * width >= monoTextWidth(text, ZONE_LABEL_FONT_PX) + ZONE_LABEL_PADDING_PX
      : widthPct >= (text.length > 6 ? 24 : 9);
  return (
    <div
      aria-hidden="true"
      className={cn("relative h-[18px] w-full", disabled && "opacity-50")}
      style={{ paddingInline: THUMB_INSET }}
    >
      <div ref={ref} className="relative h-full w-full overflow-hidden rounded-[3px] bg-surface-3">
        {zones.map((z) => {
          const width = Math.max(0, z.to - z.from);
          const widthPct = width * 100;
          const range =
            z.outcome === "fail"
              ? `< ${formatProbability(z.to)}`
              : z.outcome === "pass"
                ? `≥ ${formatProbability(z.from)}`
                : `${formatProbability(z.from)}–${formatProbability(z.to)}`;
          const label = GATE_LABEL[z.outcome].toLowerCase();
          return (
            <span
              key={z.outcome}
              data-zone={z.outcome}
              className="absolute inset-y-0 flex items-center gap-1 overflow-hidden whitespace-nowrap px-1.5 font-mono text-2xs leading-none tabular transition-[left,width] duration-(--dur-fast) ease-(--ease-out)"
              style={{
                left: `${(z.from * 100).toFixed(3)}%`,
                width: `${widthPct.toFixed(3)}%`,
                backgroundColor: gateSoftVar(z.outcome),
                color: gateColorVar(z.outcome),
                boxShadow: `inset 0 -2px 0 ${gateColorVar(z.outcome)}`,
              }}
            >
              {fits(widthPct, label) ? <span className="font-medium">{label}</span> : null}
              {fits(widthPct, `${label} ${range}`) ? (
                <span className="opacity-70">{range}</span>
              ) : null}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function Histogram({
  values,
  t,
  binCount,
  height,
}: {
  values: readonly number[];
  t: ConfidenceThresholds;
  binCount: number;
  height: number;
}) {
  const bins = useMemo(() => histogramBins(values, binCount), [values, binCount]);
  const max = Math.max(1, ...bins);
  return (
    <div aria-hidden="true" className="w-full" style={{ paddingInline: THUMB_INSET, height }}>
      <div className="flex h-full w-full items-end gap-px">
        {bins.map((n, i) => {
          const centre = (i + 0.5) / bins.length;
          const outcome = outcomeOf(centre, t);
          return (
            <span
              key={i}
              data-bin={i}
              className="block min-w-0 flex-1 rounded-t-[2px] transition-[height,background-color] duration-(--dur-fast) ease-(--ease-out)"
              style={{
                height: `${((n / max) * 100).toFixed(2)}%`,
                minHeight: n > 0 ? 2 : 0,
                backgroundColor: gateColorVar(outcome),
                opacity: 0.55,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * Editor for a confidence gate (ARCHITECTURE.md §6.3). A two-thumb slider
 * over 0–1 with the three zones (`fail` below the review floor, `review` up
 * to the pass threshold, `pass` at or above) drawn above it and live range
 * labels, mono inputs with a 0.01 step, validation (the review floor must be
 * below the pass threshold; a floor of 0 is the two-way gate) and an optional
 * histogram of historical confidences so the thresholds are chosen against
 * real data, with the share each outcome would receive.
 */
export const ConfidenceGateEditor = forwardRef<HTMLDivElement, ConfidenceGateEditorProps>(
  function ConfidenceGateEditor(
    {
      value,
      defaultValue,
      onChange,
      gate,
      defaultGate,
      onGateChange,
      histogram,
      binCount = 25,
      histogramHeight = 36,
      hideInputs = false,
      label = "Confidence gate",
      disabled = false,
      onValidate,
      className,
      ...rest
    },
    ref,
  ) {
    const controlled = value ?? (gate ? thresholdsFromGate(gate) : undefined);
    const initial =
      defaultValue ?? (defaultGate ? thresholdsFromGate(defaultGate) : DEFAULT_EDITOR_THRESHOLDS);
    const requireValue = (gate ?? defaultGate)?.requireValue;
    const [t, setT] = useControllableState<ConfidenceThresholds>(controlled, initial, (next) => {
      onChange?.(next);
      onGateChange?.(gateFromThresholds(next, requireValue));
    });
    const model = gateModel(t);
    const id = useId();
    const error = validateThresholds(t);
    const errorId = `${id}-error`;
    const shares = useMemo(() => (histogram ? gateShares(histogram, t) : null), [histogram, t]);

    const commit = (next: ConfidenceThresholds) => {
      setT(next);
      const nextError = validateThresholds(next);
      if (nextError !== error) onValidate?.(nextError);
    };

    return (
      <div
        ref={ref}
        data-invalid={error ? "" : undefined}
        data-gate-model={model}
        className={cn("flex w-full min-w-0 flex-col gap-2", className)}
        {...rest}
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="flex min-w-0 items-baseline gap-2">
            <Label htmlFor={`${id}-slider`} disabled={disabled}>
              {label}
            </Label>
            <span className="font-mono text-2xs leading-none text-ink-3">
              {model === "two-way" ? "two-way · pass / review" : "three-way · pass / review / fail"}
            </span>
          </span>
          {shares && histogram ? (
            <span className="flex items-center gap-2.5 font-mono text-2xs leading-none text-ink-3 tabular">
              <span className="text-ink-3">n={histogram.length.toLocaleString("en")}</span>
              {GATE_ORDER.map((o) => (
                <span key={o} data-share={o} className="flex items-center gap-1">
                  <span
                    className="inline-block size-1.5 rounded-full"
                    style={{ backgroundColor: gateColorVar(o) }}
                  />
                  {GATE_LABEL[o].toLowerCase()} {formatPercent(shares[o])}
                </span>
              ))}
            </span>
          ) : null}
        </div>

        {histogram ? (
          <Histogram values={histogram} t={t} binCount={binCount} height={histogramHeight} />
        ) : null}
        <ZoneStrip t={t} disabled={disabled} />
        <Slider
          id={`${id}-slider`}
          min={0}
          max={1}
          step={0.01}
          minStepsBetweenThumbs={1}
          value={[t.review, t.auto]}
          onValueChange={(v) => {
            const [review, auto] = v;
            if (review === undefined || auto === undefined) return;
            commit({ review, auto });
          }}
          thumbLabels={["Review floor", "Pass threshold"]}
          invalid={error !== null}
          disabled={disabled}
          aria-describedby={error ? errorId : undefined}
          className="-mt-1"
        />

        {!hideInputs ? (
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${id}-review`} disabled={disabled} className="text-2xs text-ink-3">
                Review floor
              </Label>
              <NumberInput
                id={`${id}-review`}
                value={t.review}
                min={0}
                max={1}
                step={0.01}
                precision={2}
                size="sm"
                disabled={disabled}
                invalid={error !== null}
                aria-describedby={error ? errorId : undefined}
                onValueChange={(v) => {
                  if (v === null) return;
                  commit({ review: v, auto: t.auto });
                }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${id}-auto`} disabled={disabled} className="text-2xs text-ink-3">
                Pass at or above
              </Label>
              <NumberInput
                id={`${id}-auto`}
                value={t.auto}
                min={0}
                max={1}
                step={0.01}
                precision={2}
                size="sm"
                disabled={disabled}
                invalid={error !== null}
                aria-describedby={error ? errorId : undefined}
                onValueChange={(v) => {
                  if (v === null) return;
                  commit({ review: t.review, auto: v });
                }}
              />
            </div>
          </div>
        ) : null}
        <FieldError id={errorId}>{error}</FieldError>
      </div>
    );
  },
);
