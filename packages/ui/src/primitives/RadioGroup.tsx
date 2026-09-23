import {
  createContext,
  forwardRef,
  useContext,
  useId,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";
import { useFieldControl } from "./Field";
import { useControllableState } from "./useControllableState";

interface RadioContextValue {
  name: string;
  value: string | undefined;
  setValue: (v: string) => void;
  disabled: boolean;
  invalid: boolean;
}

const RadioContext = createContext<RadioContextValue | null>(null);

export interface RadioGroupProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "onChange" | "defaultValue"
> {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  name?: string;
  disabled?: boolean;
  invalid?: boolean;
  orientation?: "vertical" | "horizontal";
  children: ReactNode;
}

/**
 * Radio group built on native inputs, so arrow-key navigation and form
 * submission come for free. Compose with `RadioItem`.
 */
export const RadioGroup = forwardRef<HTMLDivElement, RadioGroupProps>(function RadioGroup(
  {
    value,
    defaultValue,
    onValueChange,
    name,
    disabled,
    invalid,
    orientation = "vertical",
    className,
    children,
    id,
    ...rest
  },
  ref,
) {
  const generated = useId();
  const [current, setCurrent] = useControllableState<string | undefined>(
    value,
    defaultValue,
    (v) => {
      if (v !== undefined) onValueChange?.(v);
    },
  );
  const field = useFieldControl({
    id,
    disabled,
    "aria-invalid": invalid,
    "aria-describedby": rest["aria-describedby"],
  });
  return (
    <RadioContext.Provider
      value={{
        name: name ?? `radio-${generated}`,
        value: current,
        setValue: setCurrent,
        disabled: Boolean(field.disabled),
        invalid: Boolean(field["aria-invalid"]),
      }}
    >
      <div
        ref={ref}
        role="radiogroup"
        {...rest}
        id={field.id}
        aria-invalid={field["aria-invalid"]}
        aria-describedby={field["aria-describedby"]}
        aria-required={field["aria-required"]}
        aria-orientation={orientation}
        className={cn(
          "flex min-w-0",
          orientation === "vertical" ? "flex-col gap-2" : "flex-row flex-wrap gap-x-4 gap-y-2",
          className,
        )}
      >
        {children}
      </div>
    </RadioContext.Provider>
  );
});

export interface RadioItemProps extends Omit<HTMLAttributes<HTMLLabelElement>, "children"> {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  /** Mono text at the right (a probability, a cost). */
  meta?: ReactNode;
}

export const RadioItem = forwardRef<HTMLLabelElement, RadioItemProps>(function RadioItem(
  { value, label, description, disabled, meta, className, ...rest },
  ref,
) {
  const ctx = useContext(RadioContext);
  if (!ctx) throw new Error("RadioItem must be used inside RadioGroup");
  const isDisabled = disabled || ctx.disabled;
  const checked = ctx.value === value;
  return (
    <label
      ref={ref}
      data-state={checked ? "checked" : "unchecked"}
      data-disabled={isDisabled || undefined}
      className={cn(
        "group flex cursor-pointer items-start gap-2 select-none",
        isDisabled && "cursor-not-allowed",
        className,
      )}
      {...rest}
    >
      <span className="relative flex h-5 shrink-0 items-center">
        <input
          type="radio"
          name={ctx.name}
          value={value}
          checked={checked}
          disabled={isDisabled}
          onChange={() => ctx.setValue(value)}
          className="peer sr-only"
        />
        <span
          aria-hidden="true"
          className={cn(
            "flex size-4 items-center justify-center rounded-full border border-border-strong bg-surface",
            "transition-[border-color,background-color,box-shadow] duration-(--dur-fast) ease-(--ease-out)",
            "group-hover:border-ink-4 peer-checked:border-accent peer-checked:group-hover:border-accent",
            "peer-focus-visible:shadow-(--focus) peer-disabled:opacity-50",
            ctx.invalid && "border-danger",
          )}
        >
          <span
            className={cn(
              "size-2 scale-0 rounded-full bg-accent transition-transform duration-(--dur-fast) ease-(--ease-out)",
              checked && "scale-100",
            )}
          />
        </span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={cn(
            "flex items-center gap-2 text-sm leading-5 text-ink",
            isDisabled && "text-ink-3",
          )}
        >
          <span className="min-w-0 flex-1">{label}</span>
          {meta ? (
            <span className="shrink-0 font-mono text-2xs text-ink-3 tabular">{meta}</span>
          ) : null}
        </span>
        {description ? (
          <span className="text-xs leading-normal text-ink-3">{description}</span>
        ) : null}
      </span>
    </label>
  );
});
