import { forwardRef, type ComponentPropsWithoutRef, type ComponentRef } from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/cn";
import { useFieldControl } from "./Field";

export interface SwitchProps extends ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> {
  size?: "sm" | "md";
  invalid?: boolean;
}

/** On/off toggle. Accent track when checked; the thumb slides with the fast duration. */
export const Switch = forwardRef<ComponentRef<typeof SwitchPrimitive.Root>, SwitchProps>(
  function Switch({ className, size = "md", invalid, id, disabled, ...rest }, ref) {
    const field = useFieldControl({
      id,
      disabled,
      "aria-invalid": invalid,
      "aria-describedby": rest["aria-describedby"],
    });
    return (
      <SwitchPrimitive.Root
        ref={ref}
        {...rest}
        id={field.id}
        disabled={field.disabled}
        aria-invalid={field["aria-invalid"]}
        aria-describedby={field["aria-describedby"]}
        aria-required={field["aria-required"]}
        className={cn(
          "group relative inline-flex shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-border-strong",
          "transition-colors duration-(--dur-fast) ease-(--ease-out)",
          "hover:bg-ink-4 data-[state=checked]:bg-accent data-[state=checked]:hover:bg-accent-hover",
          "disabled:cursor-not-allowed disabled:opacity-50",
          size === "sm" ? "h-3.5 w-6" : "h-4 w-7",
          className,
        )}
      >
        <SwitchPrimitive.Thumb
          className={cn(
            "pointer-events-none block rounded-full bg-surface shadow-1 transition-transform duration-(--dur-fast) ease-(--ease-out)",
            size === "sm"
              ? "size-2.5 translate-x-px data-[state=checked]:translate-x-[11px]"
              : "size-3 translate-x-0.5 data-[state=checked]:translate-x-3.5",
          )}
        />
      </SwitchPrimitive.Root>
    );
  },
);
