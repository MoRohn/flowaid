import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ComponentRef,
  type ReactNode,
} from "react";
import * as SeparatorPrimitive from "@radix-ui/react-separator";
import { cn } from "@/lib/cn";

export interface SeparatorProps extends ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root> {
  /** Text centred on the line (horizontal only). */
  label?: ReactNode;
}

/** 1px rule in the border token. Horizontal by default; `label` renders an eyebrow in the middle. */
export const Separator = forwardRef<ComponentRef<typeof SeparatorPrimitive.Root>, SeparatorProps>(
  function Separator(
    { className, orientation = "horizontal", decorative = true, label, ...rest },
    ref,
  ) {
    if (label && orientation === "horizontal") {
      return (
        <div
          role={decorative ? "none" : "separator"}
          className={cn("flex w-full items-center gap-3", className)}
        >
          <span className="h-px flex-1 bg-border" />
          <span className="text-eyebrow shrink-0">{label}</span>
          <span className="h-px flex-1 bg-border" />
        </div>
      );
    }
    return (
      <SeparatorPrimitive.Root
        ref={ref}
        orientation={orientation}
        decorative={decorative}
        className={cn(
          "shrink-0 bg-border",
          orientation === "horizontal" ? "h-px w-full" : "h-full min-h-4 w-px self-stretch",
          className,
        )}
        {...rest}
      />
    );
  },
);
