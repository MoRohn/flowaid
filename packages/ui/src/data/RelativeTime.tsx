import { forwardRef, useEffect, useState, type TimeHTMLAttributes } from "react";
import { format } from "date-fns";
import { cn } from "@/lib/cn";
import { Tooltip } from "@/primitives";

export type RelativeTimeStyle = "short" | "long";

type DateInput = Date | string | number;

function toDate(input: DateInput): Date {
  return input instanceof Date ? input : new Date(input);
}

interface Unit {
  ms: number;
  short: string;
  long: [string, string];
}

const UNITS: Unit[] = [
  { ms: 365 * 24 * 60 * 60 * 1000, short: "y", long: ["year", "years"] },
  { ms: 30 * 24 * 60 * 60 * 1000, short: "mo", long: ["month", "months"] },
  { ms: 7 * 24 * 60 * 60 * 1000, short: "w", long: ["week", "weeks"] },
  { ms: 24 * 60 * 60 * 1000, short: "d", long: ["day", "days"] },
  { ms: 60 * 60 * 1000, short: "h", long: ["hour", "hours"] },
  { ms: 60 * 1000, short: "m", long: ["minute", "minutes"] },
  { ms: 1000, short: "s", long: ["second", "seconds"] },
];

/**
 * "3 m ago" / "in 2 h" style relative time. `short` (default) uses the compact
 * mono-friendly unit letters from the style guide; `long` spells units out.
 * Anything under 5 seconds reads "just now".
 */
export function formatRelativeTime(
  date: DateInput,
  now: DateInput = Date.now(),
  style: RelativeTimeStyle = "short",
): string {
  const t = toDate(date).getTime();
  const n = toDate(now).getTime();
  if (!Number.isFinite(t) || !Number.isFinite(n)) return "—";
  const diff = n - t;
  const abs = Math.abs(diff);
  if (abs < 5000) return "just now";
  const unit = UNITS.find((u) => abs >= u.ms) ?? UNITS[UNITS.length - 1];
  if (!unit) return "just now";
  const value = Math.floor(abs / unit.ms);
  const label = style === "short" ? unit.short : value === 1 ? unit.long[0] : unit.long[1];
  const body = `${value} ${label}`;
  return diff >= 0 ? `${body} ago` : `in ${body}`;
}

/** Absolute timestamp for tooltips and titles, e.g. "22 Sep 2026, 14:03:11". */
export function formatAbsoluteTime(date: DateInput, withSeconds = true): string {
  const d = toDate(date);
  if (!Number.isFinite(d.getTime())) return "—";
  return format(d, withSeconds ? "d MMM yyyy, HH:mm:ss" : "d MMM yyyy, HH:mm");
}

/** How often a relative label for `date` should be re-evaluated, in ms. */
export function relativeTimeRefreshMs(date: DateInput, now: DateInput = Date.now()): number {
  const abs = Math.abs(toDate(now).getTime() - toDate(date).getTime());
  if (abs < 60 * 1000) return 1000;
  if (abs < 60 * 60 * 1000) return 15 * 1000;
  return 60 * 1000;
}

// One shared 1s ticker for every live timestamp on the page.
const listeners = new Set<() => void>();
let ticker: ReturnType<typeof setInterval> | null = null;

function subscribeTick(fn: () => void): () => void {
  listeners.add(fn);
  if (ticker === null) {
    ticker = setInterval(() => {
      for (const l of listeners) l();
    }, 1000);
  }
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && ticker !== null) {
      clearInterval(ticker);
      ticker = null;
    }
  };
}

/** Current time that re-renders every `intervalMs` (shared 1s tick, sampled). */
export function useNowTick(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let last = Date.now();
    return subscribeTick(() => {
      const t = Date.now();
      if (t - last >= intervalMs - 1) {
        last = t;
        setNow(t);
      }
    });
  }, [intervalMs]);
  return now;
}

/**
 * Live relative label for a date. Re-renders only when the text changes, and
 * checks less often the older the timestamp is.
 */
export function useRelativeTime(date: DateInput, style: RelativeTimeStyle = "short"): string {
  const key = toDate(date).getTime();
  const [text, setText] = useState(() => formatRelativeTime(key, Date.now(), style));
  useEffect(() => {
    let nextAt = 0;
    const update = () => {
      const now = Date.now();
      if (now < nextAt) return;
      setText(formatRelativeTime(key, now, style));
      nextAt = now + relativeTimeRefreshMs(key, now) - 1;
    };
    update();
    return subscribeTick(update);
  }, [key, style]);
  return text;
}

export interface RelativeTimeProps extends Omit<
  TimeHTMLAttributes<HTMLTimeElement>,
  "children" | "style"
> {
  date: DateInput;
  style?: RelativeTimeStyle;
  /**
   * Show the absolute time in a tooltip (default). `false` (inside another tooltip trigger)
   * keeps it as visually hidden text after the relative time, for assistive tech.
   */
  tooltip?: boolean;
  /** Use the mono face (table cells). */
  mono?: boolean;
}

/**
 * `<time>` that reads "3 m ago", updates itself, and reveals the absolute
 * timestamp in a tooltip. Uses one shared ticker for the whole page.
 */
export const RelativeTime = forwardRef<HTMLTimeElement, RelativeTimeProps>(function RelativeTime(
  { date, style = "short", tooltip = true, mono = false, className, ...rest },
  ref,
) {
  const text = useRelativeTime(date, style);
  const d = toDate(date);
  const absolute = formatAbsoluteTime(d);
  const el = (
    <time
      ref={ref}
      dateTime={Number.isFinite(d.getTime()) ? d.toISOString() : undefined}
      className={cn("whitespace-nowrap", mono && "font-mono text-xs tabular", className)}
      {...rest}
    >
      {text}
      {tooltip ? null : <span className="sr-only"> ({absolute})</span>}
    </time>
  );
  if (!tooltip) return el;
  return <Tooltip content={<span className="font-mono tabular">{absolute}</span>}>{el}</Tooltip>;
});
