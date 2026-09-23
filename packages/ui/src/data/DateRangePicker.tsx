import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type KeyboardEvent,
} from "react";
import {
  addDays,
  addMonths,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  isAfter,
  isBefore,
  isSameDay,
  isSameMonth,
  isValid,
  max as maxDate,
  min as minDate,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { Calendar, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button, IconButton, Popover, PopoverContent, PopoverTrigger } from "@/primitives";

// ---------------------------------------------------------------------------
// Values and presets
// ---------------------------------------------------------------------------

export type DateRangePresetKey = "15m" | "1h" | "24h" | "7d" | "30d";

export interface DateRangePreset {
  key: DateRangePresetKey;
  label: string;
  /** Window length in milliseconds. */
  ms: number;
}

export const DATE_RANGE_PRESETS: readonly DateRangePreset[] = [
  { key: "15m", label: "Last 15 minutes", ms: 15 * 60 * 1000 },
  { key: "1h", label: "Last hour", ms: 60 * 60 * 1000 },
  { key: "24h", label: "Last 24 hours", ms: 24 * 60 * 60 * 1000 },
  { key: "7d", label: "Last 7 days", ms: 7 * 24 * 60 * 60 * 1000 },
  { key: "30d", label: "Last 30 days", ms: 30 * 24 * 60 * 60 * 1000 },
];

/**
 * Serialisable range: a rolling preset, or a fixed custom window with ISO
 * timestamps. Resolve to concrete dates with `resolveDateRange`.
 */
export type DateRangeValue =
  { preset: DateRangePresetKey } | { preset: "custom"; from: string; to: string };

export interface ResolvedDateRange {
  from: Date;
  to: Date;
}

export function isDateRangePresetKey(key: string): key is DateRangePresetKey {
  return DATE_RANGE_PRESETS.some((p) => p.key === key);
}

/** Concrete `[from, to]` for a value at `now`. Custom windows are clamped so from <= to. */
export function resolveDateRange(value: DateRangeValue, now: Date = new Date()): ResolvedDateRange {
  if (value.preset !== "custom") {
    const preset = DATE_RANGE_PRESETS.find((p) => p.key === value.preset);
    const ms = preset?.ms ?? 24 * 60 * 60 * 1000;
    return { from: new Date(now.getTime() - ms), to: now };
  }
  const a = parseISO(value.from);
  const b = parseISO(value.to);
  const from = isValid(a) ? a : now;
  const to = isValid(b) ? b : now;
  return isAfter(from, to) ? { from: to, to: from } : { from, to };
}

/** Build a custom value from two days (inclusive, whole days). */
export function customDateRange(from: Date, to: Date): DateRangeValue {
  const [a, b] = isAfter(from, to) ? [to, from] : [from, to];
  return { preset: "custom", from: startOfDay(a).toISOString(), to: endOfDay(b).toISOString() };
}

/** Human label for a value: "Last 7 days" or "1 Sep – 22 Sep 2026". */
export function formatDateRangeLabel(value: DateRangeValue | null | undefined): string {
  if (!value) return "Any time";
  if (value.preset !== "custom") {
    return DATE_RANGE_PRESETS.find((p) => p.key === value.preset)?.label ?? "Custom";
  }
  const { from, to } = resolveDateRange(value);
  if (isSameDay(from, to)) return format(from, "d MMM yyyy");
  const sameYear = from.getFullYear() === to.getFullYear();
  return `${format(from, sameYear ? "d MMM" : "d MMM yyyy")} – ${format(to, "d MMM yyyy")}`;
}

/** "7d" or "2026-09-01T00:00:00.000Z..2026-09-22T23:59:59.999Z" — for query strings. */
export function serializeDateRangeValue(value: DateRangeValue): string {
  return value.preset === "custom" ? `${value.from}..${value.to}` : value.preset;
}

export function parseDateRangeValue(input: string | null | undefined): DateRangeValue | undefined {
  if (!input) return undefined;
  if (isDateRangePresetKey(input)) return { preset: input };
  const sep = input.indexOf("..");
  if (sep <= 0) return undefined;
  const from = parseISO(input.slice(0, sep));
  const to = parseISO(input.slice(sep + 2));
  if (!isValid(from) || !isValid(to)) return undefined;
  return { preset: "custom", from: from.toISOString(), to: to.toISOString() };
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

export interface DayRange {
  from: Date;
  to?: Date;
}

export interface RangeCalendarProps extends Omit<HTMLAttributes<HTMLDivElement>, "onSelect"> {
  /** Selected days (inclusive). */
  value?: DayRange | null;
  /** Fires on every click: first the start (`to` undefined), then the full range. */
  onSelect?: (range: DayRange) => void;
  /** Months shown side by side. */
  months?: 1 | 2;
  /** First visible month; defaults to the month before `today` so two months end at today. */
  initialMonth?: Date;
  /** Days after this are disabled. Defaults to today. */
  maxDate?: Date;
  minDate?: Date;
  /** The reference "today". */
  today?: Date;
  /** 0 = Sunday, 1 = Monday (default). */
  weekStartsOn?: 0 | 1;
}

interface MonthGrid {
  month: Date;
  weeks: Date[][];
}

function buildMonth(month: Date, weekStartsOn: 0 | 1): MonthGrid {
  const start = startOfWeek(startOfMonth(month), { weekStartsOn });
  const end = endOfWeek(endOfMonth(month), { weekStartsOn });
  const weeks: Date[][] = [];
  let cursor = start;
  while (!isAfter(cursor, end)) {
    const week: Date[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(cursor);
      cursor = addDays(cursor, 1);
    }
    weeks.push(week);
  }
  return { month, weeks };
}

function inRange(day: Date, from: Date, to: Date): boolean {
  const a = startOfDay(from);
  const b = startOfDay(to);
  const d = startOfDay(day);
  return !isBefore(d, minDate([a, b])) && !isAfter(d, maxDate([a, b]));
}

/**
 * Compact two-month range calendar with no dependencies beyond date-fns.
 * Roving focus: arrows move by day/week, PageUp/PageDown by month, Home/End
 * to the week edges, Enter/Space selects. Hovering previews the range.
 */
export const RangeCalendar = forwardRef<HTMLDivElement, RangeCalendarProps>(function RangeCalendar(
  {
    value,
    onSelect,
    months = 2,
    initialMonth,
    maxDate: maxAllowed,
    minDate: minAllowed,
    today: todayProp,
    weekStartsOn = 1,
    className,
    ...rest
  },
  ref,
) {
  const today = useMemo(() => startOfDay(todayProp ?? new Date()), [todayProp]);
  const limit = maxAllowed ?? today;
  const anchorMonth = useMemo(() => {
    if (initialMonth) return startOfMonth(initialMonth);
    const base = value?.to ?? value?.from ?? today;
    return months === 2 ? startOfMonth(subMonths(base, 1)) : startOfMonth(base);
  }, [initialMonth, months, today, value?.from, value?.to]);

  const [viewMonth, setViewMonth] = useState(anchorMonth);
  const [pendingStart, setPendingStart] = useState<Date | null>(null);
  const [hovered, setHovered] = useState<Date | null>(null);
  const [focused, setFocused] = useState<Date>(() => startOfDay(value?.to ?? value?.from ?? today));
  const headingId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const setRootRef = useCallback(
    (node: HTMLDivElement | null) => {
      rootRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  useEffect(() => setViewMonth(anchorMonth), [anchorMonth]);

  const grids = useMemo(
    () =>
      Array.from({ length: months }, (_, i) => buildMonth(addMonths(viewMonth, i), weekStartsOn)),
    [viewMonth, months, weekStartsOn],
  );
  const lastVisible = endOfMonth(addMonths(viewMonth, months - 1));
  const firstVisible = startOfMonth(viewMonth);

  const isDisabled = (day: Date) =>
    isAfter(startOfDay(day), limit) ||
    (minAllowed ? isBefore(startOfDay(day), startOfDay(minAllowed)) : false);

  const preview: DayRange | null = pendingStart
    ? { from: pendingStart, to: hovered ?? focused }
    : (value ?? null);

  const pick = (day: Date) => {
    if (isDisabled(day)) return;
    setFocused(day);
    if (!pendingStart) {
      setPendingStart(day);
      onSelect?.({ from: day });
      return;
    }
    const [a, b] = isAfter(pendingStart, day) ? [day, pendingStart] : [pendingStart, day];
    setPendingStart(null);
    onSelect?.({ from: a, to: b });
  };

  const moveFocus = (target: Date) => {
    // Keep focus on a selectable day: clamp to the allowed window.
    let next = startOfDay(target);
    if (isAfter(next, limit)) next = limit;
    if (minAllowed && isBefore(next, startOfDay(minAllowed))) next = startOfDay(minAllowed);
    setFocused(next);
    if (isBefore(next, firstVisible)) setViewMonth(startOfMonth(next));
    else if (isAfter(next, lastVisible)) setViewMonth(startOfMonth(subMonths(next, months - 1)));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case "ArrowLeft":
        e.preventDefault();
        moveFocus(addDays(focused, -1));
        break;
      case "ArrowRight":
        e.preventDefault();
        moveFocus(addDays(focused, 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        moveFocus(addDays(focused, -7));
        break;
      case "ArrowDown":
        e.preventDefault();
        moveFocus(addDays(focused, 7));
        break;
      case "Home":
        e.preventDefault();
        moveFocus(startOfWeek(focused, { weekStartsOn }));
        break;
      case "End":
        e.preventDefault();
        moveFocus(endOfWeek(focused, { weekStartsOn }));
        break;
      case "PageUp":
        e.preventDefault();
        moveFocus(addMonths(focused, e.shiftKey ? -12 : -1));
        break;
      case "PageDown":
        e.preventDefault();
        moveFocus(addMonths(focused, e.shiftKey ? 12 : 1));
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        pick(focused);
        break;
      case "Escape":
        if (pendingStart) {
          e.preventDefault();
          e.stopPropagation();
          setPendingStart(null);
        }
        break;
      default:
        break;
    }
  };

  // Keep the focused day mounted and focused after keyboard navigation.
  useEffect(() => {
    const root = rootRef.current;
    const btn = root?.querySelector<HTMLButtonElement>(
      `[data-day="${format(focused, "yyyy-MM-dd")}"]`,
    );
    if (btn && root?.contains(document.activeElement) && document.activeElement !== btn)
      btn.focus();
  }, [focused]);

  const weekdayLabels = useMemo(() => {
    const start = startOfWeek(today, { weekStartsOn });
    return Array.from({ length: 7 }, (_, i) => format(addDays(start, i), "EEEEE"));
  }, [today, weekStartsOn]);

  const canGoNext = isBefore(lastVisible, limit);

  return (
    <div
      ref={setRootRef}
      role="presentation"
      className={cn("flex flex-col gap-2 select-none", className)}
      onKeyDown={onKeyDown}
      onMouseLeave={() => setHovered(null)}
      {...rest}
    >
      <div className="flex items-center justify-between">
        <IconButton
          size="sm"
          label="Previous month"
          onClick={() => setViewMonth((m) => subMonths(m, 1))}
        >
          <ChevronLeft strokeWidth={1.75} />
        </IconButton>
        <span id={headingId} className="text-xs font-medium text-ink" aria-live="polite">
          {months === 2
            ? `${format(viewMonth, "MMM yyyy")} – ${format(addMonths(viewMonth, 1), "MMM yyyy")}`
            : format(viewMonth, "MMMM yyyy")}
        </span>
        <IconButton
          size="sm"
          label="Next month"
          disabled={!canGoNext}
          onClick={() => setViewMonth((m) => addMonths(m, 1))}
        >
          <ChevronRight strokeWidth={1.75} />
        </IconButton>
      </div>
      <div
        className={cn("grid gap-4", months === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1")}
      >
        {grids.map((grid) => (
          <table
            key={grid.month.toISOString()}
            role="grid"
            aria-label={format(grid.month, "MMMM yyyy")}
            className="w-full border-collapse"
          >
            <caption className="pb-1 text-left text-2xs font-medium text-ink-3">
              {format(grid.month, "MMMM yyyy")}
            </caption>
            <thead>
              <tr>
                {weekdayLabels.map((d, i) => (
                  <th
                    key={i}
                    scope="col"
                    className="h-6 w-7 text-center font-mono text-2xs font-normal uppercase text-ink-3"
                  >
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.weeks.map((week, wi) => (
                <tr key={wi}>
                  {week.map((day) => {
                    const outside = !isSameMonth(day, grid.month);
                    const disabled = isDisabled(day);
                    const isFrom = preview ? isSameDay(day, preview.from) : false;
                    const isTo = preview?.to ? isSameDay(day, preview.to) : false;
                    const between =
                      preview?.to && !outside
                        ? inRange(day, preview.from, preview.to) && !isFrom && !isTo
                        : false;
                    const isFocused = isSameDay(day, focused);
                    const isToday = isSameDay(day, today);
                    return (
                      <td
                        key={day.toISOString()}
                        role="gridcell"
                        className="p-0"
                        aria-selected={isFrom || isTo || between || undefined}
                      >
                        {outside ? (
                          <span className="block size-7" aria-hidden="true" />
                        ) : (
                          <button
                            type="button"
                            data-day={format(day, "yyyy-MM-dd")}
                            tabIndex={isFocused ? 0 : -1}
                            disabled={disabled}
                            aria-label={format(day, "EEEE d MMMM yyyy")}
                            aria-pressed={isFrom || isTo || undefined}
                            onClick={() => pick(day)}
                            onMouseEnter={() => setHovered(day)}
                            onFocus={() => setFocused(day)}
                            className={cn(
                              "relative flex size-7 w-full items-center justify-center font-mono text-xs tabular text-ink",
                              "transition-colors duration-(--dur-fast)",
                              "disabled:cursor-not-allowed disabled:text-ink-4",
                              between && "bg-accent-soft text-accent-text",
                              (isFrom || isTo) &&
                                "z-[1] rounded-sm bg-accent font-medium text-accent-ink",
                              isFrom &&
                                preview?.to &&
                                !isSameDay(preview.from, preview.to) &&
                                "rounded-r-none",
                              isTo && preview && !isSameDay(preview.from, day) && "rounded-l-none",
                              !isFrom && !isTo && !between && "rounded-sm hover:bg-surface-3",
                              isToday &&
                                !isFrom &&
                                !isTo &&
                                "after:absolute after:bottom-1 after:size-[3px] after:rounded-full after:bg-accent",
                            )}
                          >
                            {format(day, "d")}
                          </button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Panel and picker
// ---------------------------------------------------------------------------

export interface DateRangePanelProps extends Omit<HTMLAttributes<HTMLDivElement>, "onChange"> {
  value?: DateRangeValue | null;
  onChange?: (value: DateRangeValue | null) => void;
  presets?: readonly DateRangePreset[];
  now?: Date;
  /** Called after a preset or a complete custom range is chosen. */
  onDone?: () => void;
  clearable?: boolean;
}

/** The picker's content: preset list beside a two-month calendar. Also usable inline. */
export const DateRangePanel = forwardRef<HTMLDivElement, DateRangePanelProps>(
  function DateRangePanel(
    {
      value,
      onChange,
      presets = DATE_RANGE_PRESETS,
      now,
      onDone,
      clearable = true,
      className,
      ...rest
    },
    ref,
  ) {
    const today = useMemo(() => now ?? new Date(), [now]);
    const resolved = value ? resolveDateRange(value, today) : null;
    const custom = value?.preset === "custom";
    const [draft, setDraft] = useState<DayRange | null>(null);
    const dayRange: DayRange | null =
      draft ?? (custom && resolved ? { from: resolved.from, to: resolved.to } : null);

    return (
      <div ref={ref} className={cn("flex flex-col sm:flex-row", className)} {...rest}>
        <ul
          role="listbox"
          aria-label="Presets"
          className="flex shrink-0 flex-row flex-wrap gap-0.5 border-b border-border p-1.5 sm:w-40 sm:flex-col sm:border-b-0 sm:border-r"
        >
          {presets.map((p) => {
            const active = value?.preset === p.key;
            return (
              <li key={p.key}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    setDraft(null);
                    onChange?.({ preset: p.key });
                    onDone?.();
                  }}
                  className={cn(
                    "flex h-7 w-full items-center justify-between gap-2 rounded-xs px-2 text-left text-xs",
                    "transition-colors duration-(--dur-fast) hover:bg-surface-3",
                    active ? "bg-surface-3 font-medium text-ink" : "text-ink-2",
                  )}
                >
                  {p.label}
                  <span className="font-mono text-2xs text-ink-3 tabular">{p.key}</span>
                </button>
              </li>
            );
          })}
          <li>
            <span
              role="option"
              aria-selected={custom}
              className={cn(
                "flex h-7 items-center px-2 text-xs",
                custom ? "font-medium text-ink" : "text-ink-3",
              )}
            >
              Custom range
            </span>
          </li>
        </ul>
        <div className="flex min-w-0 flex-col gap-2 p-3">
          <RangeCalendar
            value={dayRange}
            today={today}
            onSelect={(r) => {
              if (!r.to) {
                setDraft(r);
                return;
              }
              setDraft(null);
              onChange?.(customDateRange(r.from, r.to));
              onDone?.();
            }}
          />
          <div className="flex items-center justify-between gap-3 border-t border-border pt-2">
            <span className="min-w-0 truncate font-mono text-2xs text-ink-3 tabular">
              {draft
                ? `${format(draft.from, "d MMM yyyy")} → pick an end day`
                : resolved
                  ? `${format(resolved.from, "d MMM yyyy HH:mm")} → ${format(resolved.to, "d MMM yyyy HH:mm")}`
                  : "Any time"}
            </span>
            {clearable && value ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDraft(null);
                  onChange?.(null);
                  onDone?.();
                }}
              >
                Clear
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    );
  },
);

export interface DateRangePickerProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "value" | "onChange"
> {
  value?: DateRangeValue | null;
  onChange?: (value: DateRangeValue | null) => void;
  presets?: readonly DateRangePreset[];
  now?: Date;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: "start" | "center" | "end";
  size?: "sm" | "md";
  clearable?: boolean;
  /** Label shown before the value on the trigger. */
  label?: string;
}

/**
 * Button + popover date range picker. Presets (Last 15 min … 30 d) on the
 * left, a two-month calendar on the right. Emits a serialisable
 * `DateRangeValue`.
 */
export const DateRangePicker = forwardRef<HTMLButtonElement, DateRangePickerProps>(
  function DateRangePicker(
    {
      value,
      onChange,
      presets,
      now,
      open,
      defaultOpen,
      onOpenChange,
      align = "start",
      size = "md",
      clearable = true,
      label,
      className,
      ...rest
    },
    ref,
  ) {
    const [internalOpen, setInternalOpen] = useState(defaultOpen ?? false);
    const isOpen = open ?? internalOpen;
    const setOpen = (next: boolean) => {
      if (open === undefined) setInternalOpen(next);
      onOpenChange?.(next);
    };
    return (
      <Popover open={isOpen} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            ref={ref}
            variant="secondary"
            size={size}
            leadingIcon={<Calendar strokeWidth={1.75} />}
            trailingIcon={<ChevronDown className="text-ink-3" strokeWidth={1.75} />}
            aria-label={label ? `${label}: ${formatDateRangeLabel(value)}` : undefined}
            className={cn("max-w-full font-normal", className)}
            {...rest}
          >
            {label ? <span className="text-ink-3">{label}</span> : null}
            <span className={cn("truncate", !value && "text-ink-3")}>
              {formatDateRangeLabel(value)}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent bare width="auto" align={align} className="max-w-[calc(100vw-16px)]">
          <DateRangePanel
            value={value}
            onChange={onChange}
            presets={presets}
            now={now}
            clearable={clearable}
            onDone={() => setOpen(false)}
          />
        </PopoverContent>
      </Popover>
    );
  },
);
