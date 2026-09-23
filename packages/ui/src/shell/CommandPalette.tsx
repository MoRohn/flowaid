import type { ReactNode } from "react";
import { Command as Cmdk } from "cmdk";
import { CornerDownLeft, Search } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/cn";
import { Dialog, DialogContent, Kbd, Shortcut, Spinner, useControllableState } from "@/primitives";

export interface CommandItemView {
  id: string;
  label: string;
  description?: string;
  icon?: ReactNode;
  /** Shortcut string, e.g. "mod+shift+p". */
  shortcut?: string;
  /** Extra search terms. */
  keywords?: string[];
  disabled?: boolean;
  /** Mono text at the right edge (a kind, a count). */
  meta?: string;
  onSelect?: () => void;
}

export interface CommandGroupView {
  id: string;
  heading?: string;
  items: CommandItemView[];
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: CommandGroupView[];
  /** Fired for any item, after the item's own onSelect. The palette closes unless `keepOpen`. */
  onSelect?: (item: CommandItemView) => void;
  keepOpen?: boolean;
  placeholder?: string;
  /** Controlled search text. */
  search?: string;
  onSearchChange?: (search: string) => void;
  loading?: boolean;
  emptyText?: string;
  /** Replaces the default footer hints. */
  footer?: ReactNode;
  /** Disable cmdk's fuzzy filter when the parent filters (server-side search). */
  shouldFilter?: boolean;
  className?: string;
  /** Accessible name for the dialog. */
  label?: string;
}

/**
 * The list surface behind `CommandMenu`: a Dialog anchored near the top with
 * a cmdk list. Internal to the shell group; apps use `CommandMenu`.
 * Grouped items
 * with icon, description, shortcut and mono meta; arrow keys move, Enter
 * selects, Escape closes. Data-driven so the app owns the command registry.
 */
export function CommandPalette({
  open,
  onOpenChange,
  groups,
  onSelect,
  keepOpen = false,
  placeholder = "Type a command or search…",
  search,
  onSearchChange,
  loading = false,
  emptyText = "No results.",
  footer,
  shouldFilter = true,
  className,
  label = "Command palette",
}: CommandPaletteProps) {
  const [query, setQuery] = useControllableState(search, "", onSearchChange);

  const select = (item: CommandItemView) => {
    item.onSelect?.();
    onSelect?.(item);
    if (!keepOpen) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="md"
        hideClose
        placement="top"
        className={cn("overflow-hidden p-0", className)}
        onCloseAutoFocus={() => {
          if (!keepOpen) setQuery("");
        }}
      >
        <DialogPrimitive.Title className="sr-only">{label}</DialogPrimitive.Title>
        <DialogPrimitive.Description className="sr-only">
          Search commands and jump to items. Use arrow keys to navigate.
        </DialogPrimitive.Description>
        <Cmdk label={label} shouldFilter={shouldFilter} loop className="flex min-h-0 flex-col">
          <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
            {loading ? (
              <Spinner size="sm" className="text-ink-3" label="Searching" />
            ) : (
              <Search
                className="size-4 shrink-0 text-ink-3"
                strokeWidth={1.75}
                aria-hidden="true"
              />
            )}
            <Cmdk.Input
              value={query}
              onValueChange={setQuery}
              placeholder={placeholder}
              className="h-full min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3 focus-visible:shadow-none"
            />
            <Kbd className="hidden sm:inline-flex">Esc</Kbd>
          </div>
          <Cmdk.List className="max-h-[min(360px,50vh)] min-h-0 overflow-y-auto overscroll-contain p-1 [scrollbar-width:thin]">
            {loading && groups.length === 0 ? (
              <Cmdk.Loading>
                <div className="flex items-center justify-center gap-2 py-8 text-xs text-ink-3">
                  <Spinner size="sm" />
                  Loading commands
                </div>
              </Cmdk.Loading>
            ) : null}
            <Cmdk.Empty className="py-8 text-center text-xs text-ink-3">{emptyText}</Cmdk.Empty>
            {groups.map((group) => (
              <Cmdk.Group
                key={group.id}
                heading={group.heading}
                className="[&_[cmdk-group-heading]]:text-eyebrow [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2"
              >
                {group.items.map((item) => (
                  <Cmdk.Item
                    key={item.id}
                    value={`${group.id}:${item.id}`}
                    keywords={[
                      item.label,
                      ...(item.description ? [item.description] : []),
                      ...(item.keywords ?? []),
                    ]}
                    disabled={item.disabled}
                    onSelect={() => select(item)}
                    className={cn(
                      "relative flex cursor-default select-none items-center gap-2.5 rounded-xs px-2 text-sm text-ink outline-none",
                      "data-[selected=true]:bg-surface-3 data-[disabled=true]:pointer-events-none data-[disabled=true]:text-ink-4",
                      item.description ? "min-h-10 py-1.5" : "h-8",
                    )}
                  >
                    <span className="flex size-4 shrink-0 items-center justify-center text-ink-3 [&_svg]:size-4">
                      {item.icon}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col leading-tight">
                      <span className="truncate">{item.label}</span>
                      {item.description ? (
                        <span className="mt-0.5 truncate text-2xs text-ink-3">
                          {item.description}
                        </span>
                      ) : null}
                    </span>
                    {item.meta ? (
                      <span className="shrink-0 font-mono text-2xs text-ink-3 tabular">
                        {item.meta}
                      </span>
                    ) : null}
                    {item.shortcut ? (
                      <Shortcut shortcut={item.shortcut} separate size="sm" />
                    ) : null}
                  </Cmdk.Item>
                ))}
              </Cmdk.Group>
            ))}
          </Cmdk.List>
          <div className="flex h-8 shrink-0 items-center gap-3 border-t border-border bg-surface-2 px-3 text-2xs text-ink-3">
            {footer ?? (
              <>
                <span className="flex items-center gap-1">
                  <Kbd size="sm">↑</Kbd>
                  <Kbd size="sm">↓</Kbd>
                  <span className="ml-0.5">Navigate</span>
                </span>
                <span className="flex items-center gap-1">
                  <Kbd size="sm">
                    <CornerDownLeft className="size-2.5" aria-hidden="true" />
                  </Kbd>
                  <span className="ml-0.5">Select</span>
                </span>
                <span className="ml-auto font-mono">
                  {groups.reduce((n, g) => n + g.items.length, 0)} commands
                </span>
              </>
            )}
          </div>
        </Cmdk>
      </DialogContent>
    </Dialog>
  );
}
