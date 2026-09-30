"use client";
/**
 * Fill with AI, inside the Run tab: choose the kind of case, optionally describe it, and get a
 * few realistic inputs written from the workflow's fields, steps and settings. Each shows what it
 * exercises and how it differs from the form; nothing changes until one is chosen, and nothing
 * runs until Run draft. The server checks every example against the workflow's input rules.
 */
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { Check, RefreshCw, Sparkles, X } from "lucide-react";
import type { JsonSchema } from "@flowaid/workflow-core";
import {
  Button,
  Checkbox,
  IconButton,
  Label,
  Skeleton,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
} from "@flowaid/ui/primitives";
import { formatCost } from "@flowaid/ui/lib";
import { post } from "~/api/client";
import { readSessionDraft, usePref, writeSessionDraft } from "~/guide/storage";
import { useSession } from "~/session";
import {
  SCENARIOS,
  enteredFields,
  fieldLabel,
  fillProblem,
  previewRows,
  sampleRequest,
  type FillProblem,
  type Sample,
  type SampleResponse,
} from "./aiFill";

const COUNT = 3;

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; result: SampleResponse }
  | { status: "error"; problem: FillProblem };

export interface AiFillPanelProps {
  workflowId: string;
  /** the definition as edited, unsaved changes included */
  getDefinition: () => unknown;
  schema: JsonSchema;
  current: Record<string, unknown>;
  /** false when no text model is set up (the panel says how to add one) */
  available: boolean;
  /** the title of the example now in the form, if one is */
  applied: string | null;
  onApply: (sample: Sample) => void;
  onClose: () => void;
}

export function AiFillPanel(p: AiFillPanelProps) {
  const s = useSession();
  const headingId = useId();
  const [scenario, setScenario] = usePref("flowaid:ai-fill-scenario", "typical");
  const chosen = SCENARIOS.find((x) => x.id === scenario) ?? SCENARIOS[0];
  // the description is kept in this tab per workflow, so reopening the panel keeps it
  const draftKey = `flowaid:ai-fill:${s.ws}:${p.workflowId}`;
  const [instructions, setInstructionsState] = useState(
    () => readSessionDraft<string>(draftKey) ?? "",
  );
  const setInstructions = (v: string) => {
    setInstructionsState(v);
    writeSessionDraft(draftKey, v.trim() ? v : undefined);
  };
  const entered = enteredFields(p.schema, p.current);
  const fieldCount = Object.keys((p.schema as { properties?: object }).properties ?? {}).length;
  // keeping some fields writes the rest around them; keeping all would repeat the form, so a
  // full form starts with nothing kept
  const allEntered = entered.length > 0 && entered.length >= fieldCount;
  const [keepChoice, setKeepChoice] = useState<boolean | null>(null);
  const keepEntered = entered.length > 0 && (keepChoice ?? !allEntered);
  const keepsEverything = keepEntered && allEntered;
  const [state, setState] = useState<State>({ status: "idle" });
  const [showDetail, setShowDetail] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const resultsHeading = useRef<HTMLHeadingElement>(null);
  const describeRef = useRef<HTMLTextAreaElement>(null);
  const panel = useRef<HTMLElement>(null);
  const escape = useRef<() => void>(() => undefined);

  useEffect(() => {
    describeRef.current?.focus();
    return () => abort.current?.abort();
  }, []);
  useEffect(() => {
    // a keyboard or screen-reader user lands on the answer, not back at the top
    if (state.status === "done" || state.status === "error") resultsHeading.current?.focus();
  }, [state.status]);

  const write = async () => {
    if (state.status === "loading" || !p.available || keepsEverything) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setShowDetail(false);
    setState({ status: "loading" });
    try {
      const result = await post<SampleResponse>(
        `/v1/workflows/${p.workflowId}/ai/sample-inputs`,
        sampleRequest({
          definition: p.getDefinition(),
          scenario: chosen.id,
          instructions,
          current: p.current,
          keepEntered,
          schema: p.schema,
          count: COUNT,
        }),
        { signal: controller.signal },
      );
      if (!controller.signal.aborted) setState({ status: "done", result });
    } catch (e) {
      if (controller.signal.aborted) return;
      setState({ status: "error", problem: fillProblem(e) });
    }
  };
  const cancel = () => {
    abort.current?.abort();
    setState({ status: "idle" });
  };

  // Escape cancels a request on its way, else closes the panel (not the builder around it)
  useEffect(() => {
    escape.current = () => (state.status === "loading" ? cancel() : p.onClose());
  });
  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.stopPropagation();
      escape.current();
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, []);

  const loading = state.status === "loading";

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-md border border-accent/40 bg-surface-2 p-3"
      ref={panel}
    >
      <div className="flex items-start gap-2">
        <Sparkles
          className="mt-0.5 size-4 shrink-0 text-accent-text"
          strokeWidth={1.75}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <h3 id={headingId} className="m-0 text-sm font-semibold text-ink">
            Fill with AI
          </h3>
          <p className="m-0 mt-0.5 text-xs text-ink-3">
            Writes {COUNT} realistic inputs from this workflow&apos;s fields, steps and settings and
            checks each against its input rules. The form changes only when you pick one, and
            nothing runs until you press Run draft.
          </p>
        </div>
        <IconButton size="sm" variant="ghost" label="Close Fill with AI" onClick={p.onClose}>
          <X strokeWidth={1.75} />
        </IconButton>
      </div>

      {!p.available ? (
        <div
          role="status"
          className="rounded-sm border border-border bg-surface p-2.5 text-xs text-ink-2"
        >
          Filling inputs needs a text model. Add an OpenAI, Anthropic or Ollama key under{" "}
          <Link className="text-accent-text hover:underline" href={`/${s.ws}/credentials`}>
            Credentials
          </Link>{" "}
          (or set one on the server), then come back: the form keeps what you entered.
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <Label id={`${headingId}-kind`}>Kind of case</Label>
            <ToggleGroup
              type="single"
              size="sm"
              value={chosen.id}
              onValueChange={(v) => v && setScenario(v)}
              aria-labelledby={`${headingId}-kind`}
              className="self-start"
            >
              {SCENARIOS.map((x) => (
                <ToggleGroupItem key={x.id} value={x.id} disabled={loading}>
                  {x.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <p className="m-0 text-xs text-ink-3">{chosen.about}</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${headingId}-describe`}>
              Describe the case <span className="font-normal text-ink-3">(optional)</span>
            </Label>
            <Textarea
              id={`${headingId}-describe`}
              ref={describeRef}
              autoGrow
              minRows={1}
              maxRows={4}
              maxLength={2000}
              value={instructions}
              disabled={loading}
              placeholder={chosen.placeholder}
              onChange={(e) => setInstructions(e.target.value)}
              onKeyDown={(e) => {
                // Enter writes, Shift+Enter adds a line
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void write();
                }
              }}
            />
          </div>

          {entered.length > 0 ? (
            <div className="flex flex-col gap-1">
              <Checkbox
                size="sm"
                checked={keepEntered}
                disabled={loading}
                onCheckedChange={(c) => setKeepChoice(c === true)}
                label={`Keep what you entered (${entered.map((k) => fieldLabel(p.schema, k)).join(", ")})`}
              />
              {keepsEverything ? (
                <p className="m-0 pl-6 text-2xs text-warn-text" role="status">
                  Every field is kept, so each example would be the same as the form. Untick this,
                  or clear the fields you want written.
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            {loading ? (
              <>
                <Button variant="primary" loading disabled>
                  Writing {COUNT} examples…
                </Button>
                <Button variant="ghost" onClick={cancel}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                variant="primary"
                disabled={keepsEverything}
                leadingIcon={
                  state.status === "done" ? (
                    <RefreshCw strokeWidth={1.75} />
                  ) : (
                    <Sparkles strokeWidth={1.75} />
                  )
                }
                onClick={() => void write()}
              >
                {state.status === "done"
                  ? `Write ${COUNT} new examples`
                  : `Write ${COUNT} examples`}
              </Button>
            )}
            <p className="m-0 min-w-0 flex-1 text-2xs text-ink-3">
              Sends the input fields, step names, rules and settings to your workspace&apos;s text
              model{keepEntered && entered.length ? ", with the values you keep" : ""}; never
              secrets, keys or past runs. It is charged like any model call.
            </p>
          </div>
        </>
      )}

      <div aria-live="polite" aria-busy={loading} className="flex flex-col gap-2">
        {loading ? (
          <>
            <span className="sr-only">Writing examples</span>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: COUNT }, (_, i) => (
                <div
                  key={i}
                  className="flex flex-col gap-2 rounded-sm border border-border bg-surface p-3"
                >
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-5/6" />
                  <Skeleton className="mt-1 h-16 w-full" />
                </div>
              ))}
            </div>
          </>
        ) : null}

        {state.status === "error" ? (
          <div role="alert" className="flex flex-col gap-1.5 rounded-sm border border-danger p-2.5">
            <h4
              ref={resultsHeading}
              tabIndex={-1}
              className="m-0 text-xs font-medium text-ink focus:outline-none"
            >
              No examples this time
            </h4>
            <p className="m-0 text-xs text-ink-2">{state.problem.message}</p>
            <div className="flex flex-wrap items-center gap-2">
              {state.problem.kind === "no-model" ? (
                <Button size="sm" variant="secondary" asChild>
                  <Link href={`/${s.ws}/credentials`}>Open Credentials</Link>
                </Button>
              ) : state.problem.kind !== "forbidden" ? (
                <Button size="sm" variant="secondary" onClick={() => void write()}>
                  Try again
                </Button>
              ) : null}
              {state.problem.kind === "failed" && state.problem.detail ? (
                <Button
                  size="sm"
                  variant="link"
                  aria-expanded={showDetail}
                  onClick={() => setShowDetail((v) => !v)}
                >
                  Technical details
                </Button>
              ) : null}
            </div>
            {showDetail && state.problem.kind === "failed" ? (
              <p className="m-0 break-words font-mono text-2xs text-ink-3">
                {state.problem.detail}
              </p>
            ) : null}
          </div>
        ) : null}

        {state.status === "done" ? (
          <Results
            result={state.result}
            schema={p.schema}
            current={p.current}
            applied={p.applied}
            onApply={p.onApply}
            onRetry={() => void write()}
            headingRef={resultsHeading}
          />
        ) : null}
      </div>
    </section>
  );
}

function Results({
  result,
  schema,
  current,
  applied,
  onApply,
  onRetry,
  headingRef,
}: {
  result: SampleResponse;
  schema: JsonSchema;
  current: Record<string, unknown>;
  applied: string | null;
  onApply: (sample: Sample) => void;
  onRetry: () => void;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  const meta = [
    `${result.model.provider}/${result.model.model}`,
    formatCost(result.costUsd),
    ...(result.rejected > 0
      ? [
          `${result.rejected} left out: ${result.rejected === 1 ? "it did" : "they did"} not fit the input rules`,
        ]
      : []),
  ].join(" · ");
  if (result.samples.length === 0)
    return (
      <div
        role="status"
        className="flex flex-col gap-1.5 rounded-sm border border-border bg-surface p-2.5"
      >
        <h4
          ref={headingRef}
          tabIndex={-1}
          className="m-0 text-xs font-medium text-ink focus:outline-none"
        >
          No example fitted this workflow&apos;s input rules
        </h4>
        <p className="m-0 text-xs text-ink-2">
          Nothing is shown rather than an input the run would refuse. Try again, or describe the
          case in a few words.
        </p>
        <p className="m-0 text-2xs text-ink-3">{meta}</p>
        <Button size="sm" variant="secondary" className="self-start" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <h4
          ref={headingRef}
          tabIndex={-1}
          className="m-0 text-xs font-medium text-ink focus:outline-none"
        >
          {result.samples.length} {result.samples.length === 1 ? "example" : "examples"}: pick one
          to fill the form
        </h4>
        <p className="m-0 text-2xs text-ink-3">{meta}</p>
      </div>
      <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2 xl:grid-cols-3">
        {result.samples.map((sample, i) => {
          const rows = previewRows(schema, sample.input, current);
          const inForm = applied === sample.title && rows.every((r) => r.change === "same");
          const changed = rows.filter((r) => r.change === "changed").length;
          return (
            <li
              key={`${i}:${sample.title}`}
              className={`flex min-w-0 flex-col gap-2 rounded-sm border bg-surface p-3 ${
                inForm ? "border-accent" : "border-border"
              }`}
            >
              <div>
                <p className="m-0 text-sm font-medium text-ink">{sample.title}</p>
                {sample.why ? <p className="m-0 mt-0.5 text-xs text-ink-3">{sample.why}</p> : null}
              </div>
              <dl className="m-0 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                {rows.map((r) => (
                  <div key={r.key} className="contents">
                    <dt className="flex min-w-0 items-baseline gap-1 text-ink-3" title={r.label}>
                      {/* a changed value is marked by a dot and said in words, not by colour */}
                      <span
                        aria-hidden="true"
                        className={`size-1.5 shrink-0 translate-y-[-1px] rounded-full ${
                          r.change === "changed" ? "bg-accent" : "bg-transparent"
                        }`}
                      />
                      <span className="truncate">{r.label}</span>
                    </dt>
                    <dd className="m-0 min-w-0">
                      <span className="line-clamp-2 break-words text-ink" title={r.value}>
                        {r.value}
                      </span>
                      {r.change === "changed" ? (
                        <span className="sr-only"> (replaces what is in the form)</span>
                      ) : null}
                    </dd>
                  </div>
                ))}
              </dl>
              {changed > 0 && !inForm ? (
                <p className="m-0 flex items-center gap-1.5 text-2xs text-ink-3">
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />
                  Replaces {changed} of {rows.length} values in the form
                </p>
              ) : null}
              <div className="mt-auto pt-1">
                {inForm ? (
                  <p className="m-0 flex items-center gap-1 text-xs text-ok-text">
                    <Check className="size-3.5" strokeWidth={2} aria-hidden="true" />
                    In the form
                  </p>
                ) : (
                  <Button
                    size="sm"
                    variant={i === 0 ? "primary" : "secondary"}
                    aria-label={`Use “${sample.title}”`}
                    onClick={() => onApply(sample)}
                  >
                    Use this
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
