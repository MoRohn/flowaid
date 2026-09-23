import { useState, type ReactNode } from "react";
import { Button } from "@/primitives";
import type { HumanResponse } from "@/types";
import { ApprovalCard, type ApprovalRecord } from "./ApprovalCard";
import { ApprovalOutcomeBadge, type ApprovalOutcome } from "./ApprovalOutcomeBadge";
import { EscalationDialog } from "./EscalationDialog";
import { ManualChoice } from "./ManualChoice";
import { ProposedOutputEditor } from "./ProposedOutputEditor";
import { ReviewPage } from "./ReviewPage";
import { ReviewQueue, type ReviewQueueItem } from "./ReviewQueue";
import { SlaChip } from "./SlaChip";
import {
  APPROVE_REJECT_REQUEST,
  EDIT_OUTPUT_REQUEST,
  ESCALATION_TARGETS,
  FIXTURE_NOW,
  FORM_REQUEST,
  NODE_RUNS,
  PROPOSED_REPLY,
  TOOL_APPROVAL_REQUEST,
  QUEUE_ITEMS,
  SELECT_REQUEST,
  TEAM_OPTIONS,
  WORKFLOW_NAME,
  shiftQueueToNow,
} from "./fixtures";

const THRESHOLDS = { review: 0.75, auto: 0.9 };
const MIN = 60_000;

function Section({
  title,
  caption,
  children,
  wide = false,
}: {
  title: string;
  caption: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <section className={wide ? "flex flex-col gap-3" : "flex max-w-[640px] flex-col gap-3"}>
      <div className="flex flex-col gap-1">
        <h2 className="text-eyebrow">{title}</h2>
        <p className="m-0 text-xs text-ink-3">{caption}</p>
      </div>
      {children}
    </section>
  );
}

function ResponseLog({ response }: { response: HumanResponse | null }) {
  return (
    <div className="flex items-center gap-2 rounded-sm border border-dashed border-border px-3 py-1.5 font-mono text-2xs text-ink-3">
      <span className="text-ink-3">onRespond →</span>
      <span className="truncate text-ink-2">
        {response ? JSON.stringify(response) : "(nothing yet)"}
      </span>
    </div>
  );
}

function LiveCard(props: Omit<Parameters<typeof ApprovalCard>[0], "onRespond">) {
  const [last, setLast] = useState<HumanResponse | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <ApprovalCard {...props} onRespond={setLast} />
      <ResponseLog response={last} />
    </div>
  );
}

const RESPONDED: ApprovalRecord = {
  response: {
    action: "reject",
    comment:
      "Two invoices, but #48211 is for a second workspace the customer created in March. Only #48212 is a duplicate; refund that one.",
  },
  by: "Priya Shah",
  at: new Date(FIXTURE_NOW - 2 * MIN).toISOString(),
};

const RESPONDED_EDIT: ApprovalRecord = {
  response: {
    action: "approve",
    value: PROPOSED_REPLY.replace("5 to 7 business days", "3 to 5 business days"),
  },
  by: "Mei Tanaka",
  at: new Date(FIXTURE_NOW - 40_000).toISOString(),
};

const OUTCOMES: ApprovalOutcome[] = ["approved", "rejected", "edited", "escalated", "expired"];

export default function HumanGallery() {
  // The "live" examples count down from when the gallery opened (read once, not per render).
  const [openedAt] = useState(() => Date.now());
  const [escalateOpen, setEscalateOpen] = useState(false);
  const [escalation, setEscalation] = useState<string>("(nothing yet)");
  const [liveQueue] = useState<ReviewQueueItem[]>(() => shiftQueueToNow(QUEUE_ITEMS, Date.now()));
  const [queue, setQueue] = useState<ReviewQueueItem[]>(liveQueue);
  const [activeId, setActiveId] = useState<string | undefined>(undefined);
  const [choice, setChoice] = useState<string | null>(null);
  const [draft, setDraft] = useState(PROPOSED_REPLY);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 p-6 sm:p-8">
      <div className="flex max-w-[640px] flex-col gap-1">
        <h1 className="m-0 text-lg font-semibold tracking-tight">Human</h1>
        <p className="m-0 text-sm text-ink-2">
          Human-in-the-loop review. A run pauses when a decision's confidence falls below its
          threshold; these surfaces show the reviewer why, what the model proposed, and take one
          typed response.
        </p>
      </div>

      <Section
        title="ApprovalCard · approval"
        caption="A refund action. Approve (A), Reject (R) and Escalate (E) work from the keyboard outside text fields; the decision card carries the confidence meter against the gate thresholds."
      >
        <LiveCard
          request={APPROVE_REJECT_REQUEST}
          workflowName={WORKFLOW_NAME}
          thresholds={THRESHOLDS}
          escalationTargets={ESCALATION_TARGETS}
          now={FIXTURE_NOW}
        />
      </Section>

      <Section
        title="ApprovalCard · review"
        caption="A generated customer reply. Edit swaps in a textarea; once the text differs, the inline diff and Reset appear and the primary action becomes “Approve with edits”."
      >
        <LiveCard
          request={EDIT_OUTPUT_REQUEST}
          workflowName={WORKFLOW_NAME}
          thresholds={THRESHOLDS}
          escalationTargets={ESCALATION_TARGETS}
          now={FIXTURE_NOW}
          hotkeys={false}
        />
      </Section>

      <Section
        title="ApprovalCard · choice"
        caption="Four teams with the model's probabilities. The model's pick is highlighted, never pre-selected; 1–9 choose a row. The primary action stays disabled until a choice is made."
      >
        <LiveCard
          request={SELECT_REQUEST}
          workflowName={WORKFLOW_NAME}
          thresholds={THRESHOLDS}
          escalationTargets={ESCALATION_TARGETS}
          now={FIXTURE_NOW}
          hotkeys={false}
        />
      </Section>

      <Section
        title="ApprovalCard · form"
        caption="A small JSON Schema rendered by SchemaForm. Submit returns { action: 'submit', value }."
      >
        <LiveCard
          request={FORM_REQUEST}
          workflowName={WORKFLOW_NAME}
          thresholds={THRESHOLDS}
          escalationTargets={ESCALATION_TARGETS}
          now={FIXTURE_NOW}
          hotkeys={false}
        />
      </Section>

      <Section
        title="ApprovalCard · agent tool approval"
        caption="An agent suspended before a side-effecting tool call (origin task_suspend). No decision or SLA on this one; the origin badge says why the task exists."
      >
        <LiveCard
          request={TOOL_APPROVAL_REQUEST}
          workflowName={WORKFLOW_NAME}
          escalationTargets={ESCALATION_TARGETS}
          now={FIXTURE_NOW}
          hotkeys={false}
        />
      </Section>

      <Section
        title="ApprovalCard · submitting and responded"
        caption="While onRespond is pending every control locks and the pressed button spins. A responded card is locked and shows the outcome, the reviewer and when."
      >
        <ApprovalCard
          request={APPROVE_REJECT_REQUEST}
          workflowName={WORKFLOW_NAME}
          escalationTargets={ESCALATION_TARGETS}
          now={FIXTURE_NOW}
          submitting
          hotkeys={false}
          onRespond={() => undefined}
        />
        <ApprovalCard
          request={APPROVE_REJECT_REQUEST}
          workflowName={WORKFLOW_NAME}
          thresholds={THRESHOLDS}
          now={FIXTURE_NOW}
          responded={RESPONDED}
          hotkeys={false}
          onRespond={() => undefined}
        />
        <ApprovalCard
          request={EDIT_OUTPUT_REQUEST}
          workflowName={WORKFLOW_NAME}
          now={FIXTURE_NOW}
          responded={RESPONDED_EDIT}
          hotkeys={false}
          onRespond={() => undefined}
        />
      </Section>

      <Section
        title="ProposedOutputEditor"
        caption="Standalone. Change a phrase to see the diff against the original and the character / token estimate."
      >
        <div className="rounded-md border border-border bg-surface p-4 shadow-1">
          <ProposedOutputEditor original={PROPOSED_REPLY} value={draft} onChange={setDraft} />
        </div>
      </Section>

      <Section
        title="ManualChoice"
        caption="Rows with probability bars. Focus the group and press 1–4, or use the arrow keys."
      >
        <div className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4 shadow-1">
          <ManualChoice
            options={TEAM_OPTIONS}
            value={choice}
            onValueChange={setChoice}
            aria-label="Team"
          />
          <div className="flex items-center justify-between font-mono text-2xs text-ink-3">
            <span>selected: {choice ?? "—"}</span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setChoice(null)}
              disabled={choice === null}
            >
              Clear
            </Button>
          </div>
          <ManualChoice
            options={TEAM_OPTIONS.slice(0, 2)}
            defaultValue="billing"
            disabled
            aria-label="Team (disabled)"
          />
        </div>
      </Section>

      <Section
        title="EscalationDialog"
        caption="Team or person, a reason, and whether to notify now. Returns { action: 'escalate', to: [target], comment }."
      >
        <div className="flex items-center gap-3 rounded-md border border-border bg-surface p-4 shadow-1">
          <Button onClick={() => setEscalateOpen(true)}>Open escalation dialog</Button>
          <span className="truncate font-mono text-2xs text-ink-3">{escalation}</span>
        </div>
        <EscalationDialog
          open={escalateOpen}
          onOpenChange={setEscalateOpen}
          targets={ESCALATION_TARGETS}
          subject="Refund $180.00 to Amara Okafor"
          onEscalate={(response, options) =>
            setEscalation(JSON.stringify({ ...response, notify: options.notify }))
          }
        />
      </Section>

      <Section
        title="SlaChip and ApprovalOutcomeBadge"
        caption="SLA states at 42 min, 12 min, 3 min and past due (ticking live below), and the five outcomes."
      >
        <div className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4 shadow-1">
          <div className="flex flex-wrap items-center gap-2">
            <SlaChip expiresAt={FIXTURE_NOW + 42 * MIN} now={FIXTURE_NOW} />
            <SlaChip expiresAt={FIXTURE_NOW + 12 * MIN} now={FIXTURE_NOW} />
            <SlaChip expiresAt={FIXTURE_NOW + 3 * MIN} now={FIXTURE_NOW} />
            <SlaChip expiresAt={FIXTURE_NOW - 30_000} now={FIXTURE_NOW} />
            <SlaChip expiresAt={FIXTURE_NOW + 12 * MIN} now={FIXTURE_NOW} size="sm" />
            <SlaChip expiresAt={FIXTURE_NOW + 3 * MIN} now={FIXTURE_NOW} size="sm" noIcon />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-2xs text-ink-3">live:</span>
            <SlaChip expiresAt={openedAt + 4 * MIN + 30_000} />
            <SlaChip expiresAt={openedAt + 25_000} size="sm" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {OUTCOMES.map((o) => (
              <ApprovalOutcomeBadge key={o} outcome={o} />
            ))}
            {OUTCOMES.map((o) => (
              <ApprovalOutcomeBadge key={`${o}-sm`} outcome={o} size="sm" noIcon />
            ))}
          </div>
        </div>
      </Section>

      <Section
        title="ReviewQueue"
        caption="Eight pending reviews sorted by SLA; waiting time ticks live. Low-risk rows can be selected and approved together after confirmation. Enter opens a row; arrows move."
        wide
      >
        <div className="max-w-[880px]">
          <ReviewQueue
            items={queue}
            activeId={activeId}
            onOpen={(item) => setActiveId(item.id)}
            onBulkApprove={(ids) => setQueue((q) => q.filter((i) => !ids.includes(i.id)))}
          />
          <div className="mt-2 flex items-center gap-2 font-mono text-2xs text-ink-3">
            <span>active: {activeId ?? "—"}</span>
            {queue.length !== liveQueue.length ? (
              <Button size="sm" variant="ghost" onClick={() => setQueue(liveQueue)}>
                Restore
              </Button>
            ) : null}
          </div>
        </div>
        <div className="max-w-[880px]">
          <ReviewQueue items={[]} onOpen={() => undefined} onBulkApprove={() => undefined} />
        </div>
      </Section>

      <Section
        title="ReviewPage"
        caption="The external review link: a centred 640px column with the card and a collapsible “Run so far”. No app shell."
        wide
      >
        <div className="overflow-hidden rounded-md border border-border">
          <ReviewPage
            card={{
              request: EDIT_OUTPUT_REQUEST,
              workflowName: WORKFLOW_NAME,
              thresholds: THRESHOLDS,
              escalationTargets: ESCALATION_TARGETS,
              now: FIXTURE_NOW,
              hotkeys: false,
              onRespond: () => undefined,
            }}
            nodeRuns={NODE_RUNS}
            runId="run_01J8XM5F3K"
            defaultRunOpen
            onOpenRun={() => undefined}
          />
        </div>
      </Section>
    </div>
  );
}
