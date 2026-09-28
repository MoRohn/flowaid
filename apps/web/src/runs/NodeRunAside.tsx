"use client";
/**
 * Where the trace viewer shows the selected node run: a 380px column beside the tab at `lg` and
 * up, a sheet below it (as the builder's inspector does in compact mode), so a tap on a node in
 * the timeline or graph leads somewhere on a narrow window too.
 */
import type { ReactNode } from "react";
import { Sheet, SheetContent, SheetTitle } from "@flowaid/ui/primitives";
import { BELOW_LG, useMediaQuery } from "~/shell/useMediaQuery";

export function NodeRunAside({
  label,
  onClose,
  children,
}: {
  /** The sheet's accessible title, e.g. "Node run Classify". */
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const narrow = useMediaQuery(BELOW_LG);
  if (narrow)
    return (
      <Sheet open onOpenChange={(open) => !open && onClose()}>
        {/* the panel draws its own close button */}
        <SheetContent
          side="right"
          width={420}
          hideClose
          className="p-0"
          aria-describedby={undefined}
        >
          <SheetTitle className="sr-only">{label}</SheetTitle>
          {children}
        </SheetContent>
      </Sheet>
    );
  return <div className="w-[380px] shrink-0 border-l border-border bg-surface">{children}</div>;
}
