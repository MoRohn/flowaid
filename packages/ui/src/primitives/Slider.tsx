import { forwardRef, type ComponentPropsWithoutRef, type ComponentRef } from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "@/lib/cn";
import { useFieldControl } from "./Field";
import { useControllableState } from "./useControllableState";

export interface SliderProps extends Omit<
  ComponentPropsWithoutRef<typeof SliderPrimitive.Root>,
  "value" | "defaultValue" | "onValueChange"
> {
  /** One number for a single thumb, two for a range. */
  value?: number[];
  defaultValue?: number[];
  onValueChange?: (value: number[]) => void;
  /** Show the current value(s) in mono at the end. */
  showValue?: boolean;
  /** Formats a value for the label. Defaults to the raw number with up to 2 decimals. */
  formatValue?: (value: number) => string;
  /** Tick marks at these values, rendered as small notches under the track. */
  marks?: number[];
  invalid?: boolean;
  /** Accessible names per thumb. */
  thumbLabels?: string[];
}

function defaultFormat(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

/**
 * Horizontal slider with one or two thumbs. The filled range is accent; the
 * value label is mono so it lines up with the rest of the numeric UI.
 */
export const Slider = forwardRef<ComponentRef<typeof SliderPrimitive.Root>, SliderProps>(
  function Slider(
    {
      className,
      value,
      defaultValue,
      onValueChange,
      showValue = false,
      formatValue = defaultFormat,
      marks,
      invalid,
      thumbLabels,
      min = 0,
      max = 100,
      step = 1,
      id,
      disabled,
      ...rest
    },
    ref,
  ) {
    const [current, setCurrent] = useControllableState<number[]>(
      value,
      defaultValue ?? [min],
      onValueChange,
    );
    const field = useFieldControl({
      id,
      disabled,
      "aria-invalid": invalid,
      "aria-describedby": rest["aria-describedby"],
    });
    const isRange = current.length > 1;
    const label = current.map(formatValue).join(" – ");

    return (
      <div className={cn("flex w-full min-w-0 items-center gap-3", className)}>
        <SliderPrimitive.Root
          ref={ref}
          {...rest}
          id={field.id}
          disabled={field.disabled}
          aria-invalid={field["aria-invalid"]}
          aria-describedby={field["aria-describedby"]}
          min={min}
          max={max}
          step={step}
          value={current}
          onValueChange={setCurrent}
          className={cn(
            "relative flex h-5 w-full min-w-0 touch-none select-none items-center",
            "data-disabled:cursor-not-allowed data-disabled:opacity-50",
          )}
        >
          <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-border-strong">
            <SliderPrimitive.Range
              className={cn("absolute h-full bg-accent", invalid && "bg-danger")}
            />
          </SliderPrimitive.Track>
          {marks?.map((m) => {
            const pct = ((m - min) / (max - min)) * 100;
            return (
              <span
                key={m}
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 h-1.5 w-px -translate-x-1/2 translate-y-[3px] bg-ink-4"
                style={{ left: `${pct}%` }}
              />
            );
          })}
          {current.map((_, i) => (
            <SliderPrimitive.Thumb
              key={i}
              aria-label={
                thumbLabels?.[i] ?? (isRange ? (i === 0 ? "Minimum" : "Maximum") : "Value")
              }
              className={cn(
                "block size-3.5 cursor-grab rounded-full border border-accent bg-surface shadow-1",
                "transition-[box-shadow,transform] duration-(--dur-fast) ease-(--ease-out) hover:scale-110 active:cursor-grabbing",
                invalid && "border-danger",
              )}
            />
          ))}
        </SliderPrimitive.Root>
        {showValue ? (
          <output
            htmlFor={field.id}
            className="shrink-0 font-mono text-xs text-ink-2 tabular"
            aria-live="off"
          >
            {label}
          </output>
        ) : null}
      </div>
    );
  },
);
