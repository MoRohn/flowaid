import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";
import { CATEGORY_LABEL, categoryVar, type NodeCategory } from "@/lib/categories";

export const badgeVariants = cva(
  "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-xs border font-medium leading-none [&_svg]:size-3 [&_svg]:shrink-0",
  {
    variants: {
      tone: {
        neutral: "border-transparent bg-surface-3 text-ink-2",
        accent: "border-transparent bg-accent-soft text-accent-text",
        ok: "border-transparent bg-ok-soft text-ok-text",
        warn: "border-transparent bg-warn-soft text-warn-text",
        danger: "border-transparent bg-danger-soft text-danger-text",
        info: "border-transparent bg-info-soft text-info-text",
        outline: "border-border bg-transparent text-ink-2",
      },
      size: {
        sm: "h-4 px-1 text-2xs",
        md: "h-[18px] px-1.5 text-2xs",
      },
      mono: { true: "font-mono tabular", false: "" },
    },
    defaultVariants: { tone: "neutral", size: "md", mono: false },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>, Omit<VariantProps<typeof badgeVariants>, "mono"> {
  /** Tint by node category instead of a tone. */
  category?: NodeCategory;
  /** Leading 6px dot in the current colour. */
  dot?: boolean;
  mono?: boolean;
  icon?: ReactNode;
}

/**
 * Compact label. Tones map to status/accent tokens; `category` tints by the
 * node category hue (color-mixed soft background) so categories never reuse
 * status colours.
 */
export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { className, tone, size, mono = false, category, dot = false, icon, style, children, ...rest },
  ref,
) {
  const categoryStyle = category
    ? {
        color: categoryVar(category),
        backgroundColor: `color-mix(in srgb, ${categoryVar(category)} 12%, transparent)`,
        borderColor: "transparent",
      }
    : undefined;
  return (
    <span
      ref={ref}
      data-category={category}
      className={cn(badgeVariants({ tone: category ? "neutral" : tone, size, mono }), className)}
      style={{ ...categoryStyle, ...style }}
      {...rest}
    >
      {dot ? <span aria-hidden="true" className="size-1.5 rounded-full bg-current" /> : null}
      {icon}
      {children}
      {/* A category badge whose content is not plain text names its category for assistive tech. */}
      {category && typeof children !== "string" ? (
        <span className="sr-only">{CATEGORY_LABEL[category]}</span>
      ) : null}
    </span>
  );
});
