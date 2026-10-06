"use client";
/**
 * Saving the builder's draft (UI.md §4.1): autosave 1 s after the last change with If-Match (412 →
 * the conflict dialog), one save at a time, and a last save when the builder closes. In-app
 * navigation unmounts the builder inside the autosave delay, so the pending edit is sent on the way
 * out (`keepalive`, so it also survives the tab closing), and the builder page waits for it
 * (`draftSaved`) before it loads the draft again.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useEffectEvent, useRef } from "react";
import { useStore } from "zustand";
import type { WorkflowDefinition } from "@flowaid/workflow-core";
import { toast } from "@flowaid/ui/primitives";
import { ApiError, get, put, requestHeaders } from "~/api/client";
import type { WorkflowDetail } from "~/api/types";
import type { BuilderStore } from "./store";

export const AUTOSAVE_MS = 1000;
/** Browsers refuse a `keepalive` request whose body would take the in-flight total past 64 KiB. */
const KEEPALIVE_MAX_BYTES = 60 * 1024;

export interface SaveOptions {
  /** send with `keepalive`, so the request outlives the page */
  keepalive?: boolean;
  /** the builder has closed: a failure is reported as a toast, since nothing else shows it */
  closing?: boolean;
}

// --- saves in flight, by workflow: the builder page waits for them before it loads the draft ---
const pending = new Map<string, Promise<void>>();

function track(workflowId: string, save: Promise<unknown>): void {
  const settled = save.then(
    () => undefined,
    () => undefined,
  );
  pending.set(workflowId, settled);
  void settled.then(() => {
    if (pending.get(workflowId) === settled) pending.delete(workflowId);
  });
}

/** Resolves once the draft saves started for a workflow have landed or failed; never rejects. */
export async function draftSaved(workflowId: string): Promise<void> {
  let p = pending.get(workflowId);
  while (p) {
    await p;
    const next = pending.get(workflowId);
    p = next === p ? undefined : next;
  }
}

/**
 * PUTs the draft at `revision` and answers the new revision. With `keepalive` the request outlives
 * the page when the body is small enough; a larger draft, or a session that needs refreshing, goes
 * through the ordinary client.
 */
export async function putDraft(
  workflowId: string,
  definition: WorkflowDefinition,
  revision: number,
  keepalive = false,
): Promise<number> {
  const path = `/v1/workflows/${workflowId}/draft`;
  const headers = { "if-match": `"${revision}"` };
  const body = JSON.stringify({ definition });
  if (keepalive && new TextEncoder().encode(body).length <= KEEPALIVE_MAX_BYTES) {
    const res = await fetch(path, {
      method: "PUT",
      credentials: "same-origin",
      keepalive: true,
      headers: requestHeaders({ "content-type": "application/json", ...headers }),
      body,
    });
    if (res.ok) return ((await res.json()) as { draftRevision: number }).draftRevision;
    if (res.status !== 401) throw await apiErrorOf(res);
  }
  return (await put<{ draftRevision: number }>(path, { definition }, { headers })).draftRevision;
}

async function apiErrorOf(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as {
    error?: { code?: string; message?: string; details?: unknown; request_id?: string };
  } | null;
  const e = body?.error;
  return new ApiError(
    res.status,
    e?.code ?? `HTTP_${res.status}`,
    e?.message ?? (res.statusText || "request failed"),
    e?.details,
    e?.request_id,
  );
}

/**
 * The builder's save: returns `saveNow` (⌘S, before a run or a publish), autosaves, guards a hard
 * unload, and sends what is left when the builder closes. `enabled` is false for read-only viewers.
 */
export function useDraftSave({
  store,
  workflowId,
  ws,
  enabled,
}: {
  store: BuilderStore;
  workflowId: string;
  ws: string;
  enabled: boolean;
}): (o?: SaveOptions) => Promise<void> {
  const qc = useQueryClient();
  const version = useStore(store, (x) => x.version);
  const savedVersion = useStore(store, (x) => x.savedVersion);
  const saving = useStore(store, (x) => x.saving);
  const conflict = useStore(store, (x) => x.conflict);

  const saveOnce = useCallback(
    async ({ keepalive = false, closing = false }: SaveOptions = {}): Promise<void> => {
      const st = store.getState();
      if (st.version === st.savedVersion || st.conflict) return;
      const sent = st.version;
      st.setSaving(true);
      try {
        const revision = await putDraft(workflowId, st.definition, st.draftRevision, keepalive);
        store.getState().markSaved(revision, sent);
      } catch (e) {
        if (closing)
          toast.error("Your last change to the draft was not saved", {
            description:
              e instanceof ApiError && e.status === 412
                ? "The draft changed elsewhere first. Open the workflow to see the saved draft."
                : e instanceof Error
                  ? e.message
                  : "The save failed.",
          });
        if (e instanceof ApiError && e.status === 412 && !closing) {
          const theirs = await get<WorkflowDetail>(`/v1/workflows/${workflowId}`);
          store.getState().setConflict({ theirs: theirs.draft, revision: theirs.draftRevision });
        } else store.getState().setSaving(false, e instanceof Error ? e.message : "save failed");
        throw e;
      }
    },
    [store, workflowId],
  );

  // one save at a time: a second request waits for the first, then sends only if still needed
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const saveNow = useCallback(
    (o?: SaveOptions): Promise<void> => {
      const next = queue.current.then(() => saveOnce(o));
      queue.current = next.catch(() => undefined);
      track(workflowId, next);
      return next;
    },
    [saveOnce, workflowId],
  );

  useEffect(() => {
    if (!enabled || version === savedVersion || saving || conflict) return;
    const t = setTimeout(() => void saveNow().catch(() => undefined), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [version, savedVersion, saving, conflict, enabled, saveNow]);

  // a hard unload asks first; if the page goes anyway (or into the back-forward cache), the edit
  // is sent with keepalive, since React does not unmount on the way out
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      const st = store.getState();
      if (st.version !== st.savedVersion) e.preventDefault();
    };
    const hide = () => {
      if (enabled) void saveNow({ keepalive: true }).catch(() => undefined);
    };
    window.addEventListener("beforeunload", guard);
    window.addEventListener("pagehide", hide);
    return () => {
      window.removeEventListener("beforeunload", guard);
      window.removeEventListener("pagehide", hide);
    };
  }, [store, enabled, saveNow]);

  // in-app navigation unmounts the builder, often inside the autosave delay: send the edit now,
  // then leave the cached workflow on the saved draft so the next visit opens on it, and refresh
  // the workflow's other pages, which read the draft too
  const close = useEffectEvent(() => {
    if (!enabled) return;
    void saveNow({ keepalive: true, closing: true })
      .then(() => {
        const st = store.getState();
        qc.setQueryData<WorkflowDetail>(["workflow", workflowId], (w) =>
          w && w.draftRevision < st.draftRevision
            ? { ...w, draft: st.definition, draftRevision: st.draftRevision }
            : w,
        );
        void qc.invalidateQueries({ queryKey: ["workflow", ws, workflowId] });
      })
      .catch(() => undefined);
  });
  useEffect(() => () => close(), []);

  return saveNow;
}
