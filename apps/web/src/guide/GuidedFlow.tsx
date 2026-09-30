"use client";
/**
 * A creation or configuration form as a guided path. Each step holds the form's real controls
 * and explains what to do and why; a step shows as done only when the draft it edits is (the
 * caller computes `done` from the same draft it saves), never because someone pressed Next.
 *
 * "All fields" shows every step's controls at once for people who know the form. Both views
 * edit the same draft, so switching between them loses nothing; the choice is remembered per
 * browser. Going back to an earlier step keeps everything entered in later ones.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Check, Lightbulb } from "lucide-react";
import { Button, ToggleGroup, ToggleGroupItem } from "@flowaid/ui/primitives";
import { usePref } from "./storage";

export interface FlowStep {
  id: string;
  /** short and action-oriented: "Choose a model" */
  title: string;
  /** what to do here and why it matters */
  why: ReactNode;
  /** true when the draft already has what this step asks for */
  done: boolean;
  optional?: boolean;
  /** the word for a skippable step when "Optional" undersells it ("Can wait") */
  optionalLabel?: string;
  /** what finishes the step, shown while it is not done */
  requirement?: string;
  /** the rail's word for a done step ("Ready" for a review step that has not been submitted) */
  doneLabel?: string;
  /** a recommended starting point or example */
  example?: ReactNode;
  children: ReactNode;
}

export type FlowMode = "guided" | "all";

export function useFlowMode(): [FlowMode, (mode: FlowMode) => void] {
  const [mode, setMode] = usePref("flowaid:guided-mode", "guided");
  return [mode === "all" ? "all" : "guided", (m) => setMode(m === "guided" ? null : m)];
}

export function GuidedFlow({
  steps,
  status,
  initialStep = 0,
  className,
}: {
  steps: readonly FlowStep[];
  /** whether the draft is saved, kept in this tab, or waiting to be created */
  status?: ReactNode;
  initialStep?: number;
  className?: string;
}) {
  const [mode, setMode] = useFlowMode();
  const [index, setIndex] = useState(() => Math.min(initialStep, steps.length - 1));
  const current = steps[Math.min(index, steps.length - 1)];
  const headingRef = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  useEffect(() => {
    // moving between steps puts keyboard and screen-reader focus on the new step's title
    if (moved.current) headingRef.current?.focus();
  }, [index]);
  const go = (i: number) => {
    moved.current = true;
    setIndex(Math.max(0, Math.min(steps.length - 1, i)));
  };
  if (!current) return null;
  const doneCount = steps.filter((s) => s.done).length;
  const blocked = !current.done && !current.optional;
  const next = steps[index + 1];

  return (
    <div className={`flex flex-col gap-3 ${className ?? ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ToggleGroup
          type="single"
          size="sm"
          value={mode}
          onValueChange={(v) => {
            if (v === "guided" || v === "all") setMode(v);
          }}
          aria-label="How to show this form"
        >
          <ToggleGroupItem value="guided">Step by step</ToggleGroupItem>
          <ToggleGroupItem value="all">All fields</ToggleGroupItem>
        </ToggleGroup>
        {status ? <div className="text-xs text-ink-3">{status}</div> : null}
      </div>

      {mode === "all" ? (
        <div className="flex flex-col gap-5">
          {steps.map((s) => (
            <section key={s.id} aria-labelledby={`flow-${s.id}`} className="flex flex-col gap-2">
              <div>
                <h3
                  id={`flow-${s.id}`}
                  className="m-0 flex items-center gap-2 text-sm font-semibold text-ink"
                >
                  {s.title}
                  {s.optional ? (
                    <span className="text-xs font-normal text-ink-3">
                      {s.optionalLabel ?? "Optional"}
                    </span>
                  ) : null}
                  {s.done ? (
                    <Check className="size-3.5 text-ok-text" strokeWidth={2} aria-label="Done" />
                  ) : null}
                </h3>
                <p className="m-0 mt-0.5 text-xs text-ink-3">{s.why}</p>
              </div>
              {s.example ? <Example>{s.example}</Example> : null}
              {s.children}
            </section>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:min-h-[22rem] sm:grid-cols-[11rem_minmax(0,1fr)]">
          <nav aria-label="Steps" className="min-w-0">
            <p className="m-0 mb-1.5 text-2xs text-ink-3 sm:hidden">
              Step {index + 1} of {steps.length}
            </p>
            <ol className="m-0 flex list-none gap-1 overflow-x-auto p-0 sm:flex-col">
              {steps.map((s, i) => (
                <li key={s.id} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => go(i)}
                    aria-current={i === index ? "step" : undefined}
                    className={`flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left text-xs focus-visible:shadow-(--focus) focus-visible:outline-none ${
                      i === index
                        ? "bg-accent-soft text-ink"
                        : "text-ink-2 hover:bg-surface-3 hover:text-ink"
                    }`}
                  >
                    <StepBadge n={i + 1} done={s.done} current={i === index} />
                    <span className="min-w-0">
                      <span className="block font-medium leading-tight">{s.title}</span>
                      <span className="block text-2xs text-ink-3">
                        {s.done
                          ? (s.doneLabel ?? "Done")
                          : s.optional
                            ? (s.optionalLabel ?? "Optional")
                            : "To do"}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
            <p className="m-0 mt-2 hidden text-2xs text-ink-3 sm:block">
              {doneCount} of {steps.length} done
            </p>
          </nav>

          <section aria-labelledby={`flow-${current.id}`} className="flex min-w-0 flex-col gap-3">
            <div>
              <p className="text-eyebrow m-0">
                Step {index + 1} of {steps.length}
                {current.optional
                  ? ` · ${(current.optionalLabel ?? "Optional").toLowerCase()}`
                  : ""}
              </p>
              <h3
                ref={headingRef}
                id={`flow-${current.id}`}
                tabIndex={-1}
                className="m-0 mt-0.5 text-base font-semibold text-ink focus:outline-none"
              >
                {current.title}
              </h3>
              <p className="m-0 mt-1 text-sm text-ink-2">{current.why}</p>
            </div>
            {current.example ? <Example>{current.example}</Example> : null}
            {/* keyed per step: a control at the same place in the next step must not reuse this one */}
            <div key={current.id} className="flex flex-col gap-3">
              {current.children}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                leadingIcon={<ArrowLeft strokeWidth={1.75} />}
                disabled={index === 0}
                onClick={() => go(index - 1)}
              >
                Back
              </Button>
              <span
                className="order-last min-w-0 basis-full text-xs text-ink-3 sm:order-none sm:basis-0 sm:flex-1"
                role="status"
              >
                {blocked && current.requirement ? `To continue: ${current.requirement}` : ""}
              </span>
              {next ? (
                <Button
                  type="button"
                  size="sm"
                  variant={blocked ? "secondary" : "primary"}
                  className="ml-auto sm:ml-0"
                  disabled={blocked}
                  onClick={() => go(index + 1)}
                >
                  {current.optional && !current.done ? "Skip" : "Next"}: {next.title}
                  <ArrowRight strokeWidth={1.75} aria-hidden className="size-3.5" />
                </Button>
              ) : null}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

/** A recommended starting point, shown in both views (it may hold a button that fills it in). */
function Example({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-2 rounded-sm border border-border bg-surface-2 px-2.5 py-2 text-xs leading-snug text-ink-2">
      <Lightbulb
        className="mt-px size-3.5 shrink-0 text-warn-text"
        strokeWidth={1.75}
        aria-hidden
      />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function StepBadge({ n, done, current }: { n: number; done: boolean; current: boolean }) {
  return (
    <span
      aria-hidden
      className={`mt-px flex size-4 shrink-0 items-center justify-center rounded-full font-mono text-2xs tabular ${
        done
          ? "bg-ok-soft text-ok-text"
          : current
            ? "bg-accent text-accent-ink"
            : "border border-border bg-surface-2 text-ink-3"
      }`}
    >
      {done ? <Check className="size-3" strokeWidth={2.25} /> : n}
    </span>
  );
}

/** The line under a guided form saying where its draft is. */
export function DraftStatus({
  dirty,
  restored,
  onDiscard,
  what = "it",
}: {
  dirty: boolean;
  restored: boolean;
  onDiscard: () => void;
  /** "the agent" */
  what?: string;
}) {
  if (!dirty) return <span>Nothing is saved until you create {what}.</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2">
      <span>
        {restored ? "Picked up where you left off. " : ""}Draft kept in this browser tab, not saved
        yet.
      </span>
      <button
        type="button"
        onClick={onDiscard}
        className="rounded-xs text-accent-text hover:underline focus-visible:shadow-(--focus) focus-visible:outline-none"
      >
        Start over
      </button>
    </span>
  );
}
