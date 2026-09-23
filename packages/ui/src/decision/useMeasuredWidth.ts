import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Width of a DOM node in px, kept current with a ResizeObserver. Returns 0
 * until measured (and in environments without layout), so callers fall back
 * to a proportional rule when they have no pixels to reason about.
 */
export function useMeasuredWidth<T extends HTMLElement>(
  fixed?: number,
): { ref: RefObject<T | null>; width: number } {
  const ref = useRef<T>(null);
  const [measured, setMeasured] = useState(0);
  useIsoLayoutEffect(() => {
    if (fixed !== undefined) return;
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const w = el.getBoundingClientRect().width;
      setMeasured((prev) => (Math.abs(prev - w) < 0.5 ? prev : w));
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fixed]);
  return { ref, width: fixed ?? measured };
}

/** Approximate rendered width of a mono string at the given font size (JetBrains Mono is ~0.6em per glyph). */
export function monoTextWidth(text: string, fontSizePx = 11): number {
  return text.length * fontSizePx * 0.6;
}
