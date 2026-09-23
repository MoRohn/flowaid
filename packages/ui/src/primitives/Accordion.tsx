import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ComponentRef,
  type ReactNode,
} from "react";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

export type AccordionProps = ComponentPropsWithoutRef<typeof AccordionPrimitive.Root> & {
  /** Draw a border around the whole list and between items. */
  bordered?: boolean;
};

/**
 * Compact accordion (32px triggers). `type="single" collapsible` or
 * `type="multiple"`; compose with `AccordionItem`.
 */
export const Accordion = forwardRef<ComponentRef<typeof AccordionPrimitive.Root>, AccordionProps>(
  function Accordion({ className, bordered = false, ...rest }, ref) {
    return (
      <AccordionPrimitive.Root
        ref={ref}
        className={cn(
          "min-w-0",
          bordered
            ? "divide-y divide-border rounded-md border border-border bg-surface"
            : "divide-y divide-border",
          className,
        )}
        {...rest}
      />
    );
  },
);

export interface AccordionItemProps extends Omit<
  ComponentPropsWithoutRef<typeof AccordionPrimitive.Item>,
  "title"
> {
  title: ReactNode;
  icon?: ReactNode;
  /** Mono text at the right edge (a count, a status). */
  meta?: ReactNode;
  contentClassName?: string;
}

export const AccordionItem = forwardRef<
  ComponentRef<typeof AccordionPrimitive.Item>,
  AccordionItemProps
>(function AccordionItem(
  { className, title, icon, meta, contentClassName, children, ...rest },
  ref,
) {
  return (
    <AccordionPrimitive.Item ref={ref} className={cn("min-w-0", className)} {...rest}>
      <AccordionPrimitive.Header className="flex">
        <AccordionPrimitive.Trigger
          className={cn(
            "group/accordion flex h-8 w-full cursor-pointer items-center gap-2 px-3 text-left text-xs font-medium text-ink-2",
            "transition-colors duration-(--dur-fast) hover:bg-surface-2 hover:text-ink data-[state=open]:text-ink",
            "focus-visible:relative focus-visible:z-10 disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          {icon ? (
            <span className="flex shrink-0 items-center text-ink-3 [&_svg]:size-4">{icon}</span>
          ) : null}
          <span className="min-w-0 flex-1 truncate">{title}</span>
          {meta !== undefined ? (
            <span className="shrink-0 font-mono text-2xs font-normal text-ink-3 tabular">
              {meta}
            </span>
          ) : null}
          <ChevronDown
            className="size-3.5 shrink-0 text-ink-3 transition-transform duration-(--dur-base) ease-(--ease-out) group-data-[state=open]/accordion:rotate-180"
            strokeWidth={1.75}
            aria-hidden="true"
          />
        </AccordionPrimitive.Trigger>
      </AccordionPrimitive.Header>
      <AccordionPrimitive.Content className="fa-accordion overflow-hidden text-sm text-ink-2">
        <div className={cn("px-3 pb-3 pt-1", contentClassName)}>{children}</div>
      </AccordionPrimitive.Content>
    </AccordionPrimitive.Item>
  );
});
