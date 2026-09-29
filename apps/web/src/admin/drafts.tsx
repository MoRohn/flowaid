"use client";
/**
 * Unsaved edits that survive switching tabs. A page with tabs wraps its content in
 * `DraftProvider`; each form keeps its draft with `usePreservedDraft(key, saved)` instead of
 * `useState`. Switching to another tab unmounts the form but the provider keeps the draft, so
 * coming back shows it again; `useDirtyKeys` lets the tab bar mark tabs with unsaved edits, and
 * leaving the page (a link, a reload, closing the window) asks first while any draft is unsaved.
 *
 * A draft belongs to the saved value it was started from: when the saved value changes (after
 * a save, or an edit elsewhere) the form starts again from the new value.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLeaveGuard } from "./ui";

interface Entry {
  /** JSON of the saved value the draft started from. */
  base: string;
  draft: unknown;
}

interface DraftStore {
  read(key: string, base: string): unknown;
  record(key: string, base: string, draft: unknown, dirty: boolean): void;
  dirtyKeys: ReadonlySet<string>;
}

const DraftContext = createContext<DraftStore | null>(null);

export function DraftProvider({ children }: { children: ReactNode }) {
  const entries = useRef(new Map<string, Entry>());
  const [dirtyKeys, setDirtyKeys] = useState<ReadonlySet<string>>(() => new Set());
  const read = useCallback((key: string, base: string) => {
    const entry = entries.current.get(key);
    return entry && entry.base === base ? entry.draft : undefined;
  }, []);
  const record = useCallback((key: string, base: string, draft: unknown, dirty: boolean) => {
    if (dirty) entries.current.set(key, { base, draft });
    else entries.current.delete(key);
    setDirtyKeys((keys) => {
      if (keys.has(key) === dirty) return keys;
      const next = new Set(keys);
      if (dirty) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);
  useLeaveGuard(dirtyKeys.size > 0);
  const store = useMemo(() => ({ read, record, dirtyKeys }), [read, record, dirtyKeys]);
  return <DraftContext.Provider value={store}>{children}</DraftContext.Provider>;
}

/** The keys of the drafts with unsaved edits (empty outside a `DraftProvider`). */
export function useDirtyKeys(): ReadonlySet<string> {
  return useContext(DraftContext)?.dirtyKeys ?? EMPTY;
}

const EMPTY: ReadonlySet<string> = new Set();

/** True when a key is `tab` or starts with `tab:` (a tab's forms share its id as the prefix). */
export function isTabDirty(dirtyKeys: ReadonlySet<string>, tab: string): boolean {
  for (const key of dirtyKeys) if (key === tab || key.startsWith(`${tab}:`)) return true;
  return false;
}

export interface PreservedDraft<T> {
  draft: T;
  setDraft: (next: T | ((draft: T) => T)) => void;
  /** The draft differs from the saved value. */
  dirty: boolean;
  /** Back to the saved value. */
  reset: () => void;
}

/**
 * `useState` for a form draft that outlives the form while its page is open. Without a
 * `DraftProvider` it is plain state, and the form guards leaving by itself.
 */
export function usePreservedDraft<T>(key: string, saved: T): PreservedDraft<T> {
  const store = useContext(DraftContext);
  const base = JSON.stringify(saved);
  const [draft, setLocal] = useState<T>(() => {
    const kept = store?.read(key, base);
    return kept === undefined ? saved : (kept as T);
  });
  // a new saved value (after a save, or a change elsewhere): start from it
  const [seenBase, setSeenBase] = useState(base);
  if (seenBase !== base) {
    setSeenBase(base);
    setLocal(JSON.parse(base) as T);
  }
  const dirty = JSON.stringify(draft) !== base;
  useEffect(() => {
    store?.record(key, base, draft, dirty);
  }, [store, key, base, draft, dirty]);
  useLeaveGuard(store === null && dirty);
  const setDraft = useCallback(
    (next: T | ((d: T) => T)) =>
      setLocal((d) => (typeof next === "function" ? (next as (d: T) => T)(d) : next)),
    [],
  );
  const reset = useCallback(() => setLocal(JSON.parse(base) as T), [base]);
  return { draft, setDraft, dirty, reset };
}
