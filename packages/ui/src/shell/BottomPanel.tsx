import { forwardRef } from "react";
import { BottomPanel as BuilderBottomPanel, type BottomPanelProps } from "@/builder/BottomPanel";
import { useAppShellOptional } from "./AppShellContext";

export type { BottomPanelProps, BottomPanelTab } from "@/builder/BottomPanel";

/**
 * `BottomPanel` moved to `@flowaid/ui/builder` (P0-15). This shell-side
 * wrapper keeps the old import path for one release and wires the panel to
 * the `AppShell` state (expanded, close) when it renders inside one.
 * @deprecated import `BottomPanel` from `@flowaid/ui/builder` and pass
 * `expanded` / `onExpandedChange` / `onClose` from the shell yourself.
 */
export const BottomPanel = forwardRef<HTMLElement, BottomPanelProps>(function BottomPanel(
  { expanded, onExpandedChange, onClose, ...rest },
  ref,
) {
  const shell = useAppShellOptional();
  const resolvedExpanded = expanded ?? shell?.bottomExpanded;
  const resolvedOnExpandedChange = (next: boolean) => {
    onExpandedChange?.(next);
    if (expanded === undefined && shell) shell.setBottomExpanded(next);
  };
  const resolvedOnClose = onClose ?? (shell ? () => shell.setBottomOpen(false) : undefined);
  return (
    <BuilderBottomPanel
      ref={ref}
      expanded={resolvedExpanded}
      onExpandedChange={resolvedOnExpandedChange}
      onClose={resolvedOnClose}
      {...rest}
    />
  );
});
