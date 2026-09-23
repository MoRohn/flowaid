import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";
import { Spinner } from "./Spinner";
import { Tooltip, type TooltipProps } from "./Tooltip";

export const iconButtonVariants = cva(
  [
    "inline-flex shrink-0 select-none items-center justify-center rounded-sm",
    "transition-[background-color,border-color,color,box-shadow,opacity] duration-(--dur-fast) ease-(--ease-out)",
    "cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        primary:
          "border border-accent bg-accent text-accent-ink hover:border-accent-hover hover:bg-accent-hover",
        secondary:
          "border border-border bg-surface text-ink-2 shadow-1 hover:bg-surface-3 hover:text-ink",
        ghost:
          "border border-transparent text-ink-3 hover:bg-surface-3 hover:text-ink data-[state=open]:bg-surface-3 data-[state=open]:text-ink",
        danger: "border border-transparent text-danger-text hover:bg-danger-soft",
      },
      size: {
        xs: "size-5 rounded-xs [&_svg]:size-3.5",
        sm: "size-6 [&_svg]:size-3.5",
        md: "size-7 [&_svg]:size-4",
        lg: "size-8 [&_svg]:size-4",
      },
    },
    defaultVariants: { variant: "ghost", size: "md" },
  },
);

export interface IconButtonProps
  extends
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">,
    VariantProps<typeof iconButtonVariants> {
  /** Accessible name; also the tooltip text. Required. */
  label: string;
  children: ReactNode;
  /** Shortcut hint shown in the tooltip, e.g. "mod+k". */
  shortcut?: string;
  /** Set false to keep the aria-label but skip the tooltip (inside menus, when a parent already labels it). */
  tooltip?: boolean;
  tooltipSide?: TooltipProps["side"];
  loading?: boolean;
}

/**
 * Square button for a single icon. The `label` is mandatory: it becomes the
 * aria-label and the tooltip, so an icon is never the only affordance.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    label,
    children,
    shortcut,
    tooltip = true,
    tooltipSide,
    variant,
    size,
    loading = false,
    className,
    disabled,
    type,
    ...rest
  },
  ref,
) {
  const button = (
    <button
      ref={ref}
      type={type ?? "button"}
      aria-label={label}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cn(iconButtonVariants({ variant, size }), className)}
      {...rest}
    >
      {loading ? <Spinner size={size === "lg" ? "sm" : "xs"} label={label} /> : children}
    </button>
  );
  if (!tooltip) return button;
  return (
    <Tooltip content={label} shortcut={shortcut} side={tooltipSide}>
      {button}
    </Tooltip>
  );
});
