"use client";
/** Whether a CSS media query matches, following changes (false on the server and in old DOMs). */
import { useSyncExternalStore } from "react";

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function")
        return () => undefined;
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => typeof window.matchMedia === "function" && window.matchMedia(query).matches,
    () => false,
  );
}

/** Below Tailwind's `lg` (64rem): the width where side panels give way to sheets. */
export const BELOW_LG = "(max-width: 63.999rem)";
