import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ComponentRef,
  type ReactNode,
} from "react";
import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

export const CollapsibleRoot = CollapsiblePrimitive.Root;

export type CollapsibleTriggerProps = ComponentPropsWithoutRef<
  typeof CollapsiblePrimitive.Trigger
> & {
  /** Hide the rotating chevron. */
  noChevron?: boolean;
  /** Mono text at the right edge (a count). */
  meta?: ReactNode;
};

/** 28px trigger row with a chevron that rotates 90° when open. */
export const CollapsibleTrigger = forwardRef<
  ComponentRef<typeof CollapsiblePrimitive.Trigger>,
  CollapsibleTriggerProps
>(function CollapsibleTrigger({ className, children, noChevron = false, meta, ...rest }, ref) {
  return (
    <CollapsiblePrimitive.Trigger
      ref={ref}
      className={cn(
        "group/collapsible flex h-7 w-full cursor-pointer items-center gap-1.5 rounded-xs px-1 text-left text-xs font-medium text-ink-2",
        "transition-colors duration-(--dur-fast) hover:bg-surface-3 hover:text-ink data-[state=open]:text-ink",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...rest}
    >
      {noChevron ? null : (
        <ChevronRight
          className="size-3.5 shrink-0 text-ink-3 transition-transform duration-(--dur-fast) ease-(--ease-out) group-data-[state=open]/collapsible:rotate-90"
          strokeWidth={1.75}
          aria-hidden="true"
        />
      )}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {meta !== undefined ? (
        <span className="shrink-0 font-mono text-2xs font-normal text-ink-3 tabular">{meta}</span>
      ) : null}
    </CollapsiblePrimitive.Trigger>
  );
});

export type CollapsibleContentProps = ComponentPropsWithoutRef<typeof CollapsiblePrimitive.Content>;

/** Animated content region (height from 0 to the measured content height). */
export const CollapsibleContent = forwardRef<
  ComponentRef<typeof CollapsiblePrimitive.Content>,
  CollapsibleContentProps
>(function CollapsibleContent({ className, children, ...rest }, ref) {
  return (
    <CollapsiblePrimitive.Content ref={ref} className="fa-collapsible overflow-hidden" {...rest}>
      <div className={cn("pb-1 pt-1", className)}>{children}</div>
    </CollapsiblePrimitive.Content>
  );
});

export interface CollapsibleProps extends Omit<
  ComponentPropsWithoutRef<typeof CollapsiblePrimitive.Root>,
  "title"
> {
  /** Trigger label. Omit to compose with CollapsibleTrigger/CollapsibleContent yourself. */
  title?: ReactNode;
  meta?: ReactNode;
  contentClassName?: string;
}

/**
 * Disclosure section: `<Collapsible title="Advanced">…</Collapsible>`.
 * For custom triggers use `CollapsibleRoot` + `CollapsibleTrigger` + `CollapsibleContent`.
 */
export const Collapsible = forwardRef<
  ComponentRef<typeof CollapsiblePrimitive.Root>,
  CollapsibleProps
>(function Collapsible({ title, meta, contentClassName, className, children, ...rest }, ref) {
  if (title === undefined) {
    return (
      <CollapsiblePrimitive.Root ref={ref} className={cn("min-w-0", className)} {...rest}>
        {children}
      </CollapsiblePrimitive.Root>
    );
  }
  return (
    <CollapsiblePrimitive.Root ref={ref} className={cn("min-w-0", className)} {...rest}>
      <CollapsibleTrigger meta={meta}>{title}</CollapsibleTrigger>
      <CollapsibleContent className={cn("pl-6", contentClassName)}>{children}</CollapsibleContent>
    </CollapsiblePrimitive.Root>
  );
});
