import { forwardRef, type ComponentPropsWithoutRef, type ComponentRef } from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cn } from "@/lib/cn";

export interface LabelProps extends ComponentPropsWithoutRef<typeof LabelPrimitive.Root> {
  /** Appends a danger asterisk. */
  required?: boolean;
  /** Appends a muted "optional". */
  optional?: boolean;
  disabled?: boolean;
}

/** 12px medium label. Pair with FieldRow, or use standalone with `htmlFor`. */
export const Label = forwardRef<ComponentRef<typeof LabelPrimitive.Root>, LabelProps>(
  function Label(
    { className, required = false, optional = false, disabled = false, children, ...rest },
    ref,
  ) {
    return (
      <LabelPrimitive.Root
        ref={ref}
        data-disabled={disabled || undefined}
        className={cn(
          "inline-flex items-center gap-1 text-xs font-medium leading-tight text-ink-2 select-none",
          disabled && "text-ink-3",
          className,
        )}
        {...rest}
      >
        {children}
        {required ? (
          <span aria-hidden="true" className="text-danger-text">
            *
          </span>
        ) : null}
        {optional && !required ? <span className="font-normal text-ink-3">(optional)</span> : null}
      </LabelPrimitive.Root>
    );
  },
);
