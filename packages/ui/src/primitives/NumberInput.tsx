import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/cn";
import { inputVariants } from "./Input";
import { useFieldControl } from "./Field";

export interface NumberInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "size" | "value" | "defaultValue" | "onChange" | "min" | "max" | "step" | "type"
> {
  value?: number | null;
  defaultValue?: number | null;
  /** Called with the parsed number, or null when the field is cleared. */
  onValueChange?: (value: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Decimal places kept after stepping/clamping; inferred from `step` when omitted. */
  precision?: number;
  size?: "sm" | "md" | "lg";
  invalid?: boolean;
  /** Unit shown after the digits, e.g. "ms", "%", "$". */
  unit?: ReactNode;
  /** Hide the stepper column. */
  hideStepper?: boolean;
}

/** Clamps `value` to [min, max] and rounds to `precision` decimals. Exported for tests and form adapters. */
export function clampNumber(
  value: number,
  opts: { min?: number; max?: number; precision?: number },
): number {
  let v = value;
  if (opts.min !== undefined) v = Math.max(opts.min, v);
  if (opts.max !== undefined) v = Math.min(opts.max, v);
  if (opts.precision !== undefined) {
    const f = 10 ** opts.precision;
    v = Math.round(v * f) / f;
  }
  return v;
}

/** Steps `value` by `delta * step` (shift multiplies by 10) and clamps. */
export function stepNumber(
  value: number | null,
  delta: number,
  opts: { min?: number; max?: number; step?: number; precision?: number; multiplier?: number },
): number {
  const step = opts.step ?? 1;
  const base = value ?? (opts.min !== undefined && opts.min > 0 ? opts.min : 0);
  return clampNumber(base + delta * step * (opts.multiplier ?? 1), opts);
}

export function inferPrecision(step: number | undefined): number {
  if (step === undefined) return 0;
  const s = step.toString();
  const dot = s.indexOf(".");
  if (dot === -1) {
    const e = s.indexOf("e-");
    return e === -1 ? 0 : Number(s.slice(e + 2));
  }
  return s.length - dot - 1;
}

function parseInput(text: string): number | null {
  const t = text.trim().replace(/,/g, "");
  if (t === "" || t === "-" || t === "." || t === "-.") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function format(n: number | null, precision: number): string {
  if (n === null) return "";
  return Number.isInteger(n) && precision === 0 ? String(n) : n.toFixed(precision);
}

/**
 * Numeric field in the mono face with a stepper column. Arrow keys step,
 * Shift steps by 10×, Home/End jump to min/max; the value clamps on blur so
 * the user can type freely in between.
 */
export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(function NumberInput(
  {
    value,
    defaultValue = null,
    onValueChange,
    min,
    max,
    step = 1,
    precision,
    size = "md",
    invalid,
    unit,
    hideStepper = false,
    className,
    id,
    disabled,
    readOnly,
    onBlur,
    onKeyDown,
    ...rest
  },
  ref,
) {
  const prec = precision ?? inferPrecision(step);
  const opts = { min, max, step, precision: prec };
  const controlled = value !== undefined;
  const [internal, setInternal] = useState<number | null>(defaultValue);
  const current = controlled ? value : internal;
  const [text, setText] = useState(() => format(current, prec));
  const lastEmitted = useRef<number | null>(current);
  const field = useFieldControl({
    id,
    disabled,
    "aria-invalid": invalid,
    "aria-describedby": rest["aria-describedby"],
  });

  useEffect(() => {
    if (current !== lastEmitted.current) {
      lastEmitted.current = current;
      setText(format(current, prec));
    }
  }, [current, prec]);

  const commit = (n: number | null, syncText: boolean) => {
    const next = n === null ? null : clampNumber(n, opts);
    lastEmitted.current = next;
    if (!controlled) setInternal(next);
    if (syncText) setText(format(next, prec));
    if (next !== current) onValueChange?.(next);
  };

  const bump = (delta: number, multiplier = 1) => {
    if (field.disabled || readOnly) return;
    commit(stepNumber(current, delta, { ...opts, multiplier }), true);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;
    switch (e.key) {
      case "ArrowUp":
        e.preventDefault();
        bump(1, e.shiftKey ? 10 : 1);
        break;
      case "ArrowDown":
        e.preventDefault();
        bump(-1, e.shiftKey ? 10 : 1);
        break;
      case "Home":
        if (min !== undefined) {
          e.preventDefault();
          commit(min, true);
        }
        break;
      case "End":
        if (max !== undefined) {
          e.preventDefault();
          commit(max, true);
        }
        break;
      case "Enter":
        commit(parseInput(text), true);
        break;
      default:
        break;
    }
  };

  const atMin = min !== undefined && current !== null && current <= min;
  const atMax = max !== undefined && current !== null && current >= max;
  const stepperDisabled = field.disabled || readOnly;

  return (
    <div className={cn("relative flex w-full min-w-0 items-center", className)}>
      <input
        ref={ref}
        {...rest}
        id={field.id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        role="spinbutton"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={current ?? undefined}
        aria-valuetext={current === null ? "empty" : undefined}
        aria-invalid={field["aria-invalid"]}
        aria-describedby={field["aria-describedby"]}
        aria-required={field["aria-required"]}
        disabled={field.disabled}
        readOnly={readOnly}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const parsed = parseInput(e.target.value);
          if (parsed !== null || e.target.value.trim() === "") commit(parsed, false);
        }}
        onBlur={(e) => {
          onBlur?.(e);
          commit(parseInput(text), true);
        }}
        onKeyDown={handleKeyDown}
        className={cn(
          inputVariants({ size, mono: true }),
          !hideStepper && "pr-6",
          unit && !hideStepper && "pr-11",
          unit && hideStepper && "pr-7",
        )}
      />
      {unit ? (
        <span
          className={cn(
            "pointer-events-none absolute inset-y-0 flex items-center font-mono text-2xs text-ink-3",
            hideStepper ? "right-2" : "right-6",
          )}
        >
          {unit}
        </span>
      ) : null}
      {!hideStepper ? (
        <div
          className="absolute inset-y-px right-px flex w-5 flex-col overflow-hidden rounded-r-[4px] border-l border-border"
          aria-hidden="true"
        >
          <button
            type="button"
            tabIndex={-1}
            disabled={stepperDisabled || atMax}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => bump(1, e.shiftKey ? 10 : 1)}
            className="flex flex-1 items-center justify-center text-ink-3 hover:bg-surface-3 hover:text-ink disabled:pointer-events-none disabled:opacity-40"
          >
            <ChevronUp className="size-3" strokeWidth={2} />
          </button>
          <button
            type="button"
            tabIndex={-1}
            disabled={stepperDisabled || atMin}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => bump(-1, e.shiftKey ? 10 : 1)}
            className="flex flex-1 items-center justify-center border-t border-border text-ink-3 hover:bg-surface-3 hover:text-ink disabled:pointer-events-none disabled:opacity-40"
          >
            <ChevronDown className="size-3" strokeWidth={2} />
          </button>
        </div>
      ) : null}
    </div>
  );
});
