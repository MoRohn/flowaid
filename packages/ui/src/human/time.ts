import { useEffect, useState } from "react";

/**
 * Clock shared by the review surfaces. Returns the current epoch ms and
 * re-renders every `intervalMs` while `enabled`. Pass `fixed` to freeze the
 * clock (tests, snapshots, server rendering). State only changes from timer callbacks: a
 * zero-delay tick refreshes a stale clock as soon as the clock (re)starts.
 */
export function useReviewNow(intervalMs = 1000, enabled = true, fixed?: number): number {
  const [now, setNow] = useState(() => fixed ?? Date.now());
  useEffect(() => {
    if (fixed !== undefined || !enabled) return;
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, intervalMs);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [intervalMs, enabled, fixed]);
  return fixed ?? now;
}

/** Parses an ISO timestamp (or epoch ms) into epoch ms; NaN when unparseable. */
export function toEpochMs(value: string | number | Date): number {
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.getTime();
  return Date.parse(value);
}

/**
 * Compact duration for waiting times and SLA countdowns: "12s", "4m 12s",
 * "1h 04m", "2d 3h". Negative input is clamped to zero.
 */
export function formatDurationShort(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
  return `${seconds}s`;
}

/** "4 min ago", "just now", "2 h ago", "3 d ago": for requested / responded timestamps. */
export function formatRelativeShort(at: string | number | Date, now: number): string {
  const ms = now - toEpochMs(at);
  if (!Number.isFinite(ms)) return "—";
  const s = Math.round(Math.abs(ms) / 1000);
  const suffix = ms >= 0 ? "ago" : "from now";
  if (s < 45) return ms >= 0 ? "just now" : "in under a minute";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ${suffix}`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ${suffix}`;
  const d = Math.round(h / 24);
  return `${d} d ${suffix}`;
}

/** Absolute timestamp for titles: "22 Sep 2026, 14:03". */
export function formatAbsolute(at: string | number | Date): string {
  const ms = toEpochMs(at);
  if (!Number.isFinite(ms)) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}
