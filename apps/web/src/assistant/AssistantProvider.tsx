"use client";
/**
 * Holds the Ask FlowAId conversation for the workspace layout, so it survives navigation: a
 * person can follow a cited run and come back to the answer. Renders the panel; pages and the
 * frame open it through `useAssistant()`.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { post } from "~/api/client";
import { useSession } from "~/session";
import { AskPanel } from "./AskPanel";
import { errorText, historyFor, type AssistantAnswer, type Turn } from "./logic";

export interface AssistantContextValue {
  /** false when the workspace has no generation model (features.assistant) */
  available: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
  /** opens the panel and asks, when there is a question */
  ask: (question?: string) => void;
}

const AssistantContext = createContext<AssistantContextValue | null>(null);

export function useAssistant(): AssistantContextValue | null {
  return useContext(AssistantContext);
}

let turnSeq = 0;

export function AssistantProvider({ children }: { children: ReactNode }) {
  const s = useSession();
  const available = s.features.assistant === true && s.can("runs:read");
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState(false);

  const send = useCallback(
    (question: string) => {
      const q = question.trim();
      if (q.length < 3 || pending) return;
      const id = `t${++turnSeq}`;
      const history = historyFor(turns);
      setTurns((all) => [...all, { id, question: q }]);
      setPending(true);
      post<AssistantAnswer>("/v1/assistant/ask", {
        question: q,
        ...(history.length ? { history } : {}),
      })
        .then((answer) => setTurns((all) => all.map((t) => (t.id === id ? { ...t, answer } : t))))
        .catch((error: unknown) =>
          setTurns((all) => all.map((t) => (t.id === id ? { ...t, error: errorText(error) } : t))),
        )
        .finally(() => setPending(false));
    },
    [pending, turns],
  );

  const value = useMemo<AssistantContextValue>(
    () => ({
      available,
      open,
      setOpen,
      ask: (question) => {
        setOpen(true);
        if (question) send(question);
      },
    }),
    [available, open, send],
  );

  return (
    <AssistantContext.Provider value={value}>
      {children}
      {available ? (
        <AskPanel
          ws={s.ws}
          open={open}
          onOpenChange={setOpen}
          turns={turns}
          pending={pending}
          onAsk={send}
          onClear={() => setTurns([])}
        />
      ) : null}
    </AssistantContext.Provider>
  );
}
