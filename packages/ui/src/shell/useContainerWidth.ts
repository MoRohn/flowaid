import { useEffect, useState, type RefObject } from "react";

/**
 * Tracks an element's width with a ResizeObserver. Returns `undefined` until
 * the first measurement so callers can fall back to the viewport width.
 */
export function useContainerWidth(ref: RefObject<HTMLElement | null>): number | undefined {
  const [width, setWidth] = useState<number | undefined>(undefined);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setWidth(el.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(() => measure());
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
