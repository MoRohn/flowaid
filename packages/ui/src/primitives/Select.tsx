import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ComponentRef,
  type ReactNode,
} from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/cn";
import { useFieldControl } from "./Field";

export interface SelectProps extends Omit<
  ComponentPropsWithoutRef<typeof SelectPrimitive.Root>,
  "children"
> {
  id?: string;
  placeholder?: ReactNode;
  size?: "sm" | "md" | "lg";
  invalid?: boolean;
  /** Use the mono face on the trigger (model ids, kinds). */
  mono?: boolean;
  /** Icon rendered before the value in the trigger. */
  leading?: ReactNode;
  className?: string;
  contentClassName?: string;
  /** Match the trigger width (default) or size to the widest item. */
  contentWidth?: "trigger" | "auto";
  align?: SelectPrimitive.SelectContentProps["align"];
  children: ReactNode;
  "aria-label"?: string;
  "aria-describedby"?: string;
}

/**
 * Single-value select. Compose with `SelectItem`, `SelectGroup` and
 * `SelectSeparator`. The trigger is 28px and reads the enclosing FieldRow.
 */
export const Select = forwardRef<HTMLButtonElement, SelectProps>(function Select(
  {
    id,
    placeholder = "Select…",
    size = "md",
    invalid,
    mono = false,
    leading,
    className,
    contentClassName,
    contentWidth = "trigger",
    align = "start",
    children,
    disabled,
    "aria-label": ariaLabel,
    "aria-describedby": ariaDescribedBy,
    ...root
  },
  ref,
) {
  const field = useFieldControl({
    id,
    disabled,
    "aria-invalid": invalid,
    "aria-describedby": ariaDescribedBy,
  });
  return (
    <SelectPrimitive.Root disabled={field.disabled} {...root}>
      <SelectPrimitive.Trigger
        ref={ref}
        id={field.id}
        aria-label={ariaLabel}
        aria-invalid={field["aria-invalid"]}
        aria-describedby={field["aria-describedby"]}
        aria-required={field["aria-required"]}
        className={cn(
          "group flex w-full min-w-0 items-center gap-2 rounded-sm border border-border bg-surface text-left text-ink shadow-1",
          "transition-[border-color,box-shadow,background-color] duration-(--dur-fast) ease-(--ease-out)",
          "hover:bg-surface-3 data-[state=open]:border-accent",
          "disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-4 disabled:shadow-none",
          "aria-invalid:border-danger data-placeholder:text-ink-3",
          size === "sm" && "h-6 px-1.5 text-xs",
          size === "md" && "h-7 px-2 text-sm",
          size === "lg" && "h-8 px-2.5 text-sm",
          mono && "font-mono text-xs",
          className,
        )}
      >
        {leading ? (
          <span className="flex shrink-0 items-center text-ink-3 [&_svg]:size-4">{leading}</span>
        ) : null}
        <span className="min-w-0 flex-1 truncate">
          <SelectPrimitive.Value placeholder={placeholder} />
        </span>
        <SelectPrimitive.Icon asChild>
          <ChevronDown
            className="size-4 shrink-0 text-ink-3 transition-transform duration-(--dur-fast) group-data-[state=open]:rotate-180"
            strokeWidth={1.75}
            aria-hidden="true"
          />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          align={align}
          collisionPadding={8}
          className={cn(
            "fa-pop z-50 max-h-(--radix-select-content-available-height) overflow-hidden rounded-md border border-border bg-surface p-1 text-ink shadow-3",
            "origin-(--radix-select-content-transform-origin)",
            contentWidth === "trigger"
              ? "w-(--radix-select-trigger-width)"
              : "min-w-(--radix-select-trigger-width)",
            contentClassName,
          )}
        >
          <SelectPrimitive.ScrollUpButton className="flex h-5 items-center justify-center text-ink-3">
            <ChevronUp className="size-3.5" aria-hidden="true" />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="flex flex-col gap-px">
            {children}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="flex h-5 items-center justify-center text-ink-3">
            <ChevronDown className="size-3.5" aria-hidden="true" />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
});

export interface SelectItemProps extends Omit<
  ComponentPropsWithoutRef<typeof SelectPrimitive.Item>,
  "children"
> {
  /** The option label, shown in the trigger when selected. */
  children: ReactNode;
  /** One-line secondary text below the label. */
  description?: ReactNode;
  icon?: ReactNode;
  /** Mono text at the right edge (a cost, a latency, a version). */
  meta?: ReactNode;
}

export const SelectItem = forwardRef<ComponentRef<typeof SelectPrimitive.Item>, SelectItemProps>(
  function SelectItem({ className, children, description, icon, meta, ...rest }, ref) {
    return (
      <SelectPrimitive.Item
        ref={ref}
        className={cn(
          "relative flex w-full cursor-default select-none items-center gap-2 rounded-xs py-1 pl-2 pr-7 text-sm outline-none",
          "data-highlighted:bg-surface-3 data-disabled:pointer-events-none data-disabled:text-ink-4",
          description ? "min-h-10" : "min-h-7",
          className,
        )}
        {...rest}
      >
        {icon ? (
          <span className="flex shrink-0 items-center text-ink-3 [&_svg]:size-4">{icon}</span>
        ) : null}
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
          {description ? (
            <span className="mt-0.5 truncate text-2xs text-ink-3">{description}</span>
          ) : null}
        </span>
        {meta ? (
          <span className="shrink-0 font-mono text-2xs text-ink-3 tabular">{meta}</span>
        ) : null}
        <SelectPrimitive.ItemIndicator className="absolute right-2 flex items-center text-accent">
          <Check className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
        </SelectPrimitive.ItemIndicator>
      </SelectPrimitive.Item>
    );
  },
);

export interface SelectGroupProps extends ComponentPropsWithoutRef<typeof SelectPrimitive.Group> {
  label?: ReactNode;
}

export const SelectGroup = forwardRef<ComponentRef<typeof SelectPrimitive.Group>, SelectGroupProps>(
  function SelectGroup({ label, className, children, ...rest }, ref) {
    return (
      <SelectPrimitive.Group ref={ref} className={cn("flex flex-col gap-px", className)} {...rest}>
        {label ? (
          <SelectPrimitive.Label className="text-eyebrow px-2 pb-1 pt-1.5">
            {label}
          </SelectPrimitive.Label>
        ) : null}
        {children}
      </SelectPrimitive.Group>
    );
  },
);

export const SelectSeparator = forwardRef<
  ComponentRef<typeof SelectPrimitive.Separator>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(function SelectSeparator({ className, ...rest }, ref) {
  return (
    <SelectPrimitive.Separator
      ref={ref}
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...rest}
    />
  );
});
