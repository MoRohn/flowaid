import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { ArrowUpRight, Braces, Check, ChevronRight, Info, Lock, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { DecisionCard } from "@/decision";
import { JsonView } from "@/data";
import { SchemaForm, fromContractSchema, type SchemaFormHandle } from "@/forms";
import {
  Avatar,
  Badge,
  Button,
  CategoryDot,
  Collapsible,
  FieldRow,
  Hint,
  Kbd,
  Textarea,
} from "@/primitives";
import type {
  ApprovalRequestView,
  ConfidenceThresholds,
  HumanRequest,
  HumanResponse,
  JsonValue,
} from "@/types";
import { assertNever } from "@/types";
import { ApprovalOutcomeBadge, approvalOutcomeFor } from "./ApprovalOutcomeBadge";
import { EscalationDialog, type EscalationTarget } from "./EscalationDialog";
import { isEditableTarget, ManualChoice, type ManualChoiceOption } from "./ManualChoice";
import { ProposedOutputEditor } from "./ProposedOutputEditor";
import { SlaChip } from "./SlaChip";
import { formatAbsolute, formatRelativeShort, useReviewNow } from "./time";

/** A finished review: what was answered, by whom and when. */
export interface ApprovalRecord {
  response: HumanResponse;
  by?: string;
  at: string;
}

export interface ApprovalCardProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  request: ApprovalRequestView;
  /** Shown in the breadcrumb before the node name. */
  workflowName?: string;
  /** The single output: every button and shortcut ends here with a `HumanResponse` (CONTRACTS.ts §9). */
  onRespond: (response: HumanResponse) => void | Promise<void>;
  /** Externally tracked busy state. When `onRespond` returns a promise the card tracks it itself. */
  submitting?: boolean;
  /** Locks the card and shows the outcome. */
  responded?: ApprovalRecord;
  /** Gate thresholds; renders the confidence meter under the decision. */
  thresholds?: ConfidenceThresholds;
  /** Teams and people offered by the Escalate action. Omit to hide it. */
  escalationTargets?: EscalationTarget[];
  /** Document-level A / R / E (and 1–9 for choice) shortcuts. Default true. */
  hotkeys?: boolean;
  /** Freeze the clock (tests, snapshots). */
  now?: number;
  /** Title for the triggering decision card. Default "Triggering decision". */
  decisionTitle?: ReactNode;
}

type PrimaryAction = "approve" | "reject" | "escalate";

const MESSAGE_KEYS = ["message", "text", "body", "content", "prompt", "query"] as const;

/** Why the task exists (`HumanRequest.origin`), as a short badge. */
export const ORIGIN_LABEL: Record<HumanRequest["origin"], string> = {
  human_node: "Human step",
  task_suspend: "Agent tool approval",
  decision_failover: "Decision failover",
};

interface ContextShape {
  message?: string;
  pairs: Array<{ key: string; value: string | number | boolean | null }>;
  nested: number;
}

/** Splits an arbitrary context into a readable message, primitive pairs and a nested count. */
export function shapeContext(context: unknown): ContextShape {
  if (typeof context === "string") return { message: context, pairs: [], nested: 0 };
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    return { pairs: [], nested: context === undefined || context === null ? 0 : 1 };
  }
  const record: Record<string, unknown> = { ...context };
  let message: string | undefined;
  const pairs: ContextShape["pairs"] = [];
  let nested = 0;
  for (const [key, value] of Object.entries(record)) {
    if (
      message === undefined &&
      typeof value === "string" &&
      (MESSAGE_KEYS as readonly string[]).includes(key)
    ) {
      message = value;
      continue;
    }
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      pairs.push({ key, value });
    } else {
      nested += 1;
    }
  }
  return { message, pairs, nested };
}

/** "accountAgeDays" → "Account age days", "ticket_id" → "Ticket id". */
export function humanizeKey(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** The text a `review` value edits as: strings as-is, everything else as pretty JSON. */
export function reviewValueText(value: JsonValue): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

/** Parses an edited review value back: strings stay strings, JSON otherwise; `undefined` when the JSON is invalid. */
export function parseReviewValue(original: JsonValue, text: string): JsonValue | undefined {
  if (typeof original === "string") return text;
  try {
    const parsed: unknown = JSON.parse(text);
    return isJsonValue(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Drops `undefined` properties (optional form fields left empty) so the values are plain JSON. */
function stripUndefined(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripUndefined);
  if (typeof v === "object" && v !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) if (val !== undefined) out[k] = stripUndefined(val);
    return out;
  }
  return v;
}

function isJsonValue(v: unknown): v is JsonValue {
  if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean")
    return true;
  if (Array.isArray(v)) return v.every(isJsonValue);
  if (typeof v === "object") return Object.values(v).every(isJsonValue);
  return false;
}

/** Choice options with the triggering decision's probabilities attached when it was a choice. */
export function choiceOptions(request: ApprovalRequestView): ManualChoiceOption[] {
  const mode = request.request.mode;
  if (mode.type !== "choice") return [];
  const probabilities =
    request.decision?.kind === "choice" ? request.decision.probabilities : undefined;
  return mode.options.map((o) => {
    const option: ManualChoiceOption = { id: o.id, label: o.label };
    const p = probabilities?.[o.id];
    if (p !== undefined) option.probability = p;
    return option;
  });
}

/** Renders decimals such as "0.71" in the mono face inside a sentence. */
function withMonoNumbers(text: string): ReactNode[] {
  return text.split(/(\d+(?:\.\d+)?%?|\$\d[\d,]*(?:\.\d+)?)/g).map((part, i) =>
    /^(\d|\$)/.test(part) ? (
      <span key={i} className="font-mono font-medium tabular text-ink">
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

function SectionLabel({ children, meta }: { children: ReactNode; meta?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-eyebrow">{children}</span>
      {meta ? <span className="font-mono text-2xs text-ink-3 tabular">{meta}</span> : null}
    </div>
  );
}

function ContextBlock({ context }: { context: unknown }) {
  const shape = useMemo(() => shapeContext(context), [context]);
  const hasRaw = context !== undefined && context !== null;
  return (
    <div className="flex flex-col gap-2.5">
      {shape.message ? (
        <blockquote className="m-0 whitespace-pre-wrap rounded-sm border border-border bg-surface-2 px-3 py-2.5 text-sm leading-normal text-ink">
          {shape.message}
        </blockquote>
      ) : null}
      {shape.pairs.length > 0 ? (
        <dl className="grid grid-cols-[minmax(96px,auto)_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
          {shape.pairs.map(({ key, value }) => (
            <div key={key} className="contents">
              <dt className="truncate text-ink-3">{humanizeKey(key)}</dt>
              <dd
                className={cn(
                  "m-0 min-w-0 truncate text-ink",
                  typeof value !== "string" && "font-mono tabular",
                )}
              >
                {value === null ? "null" : String(value)}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {hasRaw ? (
        <Collapsible
          title={
            <span className="inline-flex items-center gap-1.5">
              <Braces className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
              Raw JSON
            </span>
          }
          meta={shape.nested > 0 ? `${shape.nested} nested` : undefined}
          contentClassName="pl-0"
        >
          <div className="rounded-sm border border-border bg-surface-2 p-1">
            <JsonView value={context} toolbar={false} expandDepth={1} />
          </div>
        </Collapsible>
      ) : null}
    </div>
  );
}

function ValueBlock({ value }: { value: JsonValue }) {
  if (typeof value === "string") {
    return (
      <div className="whitespace-pre-wrap rounded-sm border border-border bg-surface-2 px-3 py-2.5 text-sm leading-normal text-ink">
        {value}
      </div>
    );
  }
  return (
    <div className="rounded-sm border border-border bg-surface-2 p-1">
      <JsonView value={value} toolbar={false} expandDepth={1} />
    </div>
  );
}

/**
 * The review surface for one human task. Header (workflow › node, requested
 * time, SLA, assignees, origin), the reason the run stopped, the decision
 * that triggered it, the redacted context, the mode-specific response
 * control (`approval`, `review`, `form`, `choice`), a comment and the action
 * row. Every path ends in `onRespond` with a `HumanResponse`. With
 * `responded` the card locks and shows who answered what, and when.
 */
export const ApprovalCard = forwardRef<HTMLDivElement, ApprovalCardProps>(function ApprovalCard(
  {
    request,
    workflowName,
    onRespond,
    submitting,
    responded,
    thresholds,
    escalationTargets,
    hotkeys = true,
    now: fixedNow,
    decisionTitle = "Triggering decision",
    className,
    ...rest
  },
  ref,
) {
  const task = request.request;
  const mode = task.mode;
  const originalText = mode.type === "review" ? reviewValueText(mode.value) : "";
  const now = useReviewNow(30_000, !responded, fixedNow);
  const [comment, setComment] = useState("");
  const [output, setOutput] = useState(originalText);
  const [optionId, setOptionId] = useState<string | null>(null);
  const formRef = useRef<SchemaFormHandle>(null);
  const [escalateOpen, setEscalateOpen] = useState(false);
  const [pending, setPending] = useState<PrimaryAction | null>(null);

  // A different request (or a changed original value) starts a fresh draft. Adjusted during
  // render from the previous key, React's pattern for resetting state on a prop change.
  const draftKey = JSON.stringify([request.id, originalText]);
  const [draftFor, setDraftFor] = useState(draftKey);
  if (draftFor !== draftKey) {
    setDraftFor(draftKey);
    setOutput(originalText);
    setOptionId(null);
    setComment("");
  }

  const locked = Boolean(responded);
  const busy = submitting || pending !== null;
  const trimmedComment = comment.trim();
  const commentOrNone = trimmedComment ? { comment: trimmedComment } : {};
  const canEscalate = Boolean(escalationTargets && escalationTargets.length > 0);
  const showComment = mode.type !== "form";
  const outputEdited = mode.type === "review" && output !== originalText;
  const editedValue =
    mode.type === "review" && outputEdited ? parseReviewValue(mode.value, output) : undefined;
  const options = useMemo(() => choiceOptions(request), [request]);
  const formSchema = useMemo(
    () => (mode.type === "form" ? fromContractSchema(mode.schema) : undefined),
    [mode],
  );

  const primaryResponse = useMemo<HumanResponse | null>(() => {
    switch (mode.type) {
      case "approval":
        return { action: "approve", ...commentOrNone };
      case "review":
        if (!outputEdited) return { action: "approve", ...commentOrNone };
        return editedValue === undefined
          ? null
          : { action: "approve", value: editedValue, ...commentOrNone };
      case "choice":
        return optionId ? { action: "choose", option: optionId, ...commentOrNone } : null;
      case "form":
        // Validated and read from the SchemaForm handle at submit time.
        return { action: "submit", value: {} };
      default:
        return assertNever(mode, "human request mode");
    }
  }, [mode, commentOrNone, outputEdited, editedValue, optionId]);

  const primaryLabel =
    mode.type === "choice"
      ? "Confirm choice"
      : mode.type === "form"
        ? "Submit"
        : outputEdited
          ? "Approve with edits"
          : "Approve";

  const submit = useCallback(
    async (action: PrimaryAction, response: HumanResponse) => {
      if (locked || busy) return;
      const result = onRespond(response);
      if (result instanceof Promise) {
        setPending(action);
        try {
          await result;
        } finally {
          setPending(null);
        }
      }
    },
    [locked, busy, onRespond],
  );

  const approve = useCallback(() => {
    if (!primaryResponse) return;
    if (mode.type === "form") {
      // SchemaForm validates, then hands the values to onSubmit below.
      formRef.current?.submit();
      return;
    }
    void submit("approve", primaryResponse);
  }, [mode.type, primaryResponse, submit]);
  const reject = useCallback(() => {
    void submit("reject", { action: "reject", ...commentOrNone });
  }, [commentOrNone, submit]);

  useEffect(() => {
    if (!hotkeys || locked || busy || escalateOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (isEditableTarget(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === "a" && primaryResponse) {
        e.preventDefault();
        approve();
      } else if (key === "r") {
        e.preventDefault();
        reject();
      } else if (key === "e" && canEscalate) {
        e.preventDefault();
        setEscalateOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [hotkeys, locked, busy, escalateOpen, primaryResponse, approve, reject, canEscalate]);

  const outcome = responded ? approvalOutcomeFor(responded.response) : null;
  const escalatedTo = responded?.response.action === "escalate" ? responded.response.to : undefined;
  const respondedComment =
    responded && "comment" in responded.response ? responded.response.comment : undefined;
  const assignees = task.assignees;
  const expiresAt = task.expiresAt ?? undefined;

  return (
    <div
      ref={ref}
      data-mode={mode.type}
      data-origin={task.origin}
      data-responded={locked || undefined}
      aria-busy={busy || undefined}
      className={cn(
        "flex min-w-0 flex-col rounded-md border border-border bg-surface text-ink shadow-1",
        locked && "border-border-strong",
        className,
      )}
      {...rest}
    >
      {/* Header */}
      <header className="flex flex-col gap-2 border-b border-border px-4 pt-3.5 pb-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-ink-3">
            <CategoryDot category="human" size={7} />
            {workflowName ? (
              <>
                <span className="truncate">{workflowName}</span>
                <ChevronRight className="size-3 shrink-0" strokeWidth={1.75} aria-hidden="true" />
              </>
            ) : null}
            <span className="truncate font-medium text-ink-2">{request.nodeName}</span>
            <span className="hidden shrink-0 font-mono text-2xs text-ink-3 sm:inline">
              {request.id}
            </span>
          </div>
          {outcome ? (
            <ApprovalOutcomeBadge outcome={outcome} />
          ) : expiresAt ? (
            <SlaChip expiresAt={expiresAt} now={fixedNow} ticking={fixedNow === undefined} />
          ) : null}
        </div>
        <h2 className="m-0 text-base font-semibold leading-tight tracking-tight text-ink">
          {task.title}
        </h2>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
          <Hint hint={formatAbsolute(request.requestedAt)}>
            Requested {formatRelativeShort(request.requestedAt, now)}
          </Hint>
          {assignees.length > 0 ? (
            <span className="inline-flex items-center gap-1.5">
              <Avatar name={assignees[0] ?? ""} size="xs" />
              <span className="text-ink-2">{assignees.join(", ")}</span>
            </span>
          ) : (
            <span>Unassigned</span>
          )}
          {task.origin !== "human_node" ? (
            <Badge tone="outline" size="sm" data-origin={task.origin}>
              {ORIGIN_LABEL[task.origin]}
            </Badge>
          ) : null}
          {task.externalReview ? (
            <Badge tone="outline" size="sm">
              External review
            </Badge>
          ) : null}
        </div>
      </header>

      <div className="flex flex-col gap-5 px-4 py-4">
        {/* Reason */}
        {request.reason ? (
          <div className="flex items-start gap-2.5 rounded-sm border border-accent-soft-2 bg-accent-soft/50 px-3 py-2.5">
            <Info
              className="mt-0.5 size-4 shrink-0 text-accent"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-eyebrow">Why you are seeing this</span>
              <p className="m-0 text-sm leading-normal text-ink-2">
                {withMonoNumbers(request.reason)}
              </p>
            </div>
          </div>
        ) : null}

        {/* Decision */}
        {request.decision ? (
          <section className="flex flex-col gap-2">
            <SectionLabel>Decision</SectionLabel>
            <DecisionCard
              result={request.decision}
              title={decisionTitle}
              thresholds={thresholds}
              compact
            />
          </section>
        ) : null}

        {/* Context */}
        {Object.keys(task.context).length > 0 ? (
          <section className="flex flex-col gap-2">
            <SectionLabel>Context</SectionLabel>
            <ContextBlock context={task.context} />
          </section>
        ) : null}

        {/* Response control */}
        {locked ? (
          <section className="flex flex-col gap-2">
            <SectionLabel>Response</SectionLabel>
            {responded?.response.action === "approve" && responded.response.value !== undefined ? (
              <ValueBlock value={responded.response.value} />
            ) : null}
            {responded?.response.action === "approve" &&
            responded.response.value === undefined &&
            mode.type === "review" ? (
              <ValueBlock value={mode.value} />
            ) : null}
            {responded?.response.action === "choose" ? (
              <ManualChoice
                options={options}
                value={responded.response.option}
                disabled
                hotkeys="off"
                aria-label={task.title}
              />
            ) : null}
            {responded?.response.action === "submit" ? (
              <ValueBlock value={responded.response.value} />
            ) : null}
            {escalatedTo !== undefined ? (
              <p className="m-0 text-sm text-ink-2">
                Handed to{" "}
                <span className="font-medium text-ink">
                  {escalatedTo
                    .map((id) => escalationTargets?.find((t) => t.id === id)?.name ?? id)
                    .join(", ")}
                </span>
                .
              </p>
            ) : null}
            {respondedComment ? (
              <p className="m-0 border-l-2 border-border-strong pl-3 text-sm italic text-ink-2">
                {respondedComment}
              </p>
            ) : null}
          </section>
        ) : (
          <>
            {mode.type === "review" ? (
              <section className="flex flex-col gap-2">
                <SectionLabel meta={typeof mode.value === "string" ? undefined : "JSON"}>
                  Proposed output
                </SectionLabel>
                <ProposedOutputEditor
                  original={originalText}
                  value={output}
                  onChange={setOutput}
                  disabled={busy}
                />
                {outputEdited && editedValue === undefined ? (
                  <p role="alert" className="m-0 text-xs text-danger-text">
                    The edited value must be valid JSON.
                  </p>
                ) : null}
              </section>
            ) : null}

            {mode.type === "choice" ? (
              <section className="flex flex-col gap-2">
                <SectionLabel meta="1–9 to pick">Choose</SectionLabel>
                <ManualChoice
                  options={options}
                  value={optionId}
                  onValueChange={setOptionId}
                  modelPick={
                    request.decision?.kind === "choice" ? request.decision.value : undefined
                  }
                  hotkeys={hotkeys ? "document" : "focus"}
                  disabled={busy}
                  aria-label={task.title}
                />
              </section>
            ) : null}

            {mode.type === "form" && formSchema ? (
              <section className="flex flex-col gap-2">
                <SectionLabel>Details</SectionLabel>
                <SchemaForm
                  ref={formRef}
                  schema={formSchema}
                  onSubmit={(values) => {
                    const value = stripUndefined(values);
                    if (!isJsonValue(value)) return;
                    void submit("approve", { action: "submit", value });
                  }}
                  disabled={busy}
                  aria-label={task.title}
                />
              </section>
            ) : null}

            {showComment ? (
              <FieldRow label="Comment" optional hint="Kept on the run's audit trail.">
                <Textarea
                  autoGrow
                  minRows={2}
                  maxRows={6}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Why you decided this way"
                  disabled={busy}
                />
              </FieldRow>
            ) : null}
          </>
        )}
      </div>

      {/* Footer */}
      {locked && responded && outcome ? (
        <footer className="flex flex-wrap items-center gap-2 rounded-b-md border-t border-border bg-surface-2 px-4 py-2.5 text-xs text-ink-2">
          <Lock className="size-3.5 text-ink-3" strokeWidth={1.75} aria-hidden="true" />
          <ApprovalOutcomeBadge outcome={outcome} size="sm" noIcon />
          <span>
            by <span className="font-medium text-ink">{responded.by ?? "unknown reviewer"}</span>
          </span>
          <Hint hint={formatAbsolute(responded.at)} className="text-ink-3">
            {formatRelativeShort(responded.at, now)}
          </Hint>
        </footer>
      ) : (
        <footer className="flex flex-wrap items-center gap-2 rounded-b-md border-t border-border bg-surface-2 px-4 py-2.5">
          {canEscalate ? (
            <Button
              variant="ghost"
              disabled={busy}
              loading={pending === "escalate"}
              leadingIcon={<ArrowUpRight strokeWidth={1.75} aria-hidden="true" />}
              onClick={() => setEscalateOpen(true)}
            >
              Escalate
              {hotkeys ? <Kbd aria-hidden="true">E</Kbd> : null}
            </Button>
          ) : null}
          <span className="flex-1" />
          <Button
            variant="danger"
            disabled={busy}
            loading={pending === "reject"}
            leadingIcon={<X strokeWidth={1.75} aria-hidden="true" />}
            onClick={reject}
          >
            Reject
            {hotkeys ? <Kbd aria-hidden="true">R</Kbd> : null}
          </Button>
          <Button
            variant="primary"
            disabled={busy || !primaryResponse}
            loading={pending === "approve"}
            leadingIcon={<Check strokeWidth={2} aria-hidden="true" />}
            onClick={approve}
          >
            {primaryLabel}
            {hotkeys ? (
              <Kbd
                aria-hidden="true"
                className="border-accent-ink/30 bg-transparent text-accent-ink"
              >
                A
              </Kbd>
            ) : null}
          </Button>
        </footer>
      )}

      {canEscalate && escalationTargets ? (
        <EscalationDialog
          open={escalateOpen}
          onOpenChange={setEscalateOpen}
          targets={escalationTargets}
          subject={task.title}
          onEscalate={(response) => submit("escalate", response)}
        />
      ) : null}
    </div>
  );
});
