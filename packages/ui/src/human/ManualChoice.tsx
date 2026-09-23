import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Check, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatProbability } from "@/lib/format";
import { Hint, Kbd, useControllableState } from "@/primitives";

export interface ManualChoiceOption {
  id: string;
  label: string;
  /** Model probability in [0,1]; drives the bar. */
  probability?: number;
  description?: ReactNode;
  disabled?: boolean;
}

export interface ManualChoiceProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "onChange" | "defaultValue"
> {
  options: ManualChoiceOption[];
  value?: string | null;
  defaultValue?: string | null;
  onValueChange?: (optionId: string) => void;
  /** Option the model would have picked. Defaults to the highest probability. Highlighted, never pre-selected. */
  modelPick?: string;
  /** Where the 1–9 shortcuts listen: inside the group only, or anywhere on the page outside editable fields. */
  hotkeys?: "focus" | "document" | "off";
  disabled?: boolean;
  /** Hide the model badge and bars (plain selectable rows). */
  hideProbabilities?: boolean;
}

/** Highest-probability option id, or the first option when no probabilities are given. */
export function defaultModelPick(options: ManualChoiceOption[]): string | undefined {
  let best: ManualChoiceOption | undefined;
  for (const o of options) {
    if (o.probability === undefined) continue;
    if (!best || (best.probability ?? -1) < o.probability) best = o;
  }
  return best?.id ?? options[0]?.id;
}

/** True when a keyboard event originates in a field that consumes typing. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable ||
    target.getAttribute("role") === "textbox"
  );
}

/**
 * Selectable rows for a `select` approval. Each row shows the model's
 * probability as a bar and value; the model's pick is highlighted but never
 * pre-selected, so the reviewer's choice is deliberate. Keys 1–9 select the
 * nth option, arrows move between them.
 */
export const ManualChoice = forwardRef<HTMLDivElement, ManualChoiceProps>(function ManualChoice(
  {
    options,
    value,
    defaultValue = null,
    onValueChange,
    modelPick,
    hotkeys = "focus",
    disabled = false,
    hideProbabilities = false,
    className,
    onKeyDown,
    ...rest
  },
  ref,
) {
  const [selected, setSelected] = useControllableState<string | null>(
    value,
    defaultValue,
    (next) => {
      if (next !== null) onValueChange?.(next);
    },
  );
  const pick = modelPick ?? (hideProbabilities ? undefined : defaultModelPick(options));
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const select = useCallback(
    (index: number, focus: boolean) => {
      const option = options[index];
      if (!option || option.disabled || disabled) return;
      setSelected(option.id);
      if (focus) rowRefs.current[index]?.focus();
    },
    [options, disabled, setSelected],
  );

  const handleDigit = useCallback(
    (key: string): boolean => {
      if (!/^[1-9]$/.test(key)) return false;
      const index = Number(key) - 1;
      if (index >= options.length) return false;
      select(index, true);
      return true;
    },
    [options.length, select],
  );

  useEffect(() => {
    if (hotkeys !== "document" || disabled) return;
    const onDocKey = (e: globalThis.KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;
      if (handleDigit(e.key)) e.preventDefault();
    };
    document.addEventListener("keydown", onDocKey);
    return () => document.removeEventListener("keydown", onDocKey);
  }, [hotkeys, disabled, handleDigit]);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented || disabled) return;
    if (hotkeys !== "off" && !e.metaKey && !e.ctrlKey && !e.altKey && handleDigit(e.key)) {
      e.preventDefault();
      return;
    }
    const current = options.findIndex((o) => o.id === selected);
    const focused = rowRefs.current.findIndex((el) => el === document.activeElement);
    const from = focused >= 0 ? focused : current;
    const step = (dir: 1 | -1) => {
      let i = from;
      for (let n = 0; n < options.length; n += 1) {
        i = (i + dir + options.length) % options.length;
        if (!options[i]?.disabled) {
          select(i, true);
          return;
        }
      }
    };
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault();
      step(1);
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault();
      step(-1);
    } else if (e.key === "Home") {
      e.preventDefault();
      select(0, true);
    } else if (e.key === "End") {
      e.preventDefault();
      select(options.length - 1, true);
    }
  };

  const tabStop = options.findIndex((o) => o.id === selected && !o.disabled);
  const firstEnabled = options.findIndex((o) => !o.disabled);

  return (
    <div
      ref={ref}
      role="radiogroup"
      tabIndex={-1}
      aria-disabled={disabled || undefined}
      data-hotkeys={hotkeys}
      className={cn("flex min-w-0 flex-col gap-1.5 outline-none", className)}
      onKeyDown={handleKeyDown}
      {...rest}
    >
      {options.map((option, index) => {
        const isSelected = option.id === selected;
        const isPick = option.id === pick;
        const p = option.probability;
        const rowDisabled = disabled || Boolean(option.disabled);
        return (
          <button
            key={option.id}
            ref={(el) => {
              rowRefs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={isSelected}
            disabled={rowDisabled}
            data-selected={isSelected || undefined}
            data-model-pick={isPick || undefined}
            tabIndex={index === (tabStop >= 0 ? tabStop : firstEnabled) ? 0 : -1}
            onClick={() => select(index, false)}
            className={cn(
              "group/row relative grid w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1.5 rounded-md border px-3 py-2 text-left",
              "transition-[border-color,background-color,box-shadow] duration-(--dur-fast) ease-(--ease-out)",
              "disabled:cursor-not-allowed disabled:opacity-50",
              isSelected
                ? "border-accent bg-surface shadow-[0_0_0_3px_var(--accent-soft)]"
                : isPick
                  ? "border-accent-soft-2 bg-accent-soft/40 hover:border-accent hover:bg-accent-soft/60"
                  : "border-border bg-surface hover:border-border-strong hover:bg-surface-2",
            )}
          >
            {index < 9 ? (
              <Kbd
                aria-hidden="true"
                className={cn(
                  "transition-colors duration-(--dur-fast)",
                  isSelected && "border-accent bg-accent text-accent-ink",
                )}
              >
                {index + 1}
              </Kbd>
            ) : (
              <span aria-hidden="true" className="w-4" />
            )}
            <span className="flex min-w-0 items-center gap-2">
              <span
                className={cn("truncate text-sm", isSelected ? "font-medium text-ink" : "text-ink")}
              >
                {option.label}
              </span>
              {isPick && !hideProbabilities ? (
                <Hint
                  hint="The model would have chosen this option"
                  announce={false}
                  className="inline-flex h-4 shrink-0 items-center gap-1 rounded-xs bg-accent-soft px-1 text-2xs font-medium leading-none text-accent-text"
                >
                  <Sparkles className="size-2.5" strokeWidth={2} aria-hidden="true" />
                  Model pick
                </Hint>
              ) : null}
            </span>
            <span className="flex items-center gap-2">
              {!hideProbabilities && p !== undefined ? (
                <span
                  className={cn(
                    "font-mono text-xs tabular",
                    isPick || isSelected ? "text-ink" : "text-ink-3",
                  )}
                >
                  {formatProbability(p)}
                </span>
              ) : null}
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-4 items-center justify-center rounded-full border transition-[border-color,background-color] duration-(--dur-fast)",
                  isSelected
                    ? "border-accent bg-accent text-accent-ink"
                    : "border-border-strong bg-surface",
                )}
              >
                {isSelected ? <Check className="size-3" strokeWidth={3} /> : null}
              </span>
            </span>
            {option.description ? (
              <span className="col-start-2 -mt-1 truncate text-xs text-ink-3">
                {option.description}
              </span>
            ) : null}
            {!hideProbabilities && p !== undefined ? (
              <span
                aria-hidden="true"
                className="col-span-3 col-start-1 h-[3px] w-full overflow-hidden rounded-[2px] bg-surface-3"
              >
                <span
                  className={cn(
                    "block h-full rounded-[2px] transition-[width] duration-(--dur-base) ease-(--ease-out)",
                    isPick || isSelected ? "bg-p-1" : "bg-p-2",
                  )}
                  style={{ width: `${Math.max(0, Math.min(1, p)) * 100}%` }}
                />
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
});
