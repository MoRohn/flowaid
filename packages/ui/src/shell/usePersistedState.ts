import { useCallback, useState } from "react";

/**
 * `useState` backed by localStorage. Reads once on mount and writes on every
 * change; storage failures (private mode, quota, SSR) fall back to memory.
 * A `null` key disables persistence entirely.
 */
export function usePersistedState<T>(
  key: string | null,
  defaultValue: T,
  validate?: (raw: unknown) => T | undefined,
): [T, (next: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(() => {
    if (!key || typeof window === "undefined") return defaultValue;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return defaultValue;
      const parsed: unknown = JSON.parse(raw);
      if (validate) return validate(parsed) ?? defaultValue;
      return parsed as T;
    } catch {
      return defaultValue;
    }
  });

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setState((prev) => {
        const value = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        if (key) {
          try {
            window.localStorage.setItem(key, JSON.stringify(value));
          } catch {
            /* storage unavailable */
          }
        }
        return value;
      });
    },
    [key],
  );

  return [state, set];
}
