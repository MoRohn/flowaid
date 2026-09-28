"use client";
/**
 * The Ask FlowAId panel: a question box, suggested questions, and answers as typed statements
 * (fact, calculation, suggestion, unconfirmed) with links to the records they cite and a line
 * saying which model answered, how many lookups it made and what it cost.
 */
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUp, Info, MessageSquareText, TriangleAlert } from "lucide-react";
import {
  Badge,
  Button,
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Spinner,
  Textarea,
} from "@flowaid/ui/primitives";
import {
  KIND_META,
  SUGGESTED_QUESTIONS,
  provenance,
  sourceHref,
  type AssistantAnswer,
  type Turn,
} from "./logic";

export interface AskPanelProps {
  ws: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  turns: readonly Turn[];
  pending: boolean;
  onAsk: (question: string) => void;
  onClear: () => void;
}

export function AskPanel({
  ws,
  open,
  onOpenChange,
  turns,
  pending,
  onAsk,
  onClear,
}: AskPanelProps) {
  const [draft, setDraft] = useState("");
  const end = useRef<HTMLDivElement | null>(null);
  const input = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [turns, pending]);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (draft.trim().length < 3 || pending) return;
    onAsk(draft);
    setDraft("");
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) submit(e);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        width={520}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          input.current?.focus();
        }}
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <MessageSquareText className="size-4 text-accent" strokeWidth={1.75} aria-hidden />
            Ask FlowAId
          </SheetTitle>
          <SheetDescription>
            Questions about your workflows, runs, costs and approvals. Answers come from read-only
            lookups; FlowAId changes nothing on its own.
          </SheetDescription>
        </SheetHeader>

        <SheetBody className="flex flex-col gap-5" aria-live="polite" aria-busy={pending}>
          {turns.length === 0 ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-ink-2">Try one of these:</p>
              {SUGGESTED_QUESTIONS.map((q) => (
                <Button
                  key={q}
                  variant="secondary"
                  className="h-auto justify-start whitespace-normal py-2 text-left"
                  onClick={() => onAsk(q)}
                  disabled={pending}
                >
                  {q}
                </Button>
              ))}
            </div>
          ) : (
            turns.map((t) => (
              <section key={t.id} className="flex flex-col gap-2" aria-label={t.question}>
                <p className="self-end rounded-md bg-accent-soft px-3 py-2 text-sm text-ink">
                  {t.question}
                </p>
                {t.answer ? (
                  <Answer ws={ws} answer={t.answer} onNavigate={() => onOpenChange(false)} />
                ) : t.error ? (
                  <p role="alert" className="flex items-start gap-2 text-sm text-danger-text">
                    <TriangleAlert
                      className="mt-0.5 size-4 shrink-0"
                      strokeWidth={1.75}
                      aria-hidden
                    />
                    {t.error}
                  </p>
                ) : (
                  <p className="flex items-center gap-2 text-sm text-ink-3">
                    <Spinner size="sm" /> Looking through your workspace…
                  </p>
                )}
              </section>
            ))
          )}
          <div ref={end} />
        </SheetBody>

        <SheetFooter className="flex-col items-stretch gap-2">
          <form onSubmit={submit} className="flex items-end gap-2">
            <label htmlFor="ask-flowaid-question" className="sr-only">
              Your question
            </label>
            <Textarea
              id="ask-flowaid-question"
              ref={input}
              rows={2}
              value={draft}
              maxLength={2000}
              placeholder="Ask about failures, costs, changes or approvals…"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKey}
              className="min-h-0 flex-1 resize-none"
            />
            <Button
              type="submit"
              disabled={pending || draft.trim().length < 3}
              leadingIcon={<ArrowUp strokeWidth={1.75} />}
            >
              Ask
            </Button>
          </form>
          <div className="flex items-center justify-between text-2xs text-ink-3">
            <span>Enter to ask · Shift+Enter for a new line</span>
            {turns.length > 0 ? (
              <button
                type="button"
                className="rounded-xs hover:text-ink-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                onClick={onClear}
                disabled={pending}
              >
                Clear conversation
              </button>
            ) : null}
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function Answer({
  ws,
  answer: a,
  onNavigate,
}: {
  ws: string;
  answer: AssistantAnswer;
  onNavigate: () => void;
}) {
  const byId = new Map(a.sources.map((s) => [s.id, s]));
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2" aria-label="Answer">
        {a.statements.map((st, i) => {
          const meta = KIND_META[st.kind];
          return (
            <li key={i} className="flex flex-col gap-1 rounded-md border border-border px-3 py-2">
              <div className="flex items-start gap-2">
                <Badge tone={meta.tone} title={meta.hint} className="mt-0.5">
                  {meta.label}
                </Badge>
                <span className="text-sm text-ink">{st.text}</span>
              </div>
              {st.unverified ? (
                <span className="text-2xs text-warn-text">
                  The model stated this without a record to back it; check before relying on it.
                </span>
              ) : null}
              {st.sources.length ? (
                <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                  {st.sources.map((id) => {
                    const src = byId.get(id);
                    return src ? (
                      <Link
                        key={id}
                        href={sourceHref(ws, src)}
                        onClick={onNavigate}
                        className="text-accent-text underline-offset-2 hover:underline focus-visible:underline"
                      >
                        {src.label}
                      </Link>
                    ) : null;
                  })}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="flex items-start gap-1.5 text-2xs text-ink-3">
        <Info className="mt-px size-3 shrink-0" strokeWidth={1.75} aria-hidden />
        <span>
          {provenance(a)}
          {a.stopped === "rounds"
            ? " · stopped at the lookup limit"
            : a.stopped === "budget"
              ? " · stopped at the spending limit"
              : ""}
          . Generated by a model: open the linked records before acting.
        </span>
      </p>
    </div>
  );
}
