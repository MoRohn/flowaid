"use client";
/**
 * The Guide: a docked panel that explains, in plain words, the page you are on and what to do
 * next. Pages with more to explain (the builder, a run) share what is on screen through
 * `useGuideContext`. It stays open across pages until closed, and needs no AI model; when Ask
 * FlowAId is available it offers that for questions in your own words.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { NodeManifest, WorkflowDefinition, WorkflowNode } from "@flowaid/workflow-core";
import type { RunView } from "@flowaid/ui";
import { GuidePanel } from "./GuidePanel";

export type GuideContext =
  | {
      kind: "builder";
      definition: WorkflowDefinition;
      selected?: WorkflowNode;
      manifest?: NodeManifest;
      onSelectStep?: (nodeId: string) => void;
      /** back from one step to the whole workflow */
      onClearStep?: () => void;
      run?: Pick<RunView, "status" | "nodeRuns" | "error">;
    }
  | {
      kind: "run";
      run: Pick<RunView, "status" | "nodeRuns" | "error">;
      definition?: WorkflowDefinition;
    };

interface GuideValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  context: GuideContext | null;
  setContext: (context: GuideContext | null) => void;
}

const Ctx = createContext<GuideValue | null>(null);
// pages only set what they show; a separate, stable context keeps them from re-rendering on it
const SetCtx = createContext<((context: GuideContext | null) => void) | null>(null);
const KEY = "flowaid:guide-open";

export function useGuide(): GuideValue | null {
  return useContext(Ctx);
}

/** Shares what a page shows with the Guide while the page is mounted. */
export function useGuideContext(context: GuideContext | null): void {
  const setContext = useContext(SetCtx);
  useEffect(() => {
    setContext?.(context);
  }, [setContext, context]);
  useEffect(() => () => setContext?.(null), [setContext]);
}

const CHANGED = "flowaid:guide";
const readOpen = () => {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false; // storage blocked: the Guide starts closed
  }
};
const subscribe = (onChange: () => void) => {
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
};

export function GuideProvider({ children }: { children: ReactNode }) {
  // open or closed is remembered per browser: a person who keeps it open finds it open again
  const open = useSyncExternalStore(subscribe, readOpen, () => false);
  const [context, setContext] = useState<GuideContext | null>(null);
  const setOpen = useCallback((next: boolean) => {
    try {
      if (next) window.localStorage.setItem(KEY, "1");
      else window.localStorage.removeItem(KEY);
    } catch {
      // storage blocked: the change still applies to this page
    }
    window.dispatchEvent(new Event(CHANGED));
  }, []);
  const value = useMemo(() => ({ open, setOpen, context, setContext }), [open, setOpen, context]);
  return (
    <SetCtx.Provider value={setContext}>
      <Ctx.Provider value={value}>
        {children}
        <GuidePanel open={open} onOpenChange={setOpen} context={context} />
      </Ctx.Provider>
    </SetCtx.Provider>
  );
}
