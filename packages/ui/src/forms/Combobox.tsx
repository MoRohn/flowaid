import { forwardRef, useId, useMemo, useState } from "react";
import { Command as Cmdk } from "cmdk";
import { Check, ChevronDown, RefreshCw, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  Button,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Spinner,
  useFieldControl,
} from "@/primitives";

/** One option, the shape an option provider returns (CONTRACTS.ts §16 `OptionItem`, `POST /v1/nodes/:type/options/:name`). */
export interface OptionItem {
  value: string;
  label: string;
  description?: string;
  group?: string;
}

export interface ComboboxProps {
  options: readonly OptionItem[];
  value?: string | null;
  onValueChange?: (value: string, option: OptionItem | undefined) => void;
  /** Options are being (re)loaded: the trigger and the list show a spinner. */
  loading?: boolean;
  /** Last load failed: shown under the trigger with a retry action. */
  error?: string | null;
  /** Shows a refresh button next to the trigger (and the retry action on error). */
  onRefresh?: () => void;
  /** Fired as the person types in the search box (server-side search). */
  onSearchChange?: (search: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  className?: string;
  onBlur?: () => void;
  /** Width of the popover in px. */
  width?: number;
  "aria-label"?: string;
  "aria-describedby"?: string;
}

function groupOptions(
  options: readonly OptionItem[],
): Array<{ group: string | null; options: OptionItem[] }> {
  const groups = new Map<string | null, OptionItem[]>();
  for (const option of options) {
    const key = option.group ?? null;
    const list = groups.get(key) ?? [];
    list.push(option);
    groups.set(key, list);
  }
  return [...groups.entries()].map(([group, list]) => ({ group, options: list }));
}

/**
 * Searchable single-select over a (possibly remote) option list: a trigger
 * opening a command list, an optional refresh button, and loading / error
 * states. `SchemaForm` uses it for `x-ui.optionsProvider` fields and for the
 * `combobox` widget; a value missing from `options` still shows (mono) so a
 * saved config reads correctly before the first load.
 */
export const Combobox = forwardRef<HTMLButtonElement, ComboboxProps>(function Combobox(
  {
    options,
    value,
    onValueChange,
    loading = false,
    error,
    onRefresh,
    onSearchChange,
    placeholder = "Choose…",
    searchPlaceholder = "Search options",
    disabled,
    invalid,
    id,
    className,
    onBlur,
    width = 320,
    "aria-label": ariaLabel,
    "aria-describedby": ariaDescribedBy,
  },
  ref,
) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const popupId = useId();
  const errorId = useId();
  const field = useFieldControl({
    id,
    disabled,
    "aria-invalid": invalid,
    "aria-describedby": ariaDescribedBy,
  });
  const groups = useMemo(() => groupOptions(options), [options]);
  const selected = options.find((o) => o.value === value);
  const describedBy =
    [field["aria-describedby"], error ? errorId : undefined].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <div className="flex min-w-0 items-center gap-1">
        <Popover
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) onBlur?.();
          }}
        >
          <PopoverTrigger asChild>
            <button
              ref={ref}
              type="button"
              role="combobox"
              aria-expanded={open}
              aria-controls={open ? popupId : undefined}
              aria-haspopup="listbox"
              aria-label={ariaLabel}
              aria-busy={loading || undefined}
              id={field.id}
              disabled={field.disabled}
              aria-invalid={field["aria-invalid"]}
              aria-describedby={describedBy}
              aria-required={field["aria-required"]}
              className={cn(
                "group flex h-7 w-full min-w-0 items-center gap-2 rounded-sm border border-border bg-surface px-2 text-left text-sm text-ink shadow-1",
                "transition-[border-color,box-shadow,background-color] duration-(--dur-fast) ease-(--ease-out)",
                "hover:bg-surface-3 data-[state=open]:border-accent",
                "disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-4 disabled:shadow-none",
                "aria-invalid:border-danger",
              )}
            >
              {selected ? (
                <span className="min-w-0 flex-1 truncate">{selected.label}</span>
              ) : value ? (
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{value}</span>
              ) : loading ? (
                <span className="min-w-0 flex-1 truncate text-ink-3">Loading options…</span>
              ) : (
                <span className="min-w-0 flex-1 truncate text-ink-3">{placeholder}</span>
              )}
              {loading ? (
                <Spinner size="xs" label="Loading options" className="text-ink-3" />
              ) : null}
              <ChevronDown
                className="size-4 shrink-0 text-ink-3 transition-transform duration-(--dur-fast) group-data-[state=open]:rotate-180"
                strokeWidth={1.75}
                aria-hidden="true"
              />
            </button>
          </PopoverTrigger>
          <PopoverContent
            id={popupId}
            bare
            width={width}
            className="flex max-h-[min(360px,60vh)] flex-col overflow-hidden"
          >
            <Cmdk label={ariaLabel ?? "Options"} loop className="flex min-h-0 flex-col">
              <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-2.5">
                <Search
                  className="size-4 shrink-0 text-ink-3"
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
                <Cmdk.Input
                  value={search}
                  onValueChange={(next) => {
                    setSearch(next);
                    onSearchChange?.(next);
                  }}
                  placeholder={searchPlaceholder}
                  className="h-full min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3 focus-visible:shadow-none"
                />
              </div>
              <Cmdk.List className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1 [scrollbar-width:thin]">
                {loading ? (
                  <Cmdk.Loading className="flex items-center justify-center gap-2 py-6 text-xs text-ink-3">
                    <Spinner size="xs" label="Loading options" /> Loading options…
                  </Cmdk.Loading>
                ) : null}
                {!loading ? (
                  <Cmdk.Empty className="py-6 text-center text-xs text-ink-3">
                    {options.length === 0 ? "No options available." : "No option matches."}
                  </Cmdk.Empty>
                ) : null}
                {groups.map((g) => (
                  <Cmdk.Group
                    key={g.group ?? "__ungrouped"}
                    heading={g.group ?? undefined}
                    className="[&_[cmdk-group-heading]]:text-eyebrow [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2"
                  >
                    {g.options.map((option) => (
                      <Cmdk.Item
                        key={option.value}
                        value={option.value}
                        keywords={[option.label, option.description ?? ""]}
                        onSelect={() => {
                          onValueChange?.(option.value, option);
                          setOpen(false);
                        }}
                        className="relative flex min-h-8 cursor-default select-none items-center gap-2 rounded-xs px-2 py-1 text-sm text-ink outline-none data-[selected=true]:bg-surface-3"
                      >
                        <span className="flex min-w-0 flex-1 flex-col leading-tight">
                          <span className="truncate">{option.label}</span>
                          {option.description ? (
                            <span className="truncate text-2xs text-ink-3">
                              {option.description}
                            </span>
                          ) : null}
                        </span>
                        {option.value === value ? (
                          <Check
                            className="size-3.5 shrink-0 text-accent"
                            strokeWidth={2.25}
                            aria-hidden="true"
                          />
                        ) : null}
                      </Cmdk.Item>
                    ))}
                  </Cmdk.Group>
                ))}
              </Cmdk.List>
            </Cmdk>
          </PopoverContent>
        </Popover>
        {onRefresh ? (
          <IconButton
            label="Refresh options"
            size="sm"
            variant="ghost"
            disabled={field.disabled || loading}
            onClick={onRefresh}
            className="shrink-0"
          >
            <RefreshCw
              strokeWidth={1.75}
              className={cn(loading && "animate-spin motion-reduce:[animation-duration:2.4s]")}
            />
          </IconButton>
        ) : null}
      </div>
      {error ? (
        <div
          id={errorId}
          role="alert"
          className="flex min-w-0 items-center gap-2 text-xs text-danger-text"
        >
          <span className="min-w-0 flex-1 truncate">Could not load options: {error}</span>
          {onRefresh ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={onRefresh}
              disabled={field.disabled || loading}
            >
              Retry
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});
