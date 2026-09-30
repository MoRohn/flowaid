/**
 * Small, failure-tolerant browser storage for guidance preferences and unsent drafts. Private
 * windows and blocked storage throw; every read falls back to "nothing stored" and every write
 * still applies to the page that is open.
 */
import { useCallback, useSyncExternalStore } from "react";

const CHANGED = "flowaid:guide-prefs";

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function readPref(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // storage blocked: the change applies until the page reloads
  }
  window.dispatchEvent(new Event(CHANGED));
}

/** A string preference remembered per browser, shared live by every component that reads it. */
export function usePref(key: string, fallback: string): [string, (value: string | null) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => readPref(key) ?? fallback,
    () => fallback,
  );
  const set = useCallback((next: string | null) => writePref(key, next), [key]);
  return [value, set];
}

// ── drafts kept in this browser tab ──────────────────────────────────────────────────────────

export function readSessionDraft<T>(key: string): T | undefined {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

export function writeSessionDraft(key: string, value: unknown): void {
  try {
    if (value === undefined) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage blocked or full: the draft lives only while the dialog is open
  }
}
