import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Slot, Slottable } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";
import { Spinner } from "./Spinner";

export const buttonVariants = cva(
  [
    "relative inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-sm font-medium",
    "transition-[background-color,border-color,color,box-shadow,opacity] duration-(--dur-fast) ease-(--ease-out)",
    "cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 aria-busy:cursor-progress",
    "[&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        primary:
          "border border-accent bg-accent text-accent-ink hover:border-accent-hover hover:bg-accent-hover active:brightness-95",
        secondary:
          "border border-border bg-surface text-ink shadow-1 hover:bg-surface-3 active:bg-surface-3",
        ghost:
          "border border-transparent bg-transparent text-ink-2 hover:bg-surface-3 hover:text-ink active:bg-surface-3",
        danger:
          "border border-transparent bg-transparent text-danger-text hover:bg-danger-soft active:bg-danger-soft",
        link: "h-auto rounded-none border-0 bg-transparent p-0 text-accent-text underline-offset-[3px] hover:underline",
      },
      size: {
        sm: "h-6 gap-1 px-2 text-2xs [&_svg]:size-3.5",
        md: "h-7 gap-1.5 px-2.5 text-xs [&_svg]:size-4",
        lg: "h-8 gap-1.5 px-3 text-xs [&_svg]:size-4",
      },
    },
    compoundVariants: [{ variant: "link", size: ["sm", "md", "lg"], className: "h-auto px-0" }],
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Render the child element instead of a <button>, merging props (Radix Slot). */
  asChild?: boolean;
  /** Shows a spinner in place of the leading icon and disables interaction. */
  loading?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

/**
 * The button. `primary` is accent-filled and should be the only filled button
 * on a screen; `secondary` is the default raised control; `ghost` and `danger`
 * are quiet until hovered; `link` reads as inline text.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    asChild = false,
    variant,
    size,
    loading = false,
    leadingIcon,
    trailingIcon,
    className,
    children,
    disabled,
    type,
    ...rest
  },
  ref,
) {
  const Comp = asChild ? Slot : "button";
  const spinnerSize = size === "sm" ? "xs" : "sm";
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : (type ?? "button")}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-loading={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner size={spinnerSize} className="text-current" /> : leadingIcon}
      <Slottable>{children}</Slottable>
      {trailingIcon}
    </Comp>
  );
});
