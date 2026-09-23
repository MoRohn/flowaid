import { useMemo, useState } from "react";
import { Command as Cmdk } from "cmdk";
import { ArrowRight, Cable } from "lucide-react";
import { cn } from "@/lib/cn";
import { Kbd, Popover, PopoverAnchor, PopoverContent } from "@/primitives";
import type { ConnectionOption } from "./useConnectionValidation";
import "./canvas.css";

export interface ConnectPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Client (screen) point to anchor the list at, usually the focused node's bottom-left corner. */
  anchor: { x: number; y: number } | null;
  /** Name of the node the connection starts at. */
  sourceName: string;
  /** Compatible connections from `useConnectionValidation().connectionOptionsFrom`. */
  options: readonly ConnectionOption[];
  /** Called with the chosen connection; its handle ids are the prefixed ones (`out:`/`ctl:` → `in:`/`ctl-in`). */
  onPick: (option: ConnectionOption) => void;
  /** Where focus goes when the list closes (the node it was opened from). */
  returnFocusTo?: HTMLElement | null;
  className?: string;
}

/** Stable cmdk value for an option. */
function optionValue(o: ConnectionOption): string {
  return `${o.sourceHandle}→${o.target}:${o.targetHandle}`;
}

/**
 * Keyboard connect mode (UI.md §9): a searchable list of every connection the focused
 * node can make, from `useConnectionValidation` (same rules as a pointer drag: schema
 * compatibility, control scope, no duplicates). Opened with C on a focused node; arrows
 * move, Enter connects, Escape closes and focus returns to the node.
 */
export function ConnectPicker({
  open,
  onOpenChange,
  anchor,
  sourceName,
  options,
  onPick,
  returnFocusTo,
  className,
}: ConnectPickerProps) {
  const [query, setQuery] = useState("");
  const groups = useMemo(
    () =>
      [
        { id: "control", heading: "Control", items: options.filter((o) => o.family === "control") },
        { id: "data", heading: "Data", items: options.filter((o) => o.family === "data") },
      ].filter((g) => g.items.length > 0),
    [options],
  );
  const label = `Connect ${sourceName} to`;
  const anchorStyle = anchor
    ? { position: "fixed" as const, left: anchor.x, top: anchor.y, width: 0, height: 0 }
    : { position: "absolute" as const, left: "50%", top: "40%", width: 0, height: 0 };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverAnchor asChild>
        <span aria-hidden="true" style={anchorStyle} />
      </PopoverAnchor>
      <PopoverContent
        bare
        width={360}
        side="bottom"
        align="start"
        sideOffset={6}
        className={cn("overflow-hidden", className)}
        aria-label={label}
        onCloseAutoFocus={(event) => {
          if (!returnFocusTo) return;
          event.preventDefault();
          returnFocusTo.focus({ preventScroll: true });
        }}
      >
        <Cmdk label={label} loop className="fa-palette flex min-h-0 flex-col">
          <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
            <Cable className="size-4 shrink-0 text-ink-3" strokeWidth={1.75} aria-hidden="true" />
            <Cmdk.Input
              value={query}
              onValueChange={setQuery}
              placeholder={`${label}…`}
              className="h-full min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3 focus-visible:shadow-none"
            />
            <Kbd size="sm">Esc</Kbd>
          </div>
          <Cmdk.List className="max-h-[min(360px,50vh)] min-h-0 overflow-y-auto overscroll-contain p-1">
            <Cmdk.Empty className="px-2 py-6 text-center text-xs text-ink-3">
              {options.length === 0 ? "No compatible target on this canvas." : "No target matches."}
            </Cmdk.Empty>
            {groups.map((group) => (
              <Cmdk.Group
                key={group.id}
                heading={group.heading}
                className="[&_[cmdk-group-heading]]:text-eyebrow [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2"
              >
                {group.items.map((o) => (
                  <Cmdk.Item
                    key={optionValue(o)}
                    value={optionValue(o)}
                    keywords={[o.sourceLabel, o.targetName, o.targetLabel, o.target]}
                    onSelect={() => {
                      onPick(o);
                      onOpenChange(false);
                    }}
                    className={cn(
                      "relative flex h-8 cursor-default select-none items-center gap-2 rounded-xs px-2 text-xs text-ink outline-none",
                      "data-[selected=true]:bg-surface-3",
                    )}
                  >
                    <span className="max-w-[35%] shrink-0 truncate font-mono text-ink-2">
                      {o.sourceLabel}
                    </span>
                    <ArrowRight
                      className="size-3 shrink-0 text-ink-3"
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {o.targetName}
                      <span className="text-ink-3"> · </span>
                      <span className="font-mono text-ink-2">{o.targetLabel}</span>
                    </span>
                    {o.verified ? null : (
                      <span className="shrink-0 font-mono text-2xs text-warn-text">unverified</span>
                    )}
                  </Cmdk.Item>
                ))}
              </Cmdk.Group>
            ))}
          </Cmdk.List>
        </Cmdk>
      </PopoverContent>
    </Popover>
  );
}
