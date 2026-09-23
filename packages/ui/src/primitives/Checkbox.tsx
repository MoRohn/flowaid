import {
  forwardRef,
  useId,
  type ComponentPropsWithoutRef,
  type ComponentRef,
  type ReactNode,
} from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/cn";
import { useFieldControl } from "./Field";

export interface CheckboxProps extends ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> {
  /** Renders an inline label to the right; the whole row toggles. */
  label?: ReactNode;
  description?: ReactNode;
  invalid?: boolean;
  size?: "sm" | "md";
}

/**
 * Tri-state checkbox (checked / unchecked / "indeterminate"). With `label`
 * it renders a clickable row with optional description.
 */
export const Checkbox = forwardRef<ComponentRef<typeof CheckboxPrimitive.Root>, CheckboxProps>(
  function Checkbox(
    { className, label, description, invalid, size = "md", id, disabled, checked, ...rest },
    ref,
  ) {
    const generated = useId();
    const field = useFieldControl({
      id,
      disabled,
      "aria-invalid": invalid,
      "aria-describedby": rest["aria-describedby"],
    });
    const boxId = field.id ?? `checkbox-${generated}`;
    const descId = description ? `${boxId}-desc` : undefined;

    const box = (
      <CheckboxPrimitive.Root
        ref={ref}
        {...rest}
        id={boxId}
        checked={checked}
        disabled={field.disabled}
        aria-invalid={field["aria-invalid"]}
        aria-describedby={
          [field["aria-describedby"], descId].filter(Boolean).join(" ") || undefined
        }
        aria-required={field["aria-required"]}
        className={cn(
          "peer inline-flex shrink-0 cursor-pointer items-center justify-center rounded-xs border border-border-strong bg-surface text-accent-ink",
          "transition-[background-color,border-color,box-shadow] duration-(--dur-fast) ease-(--ease-out)",
          "hover:border-ink-4 data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent",
          "disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger",
          size === "sm" ? "size-3.5" : "size-4",
          !label && className,
        )}
      >
        <CheckboxPrimitive.Indicator className="flex items-center justify-center">
          {checked === "indeterminate" ? (
            <Minus
              className={size === "sm" ? "size-2.5" : "size-3"}
              strokeWidth={3}
              aria-hidden="true"
            />
          ) : (
            <Check
              className={size === "sm" ? "size-2.5" : "size-3"}
              strokeWidth={3}
              aria-hidden="true"
            />
          )}
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
    );

    if (!label) return box;
    return (
      <div className={cn("flex items-start gap-2", className)}>
        <span className="flex h-5 items-center">{box}</span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <label
            htmlFor={boxId}
            className={cn(
              "cursor-pointer select-none text-sm leading-5 text-ink",
              field.disabled && "cursor-not-allowed text-ink-3",
            )}
          >
            {label}
          </label>
          {description ? (
            <span id={descId} className="text-xs leading-normal text-ink-3">
              {description}
            </span>
          ) : null}
        </div>
      </div>
    );
  },
);
