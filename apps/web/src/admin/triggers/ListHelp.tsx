"use client";
/**
 * "What these settings mean" beside the live webhook and schedule lists (Triggers and a
 * workflow's settings): each environment-specific control and what it does, closed by default
 * and reopened from the same line.
 */
import { HelpCircle } from "lucide-react";

export const WEBHOOK_TERMS: readonly { term: string; text: string }[] = [
  {
    term: "One row per environment",
    text: "The same webhook deployed to dev and prod shows twice, each with its own URL, secret and settings.",
  },
  {
    term: "Enabled",
    text: "Off: calls answer 404, as if the URL did not exist. A webhook removed from the workflow is switched off at its next deployment, never deleted.",
  },
  {
    term: "Signing secret",
    text: "Generate secret creates the secret for this environment and shows it once; signed webhooks refuse every call until it exists. Rotate replaces it at once, so update the sender straight after.",
  },
  {
    term: "Require signed timestamp",
    text: "The signature must cover a timestamp within 5 minutes of now, and each signature is accepted once, so a captured call cannot be replayed. Turn it off only for senders that cannot send X-Timestamp.",
  },
  {
    term: "Idempotency header",
    text: "The header holding the sender's delivery id (for example X-Delivery-Id). A call repeating an id seen in the last 24 hours starts no second run. Left empty, two calls with identical bodies within 24 hours count as one.",
  },
  {
    term: "Deliveries",
    text: "Every call, newest first: Accepted started a run, Duplicate repeated an earlier call, Rejected says why (bad signature, stale timestamp, input that does not match the workflow).",
  },
];

export const SCHEDULE_TERMS: readonly { term: string; text: string }[] = [
  {
    term: "Next and last",
    text: "When the next run starts, and when the last one did (open it with “run”). Paused means Enabled is off.",
  },
  {
    term: "Red line",
    text: "Why the last tick did not start a run: for example the previous run was still going, or the workflow is no longer deployed in this environment.",
  },
  {
    term: "Overlap",
    text: "Skip (default) starts no run while the previous one is still going; Allow starts it anyway.",
  },
  {
    term: "Missed runs",
    text: "What happens after the scheduler was stopped past a run time: Run all starts one run per missed time, up to the limit; Skip and Run once start a single run.",
  },
  {
    term: "Jitter",
    text: "Delays each run by a random amount up to this many seconds, to spread load when many schedules share a time.",
  },
  {
    term: "Run now",
    text: "Starts one real run straight away, with the schedule's input, in its environment. It does not move the next run.",
  },
];

export function ListHelp({
  terms,
  title = "What these settings mean",
}: {
  terms: readonly { term: string; text: string }[];
  title?: string;
}) {
  return (
    <details className="group mb-3 rounded-md border border-border bg-surface-2 text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-1.5 font-medium text-ink-2 select-none hover:text-ink">
        <HelpCircle className="size-3.5 text-accent-text" strokeWidth={1.75} aria-hidden />
        {title}
      </summary>
      <dl className="m-0 grid gap-x-4 gap-y-1.5 border-t border-border px-3 py-2 sm:grid-cols-[11rem_minmax(0,1fr)]">
        {terms.map((t) => (
          <div key={t.term} className="contents">
            <dt className="font-medium text-ink">{t.term}</dt>
            <dd className="m-0 text-ink-2">{t.text}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
