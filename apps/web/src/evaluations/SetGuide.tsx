"use client";
/**
 * Inline guidance on an evaluation set's page: how its cases cover the workflow (computed from
 * the cases themselves), what an expectation can check, and how to read a report. Each panel
 * collapses to one line and remembers that per browser.
 */
import type { ReactNode } from "react";
import { ChevronDown, ChevronRight, Compass } from "lucide-react";
import { Button } from "@flowaid/ui/primitives";
import { CheckList, type Check } from "~/guide/Readiness";
import { usePref } from "~/guide/storage";
import type { Note } from "./logic";

export const toChecks = (notes: readonly Note[]): Check[] =>
  notes.map((n) => ({ id: n.id, label: n.message, state: n.state }));

/** A titled panel that folds to one line; `defaultOpen` applies until the reader chooses. */
export function GuidePanel({
  id,
  title,
  defaultOpen,
  children,
}: {
  /** remembers the open state */
  id: string;
  title: string;
  defaultOpen: boolean;
  children: ReactNode;
}) {
  const [pref, setPref] = usePref(`flowaid:intro:${id}`, "");
  const open = pref === "" ? defaultOpen : pref === "shown";
  const headingId = `guide-${id}`;
  if (!open)
    return (
      <button
        type="button"
        onClick={() => setPref("shown")}
        aria-expanded={false}
        className="inline-flex items-center gap-1.5 self-start rounded-xs text-xs font-medium text-ink-2 hover:text-ink focus-visible:shadow-(--focus) focus-visible:outline-none"
      >
        <ChevronRight className="size-3.5 text-ink-3" strokeWidth={1.75} aria-hidden />
        <Compass className="size-3.5 text-accent-text" strokeWidth={1.75} aria-hidden />
        {title}
      </button>
    );
  return (
    <section
      aria-labelledby={headingId}
      className="rounded-md border border-border bg-surface shadow-1"
    >
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <Compass className="size-4 text-accent-text" strokeWidth={1.75} aria-hidden />
        <h2 id={headingId} className="m-0 flex-1 text-sm font-semibold text-ink">
          {title}
        </h2>
        <Button
          size="sm"
          variant="ghost"
          leadingIcon={<ChevronDown strokeWidth={1.75} />}
          aria-expanded
          onClick={() => setPref("hidden")}
        >
          Hide
        </Button>
      </div>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

export function Tips({ items }: { items: readonly ReactNode[] }) {
  return (
    <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-xs leading-snug text-ink-2">
      {items.map((t, i) => (
        <li key={i}>{t}</li>
      ))}
    </ul>
  );
}

/** "Writing good cases" on the set's page, with coverage computed from the cases. */
export function CaseGuide({ coverage, count }: { coverage: readonly Note[]; count: number }) {
  return (
    <GuidePanel id="evaluation-cases" title="Writing good cases" defaultOpen={count < 5}>
      <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <p className="m-0 text-xs font-semibold text-ink">What a useful set holds</p>
          <Tips
            items={[
              "Typical requests: the ones the workflow handles every day.",
              "Edge cases: missing fields, odd wording, two requests in one, other languages.",
              "Requests that must reach a person: expect “humanExpected”: true, or the branch that escalates.",
              <>
                Real inputs: open a finished run and choose{" "}
                <strong className="font-medium text-ink">Add to evaluation</strong>. Its input,
                decisions, branches and outcome become the case; edit what it should have done if
                the run got it wrong.
              </>,
              "Expectations about the answer (an output value, a decision, a branch), not only a finished run.",
            ]}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <p className="m-0 text-xs font-semibold text-ink">This set so far</p>
          {coverage.length ? (
            <CheckList checks={toChecks(coverage)} aria-label="How the cases cover the workflow" />
          ) : (
            <p className="m-0 text-xs text-ink-3">No cases yet.</p>
          )}
        </div>
      </div>
    </GuidePanel>
  );
}

/** A starting expectation for the case form, meant to be edited (node and port ids are examples). */
export const EXAMPLE_EXPECTATION = {
  status: "completed",
  output: [{ path: "/answer", matcher: { type: "contains", value: "refund" } }],
  decisions: { classify: { value: "refund", minConfidence: 0.7 } },
  branches: { route: "refunds" },
  humanExpected: false,
  maxCostUsd: 0.05,
};

/** What an expectation can check, beside the case form's JSON. */
export function ExpectationHelp() {
  return (
    <details className="group rounded-sm border border-border bg-surface-2 px-3 py-2 text-xs text-ink-2">
      <summary className="cursor-pointer font-medium text-ink marker:text-ink-3">
        What an expectation can check
      </summary>
      <dl className="m-0 mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
        <Term name="output">
          A list of <code className="font-mono">path</code> (a JSON pointer into the run's output,{" "}
          <code className="font-mono">""</code> for all of it) and a{" "}
          <code className="font-mono">matcher</code>: equals, contains, regex, schema, range or
          judge.
        </Term>
        <Term name="decisions">
          Per Decision step id: the <code className="font-mono">value</code> (or{" "}
          <code className="font-mono">valueIn</code>, <code className="font-mono">range</code>) and
          a <code className="font-mono">minConfidence</code>.
        </Term>
        <Term name="branches">Per branch, gate or router step id: the port it must take.</Term>
        <Term name="requiredNodes / forbiddenNodes">Steps that must, or must not, run.</Term>
        <Term name="requiredTools / forbiddenTools">Tools an agent must, or must not, call.</Term>
        <Term name="status / outcome">
          How the run ends. Without either, the case expects{" "}
          <code className="font-mono">completed</code>.
        </Term>
        <Term name="humanExpected">Whether the run should ask a person at all.</Term>
        <Term name="human">
          Per human step id, the answer the evaluation gives in place of a person (default:
          approve). No one is asked during an evaluation.
        </Term>
        <Term name="maxLatencyMs / maxCostUsd">Upper bounds for one run.</Term>
      </dl>
      <p className="m-0 mt-2 text-ink-3">
        Judge matchers need a judge model, which the evaluation worker in this release does not
        configure: they fail with “no judge provider is configured”.
      </p>
    </details>
  );
}

function Term({ name, children }: { name: string; children: ReactNode }) {
  return (
    <>
      <dt className="font-mono text-ink">{name}</dt>
      <dd className="m-0">{children}</dd>
    </>
  );
}
