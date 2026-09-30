"use client";
/**
 * The unsent draft of a creation dialog, kept in this browser tab (sessionStorage) so closing the
 * dialog, following a "connect this first" link, or reloading does not lose what was typed. It is
 * never sent anywhere until the person presses the dialog's own create button; `omit` strips
 * anything that must not be written to storage (secrets). Creating the item clears it.
 */
import { useCallback, useEffect, useState, type SetStateAction } from "react";
import { readSessionDraft, writeSessionDraft } from "./storage";

export interface KeptDraft<T> {
  draft: T;
  setDraft: (next: SetStateAction<T>) => void;
  /** the dialog opened on a draft left from earlier in this tab */
  restored: boolean;
  /** differs from the empty starting point */
  dirty: boolean;
  /** back to the starting point, forgetting the kept draft */
  discard: () => void;
}

/**
 * `key` null keeps nothing (editing an existing item works from its saved value). The key
 * should include the workspace, so drafts never cross workspaces.
 */
export function useKeptDraft<T>(
  key: string | null,
  initial: () => T,
  omit: (draft: T) => unknown = (d) => d,
): KeptDraft<T> {
  const [empty] = useState(initial);
  const emptyJson = JSON.stringify(omit(empty));
  const [state, setState] = useState<{ draft: T; restored: boolean }>(() => {
    const kept = key ? readSessionDraft<Partial<T>>(key) : undefined;
    return kept && typeof kept === "object"
      ? { draft: { ...empty, ...kept }, restored: true }
      : { draft: empty, restored: false };
  });
  const storedJson = JSON.stringify(omit(state.draft));
  const dirty = storedJson !== emptyJson;
  useEffect(() => {
    if (!key) return;
    writeSessionDraft(key, dirty ? JSON.parse(storedJson) : undefined);
  }, [key, dirty, storedJson]);
  const setDraft = useCallback(
    (next: SetStateAction<T>) =>
      setState((s) => ({
        ...s,
        draft: typeof next === "function" ? (next as (d: T) => T)(s.draft) : next,
      })),
    [],
  );
  const discard = useCallback(() => {
    if (key) writeSessionDraft(key, undefined);
    setState({ draft: empty, restored: false });
  }, [key, empty]);
  return { draft: state.draft, setDraft, restored: state.restored, dirty, discard };
}
