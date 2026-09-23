import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { CATEGORY_LABEL, categoryVar, type NodeCategory } from "@/lib/categories";

export interface CategoryDotProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  category: NodeCategory;
  /** Diameter in px. */
  size?: number;
  /** Render the category name after the dot. */
  withLabel?: boolean;
  /** Hollow ring instead of a filled dot (for ports / untyped). */
  hollow?: boolean;
}

/** 8px dot in the category hue. The one place category colour appears outside a node card. */
export const CategoryDot = forwardRef<HTMLSpanElement, CategoryDotProps>(function CategoryDot(
  { category, size = 8, withLabel = false, hollow = false, className, style, ...rest },
  ref,
) {
  const dotStyle = {
    width: size,
    height: size,
    backgroundColor: hollow ? undefined : categoryVar(category),
    borderColor: hollow ? categoryVar(category) : undefined,
  };
  const dotClass = cn(
    "inline-block shrink-0 rounded-full",
    hollow && "border-[1.5px] bg-transparent",
  );

  if (!withLabel) {
    return (
      <span
        ref={ref}
        role="img"
        aria-label={CATEGORY_LABEL[category]}
        data-category={category}
        className={cn(dotClass, className)}
        style={{ ...dotStyle, ...style }}
        {...rest}
      />
    );
  }
  return (
    <span
      ref={ref}
      data-category={category}
      className={cn("inline-flex items-center gap-1.5 text-xs text-ink-2", className)}
      style={style}
      {...rest}
    >
      <span aria-hidden="true" className={dotClass} style={dotStyle} />
      {CATEGORY_LABEL[category]}
    </span>
  );
});
