import { useEffect, useState } from "react";

/**
 * Epoch ms that re-renders every `intervalMs` while `live` is true. When a
 * caller supplies `nowOverride` (tests, snapshots) that value is used instead
 * and no timer runs. State only changes from timer callbacks (never synchronously in
 * the effect): a zero-delay tick refreshes a stale clock as soon as `live` turns on.
 */
export function useNow(live: boolean, intervalMs = 250, nowOverride?: number): number {
  const [now, setNow] = useState(() => nowOverride ?? Date.now());
  useEffect(() => {
    if (nowOverride !== undefined || !live) return;
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, intervalMs);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [live, intervalMs, nowOverride]);
  return nowOverride ?? now;
}
