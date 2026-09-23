import { forwardRef, useMemo, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import { Check, Pencil, RotateCcw, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import { DiffView, diffSequences } from "@/data";
import { Button, Textarea, useControllableState } from "@/primitives";

/** Rough token estimate for prose (≈4 characters per token). */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

export interface WordDiffSpan {
  type: "equal" | "add" | "remove";
  text: string;
}

const WORD_RE = /(\s+|\w+|[^\s\w]+)/g;

/**
 * Word-level diff of two prose texts, merged into runs. Whitespace is a
 * token so reflowed paragraphs diff cleanly; runs preserve the newlines.
 */
export function diffWords(original: string, edited: string): WordDiffSpan[] {
  const a = original.match(WORD_RE) ?? [];
  const b = edited.match(WORD_RE) ?? [];
  const spans: WordDiffSpan[] = [];
  for (const op of diffSequences(a, b, (x, y) => x === y)) {
    const last = spans[spans.length - 1];
    if (last && last.type === op.type) last.text += op.value;
    else spans.push({ type: op.type, text: op.value });
  }
  return spans;
}

export interface ProposedOutputEditorProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "onChange" | "defaultValue"
> {
  /** The AI-proposed text; the diff and Reset compare against it. */
  original: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  /** Label over the proposed text. Default "Proposed by the model". */
  label?: ReactNode;
  /** Hide the inline diff after edits. */
  hideDiff?: boolean;
  /** "lines": the data group's DiffView (inline, token emphasis). "words": a word-level prose diff. Default "lines". */
  diffMode?: "lines" | "words";
  /** Custom token estimator (defaults to ≈4 characters per token). */
  tokenEstimator?: (text: string) => number;
}

function Stats({ text, estimate }: { text: string; estimate: (t: string) => number }) {
  return (
    <span className="font-mono text-2xs text-ink-3 tabular">
      {text.length.toLocaleString("en")} chars · ~{estimate(text).toLocaleString("en")} tokens
    </span>
  );
}

/**
 * Shows the model's proposed text with an Edit affordance. Editing swaps in
 * an auto-growing textarea; once the text differs from the original an inline
 * word diff appears with a Reset button. Character and token estimates are
 * mono, so reviewers see the cost of their edit.
 */
export const ProposedOutputEditor = forwardRef<HTMLDivElement, ProposedOutputEditorProps>(
  function ProposedOutputEditor(
    {
      original,
      value,
      defaultValue,
      onChange,
      disabled = false,
      label = "Proposed by the model",
      hideDiff = false,
      diffMode = "lines",
      tokenEstimator = estimateTokens,
      className,
      ...rest
    },
    ref,
  ) {
    const [text, setText] = useControllableState<string>(value, defaultValue ?? original, onChange);
    const [editing, setEditing] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const edited = text !== original;
    const spans = useMemo(
      () => (edited ? diffWords(original, text) : []),
      [edited, original, text],
    );
    const added = spans
      .filter((s) => s.type === "add")
      .reduce((n, s) => n + s.text.trim().length, 0);
    const removed = spans
      .filter((s) => s.type === "remove")
      .reduce((n, s) => n + s.text.trim().length, 0);

    return (
      <div
        ref={ref}
        data-editing={editing || undefined}
        data-edited={edited || undefined}
        className={cn("flex min-w-0 flex-col gap-2", className)}
        {...rest}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-2">
            <Sparkles className="size-3.5 text-accent" strokeWidth={1.75} aria-hidden="true" />
            {label}
            {edited ? (
              <span className="rounded-xs bg-accent-soft px-1 py-px text-2xs font-medium leading-none text-accent-text">
                edited
              </span>
            ) : null}
          </span>
          <div className="flex items-center gap-1">
            {edited ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled}
                leadingIcon={<RotateCcw strokeWidth={1.75} aria-hidden="true" />}
                onClick={() => {
                  setText(original);
                  textareaRef.current?.focus();
                }}
              >
                Reset
              </Button>
            ) : null}
            {editing ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={disabled}
                leadingIcon={<Check strokeWidth={2} aria-hidden="true" />}
                onClick={() => setEditing(false)}
              >
                Done
              </Button>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                disabled={disabled}
                leadingIcon={<Pencil strokeWidth={1.75} aria-hidden="true" />}
                onClick={() => {
                  setEditing(true);
                  requestAnimationFrame(() => textareaRef.current?.focus());
                }}
              >
                Edit
              </Button>
            )}
          </div>
        </div>

        {editing ? (
          <Textarea
            ref={textareaRef}
            autoGrow
            minRows={4}
            maxRows={18}
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={disabled}
            aria-label={typeof label === "string" ? label : "Proposed output"}
          />
        ) : (
          <div
            className={cn(
              "whitespace-pre-wrap rounded-sm border px-3 py-2.5 text-sm leading-normal text-ink",
              edited ? "border-accent-soft-2 bg-surface" : "border-border bg-surface-2",
            )}
          >
            {text}
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <Stats text={text} estimate={tokenEstimator} />
          {edited ? (
            <span className="font-mono text-2xs tabular">
              <span className="text-ok-text">+{added}</span>{" "}
              <span className="text-danger-text">−{removed}</span>
            </span>
          ) : null}
        </div>

        {edited && !hideDiff && diffMode === "lines" ? (
          <DiffView
            oldValue={original}
            newValue={text}
            oldLabel="Proposed"
            newLabel="Edited"
            mode="inline"
            modeToggle={false}
            context={2}
            maxHeight={320}
            aria-label="Changes from the proposed output"
          />
        ) : null}
        {edited && !hideDiff && diffMode === "words" ? (
          <div
            role="region"
            aria-label="Changes from the proposed output"
            className="flex flex-col gap-1.5 rounded-sm border border-border bg-surface-2 px-3 py-2.5"
          >
            <span className="text-eyebrow">Changes</span>
            <p className="m-0 whitespace-pre-wrap text-sm leading-normal text-ink-2">
              {spans.map((span, i) =>
                span.type === "equal" ? (
                  <span key={i}>{span.text}</span>
                ) : span.type === "add" ? (
                  <ins key={i} className="rounded-[2px] bg-ok-soft px-px text-ok-text no-underline">
                    {span.text}
                  </ins>
                ) : (
                  <del key={i} className="rounded-[2px] bg-danger-soft px-px text-danger-text">
                    {span.text}
                  </del>
                ),
              )}
            </p>
          </div>
        ) : null}
      </div>
    );
  },
);
