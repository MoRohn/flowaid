/** Formatting helpers specific to the trace viewer (clock times, relative times, compact JSON). */
import { format, formatDistanceStrict } from "date-fns";
import { toMs } from "./timeScale";

/** Wall-clock time with milliseconds: `14:03:22.418`. */
export function formatClock(iso: string | undefined): string {
  const t = toMs(iso);
  return t === undefined ? "—" : format(t, "HH:mm:ss.SSS");
}

/** Date and time without seconds: `22 Sep 2026, 14:03`. */
export function formatDateTime(iso: string | undefined): string {
  const t = toMs(iso);
  return t === undefined ? "—" : format(t, "d MMM yyyy, HH:mm");
}

/** "3 minutes ago" relative to `nowMs`, so renders are deterministic. */
export function formatRelative(iso: string | undefined, nowMs: number): string {
  const t = toMs(iso);
  if (t === undefined) return "—";
  const diff = Math.abs(nowMs - t);
  if (diff < 1000) return "just now";
  const distance = formatDistanceStrict(t, nowMs);
  return t <= nowMs ? `${distance} ago` : `in ${distance}`;
}

export interface CompactJson {
  text: string;
  truncated: boolean;
  totalChars: number;
}

/**
 * Pretty-print any value for a mono block and cap it at `maxChars`. Strings
 * are shown raw (not quoted). Circular or non-serialisable values fall back to
 * `String(value)`.
 */
export function stringifyCompact(value: unknown, maxChars = 2000): CompactJson {
  let text: string;
  if (value === undefined) text = "undefined";
  else if (typeof value === "string") text = value;
  else {
    try {
      text = JSON.stringify(value, null, 2) ?? fallbackString(value);
    } catch {
      text = fallbackString(value);
    }
  }
  const totalChars = text.length;
  if (totalChars <= maxChars) return { text, truncated: false, totalChars };
  return { text: text.slice(0, maxChars), truncated: true, totalChars };
}

function fallbackString(value: unknown): string {
  if (typeof value === "function") return `[function ${value.name || "anonymous"}]`;
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "object" && value !== null) return Object.prototype.toString.call(value);
  return String(value);
}
