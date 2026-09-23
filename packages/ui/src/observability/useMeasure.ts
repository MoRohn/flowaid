import { useLayoutEffect, useRef, useState, type RefObject } from "react";

export interface MeasuredSize {
  width: number;
  height: number;
}

/**
 * Observe an element's content box. Charts use this to size their SVG to the
 * container so they are responsive without a fixed width. Returns `{0, 0}`
 * until the first measurement and where ResizeObserver is unavailable.
 */
export function useMeasure<T extends HTMLElement = HTMLDivElement>(): [
  RefObject<T | null>,
  MeasuredSize,
] {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState<MeasuredSize>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = (width: number, height: number) => {
      setSize((prev) => {
        const w = Math.round(width);
        const h = Math.round(height);
        return prev.width === w && prev.height === h ? prev : { width: w, height: h };
      });
    };
    const rect = el.getBoundingClientRect();
    update(rect.width, rect.height);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const box = entry.contentBoxSize?.[0];
      if (box) update(box.inlineSize, box.blockSize);
      else update(entry.contentRect.width, entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, size];
}
