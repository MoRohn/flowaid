import {
  forwardRef,
  useCallback,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent,
} from "react";
import { Check, ChevronRight, Inbox, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  Avatar,
  Button,
  CategoryDot,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  Hint,
} from "@/primitives";
import type { ApprovalRequestView } from "@/types";
import { SlaChip, slaState, type SlaThresholds } from "./SlaChip";
import { formatDurationShort, toEpochMs, useReviewNow } from "./time";

export type ReviewRisk = "low" | "medium" | "high";

/** A pending approval as the queue lists it: the request plus its workflow and a risk class. */
export interface ReviewQueueItem extends ApprovalRequestView {
  workflowName: string;
  /** Low-risk items are eligible for bulk approval. */
  risk?: ReviewRisk;
}

/**
 * Orders reviews by urgency: soonest SLA first, items without an SLA last,
 * ties broken by who has been waiting longest. Pure and stable.
 */
export function sortBySla<T extends Pick<ApprovalRequestView, "request" | "requestedAt">>(
  items: readonly T[],
): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const ea = a.item.request.expiresAt
        ? toEpochMs(a.item.request.expiresAt)
        : Number.POSITIVE_INFINITY;
      const eb = b.item.request.expiresAt
        ? toEpochMs(b.item.request.expiresAt)
        : Number.POSITIVE_INFINITY;
      if (ea !== eb) return ea - eb;
      const ra = toEpochMs(a.item.requestedAt);
      const rb = toEpochMs(b.item.requestedAt);
      if (ra !== rb) return ra - rb;
      return a.index - b.index;
    })
    .map((x) => x.item);
}

export interface ReviewQueueProps extends Omit<HTMLAttributes<HTMLDivElement>, "onSelect"> {
  items: ReviewQueueItem[];
  /** Called when a row is activated (click, Enter, Space). */
  onOpen: (item: ReviewQueueItem) => void;
  /** Bulk approval of the selected low-risk items. Omit to hide selection. */
  onBulkApprove?: (ids: string[]) => void | Promise<void>;
  /** Id of the review currently open elsewhere (highlighted). */
  activeId?: string;
  slaThresholds?: Partial<SlaThresholds>;
  /** Freeze the clock (tests, snapshots). */
  now?: number;
  /** Header title; omit for a bare list. */
  title?: string;
}

/**
 * Pending reviews, most urgent first. Each row names the workflow and node,
 * shows why the run stopped, how long it has waited (live), the assignee and
 * the SLA state. Low-risk rows can be selected and approved in one confirmed
 * action.
 */
export const ReviewQueue = forwardRef<HTMLDivElement, ReviewQueueProps>(function ReviewQueue(
  {
    items,
    onOpen,
    onBulkApprove,
    activeId,
    slaThresholds,
    now: fixedNow,
    title = "Reviews",
    className,
    ...rest
  },
  ref,
) {
  const now = useReviewNow(1000, true, fixedNow);
  const sorted = useMemo(() => sortBySla(items), [items]);
  const lowRisk = useMemo(() => sorted.filter((i) => i.risk === "low"), [sorted]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);

  const selectedIds = useMemo(
    () => lowRisk.filter((i) => selected.has(i.id)).map((i) => i.id),
    [lowRisk, selected],
  );
  const allLowSelected = lowRisk.length > 0 && selectedIds.length === lowRisk.length;
  const someLowSelected = selectedIds.length > 0 && !allLowSelected;

  const toggle = useCallback((id: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const toggleAll = (on: boolean) => {
    setSelected(on ? new Set(lowRisk.map((i) => i.id)) : new Set());
  };

  const confirmBulk = async () => {
    if (!onBulkApprove) return;
    await onBulkApprove(selectedIds);
    setSelected(new Set());
  };

  const focusRow = (index: number) => {
    const clamped = Math.max(0, Math.min(sorted.length - 1, index));
    rowRefs.current[clamped]?.focus();
  };

  const onRowKey = (e: KeyboardEvent<HTMLDivElement>, index: number, item: ReviewQueueItem) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen(item);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      focusRow(index + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusRow(index - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      focusRow(0);
    } else if (e.key === "End") {
      e.preventDefault();
      focusRow(sorted.length - 1);
    }
  };

  const showSelection = Boolean(onBulkApprove) && lowRisk.length > 0;

  return (
    <div
      ref={ref}
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-md border border-border bg-surface shadow-1",
        className,
      )}
      {...rest}
    >
      <div className="flex h-10 items-center gap-3 border-b border-border px-3">
        {showSelection ? (
          <Checkbox
            aria-label="Select all low-risk reviews"
            checked={allLowSelected ? true : someLowSelected ? "indeterminate" : false}
            onCheckedChange={(v) => toggleAll(v === true)}
          />
        ) : null}
        <span className="text-sm font-semibold tracking-tight text-ink">{title}</span>
        <span className="font-mono text-2xs text-ink-3 tabular">{sorted.length}</span>
        <span className="flex-1" />
        {showSelection ? (
          <Button
            size="sm"
            variant={selectedIds.length > 0 ? "primary" : "secondary"}
            disabled={selectedIds.length === 0}
            leadingIcon={<Check strokeWidth={2} aria-hidden="true" />}
            onClick={() => setConfirmOpen(true)}
          >
            Approve selected
            {selectedIds.length > 0 ? (
              <span className="font-mono text-2xs font-normal tabular opacity-80">
                {selectedIds.length}
              </span>
            ) : null}
          </Button>
        ) : null}
      </div>

      {sorted.length === 0 ? (
        <EmptyState
          size="sm"
          icon={<Inbox strokeWidth={1.75} aria-hidden="true" />}
          title="No reviews waiting"
          description="Runs pause here when a decision's confidence falls below its threshold or a step asks for approval."
        />
      ) : (
        <ul role="list" className="divide-y divide-border">
          {sorted.map((item, index) => {
            const waiting = now - toEpochMs(item.requestedAt);
            const isLow = item.risk === "low";
            const isSelected = selected.has(item.id);
            const expiresAt = item.request.expiresAt ?? undefined;
            const assignee = item.request.assignees[0];
            const sla = expiresAt ? slaState(toEpochMs(expiresAt) - now) : undefined;
            const isActive = item.id === activeId;
            return (
              <li key={item.id} className="relative">
                <div
                  ref={(el) => {
                    rowRefs.current[index] = el;
                  }}
                  role="button"
                  tabIndex={0}
                  aria-current={isActive ? "true" : undefined}
                  aria-label={`${item.workflowName}, ${item.nodeName}: ${item.request.title}`}
                  data-risk={item.risk}
                  data-sla={sla}
                  onClick={() => onOpen(item)}
                  onKeyDown={(e) => onRowKey(e, index, item)}
                  className={cn(
                    "group/row flex min-h-14 w-full cursor-pointer items-center gap-3 px-3 py-2 text-left outline-none",
                    "transition-colors duration-(--dur-fast) hover:bg-surface-2 focus-visible:bg-surface-2",
                    isActive && "bg-accent-soft/40 hover:bg-accent-soft/50",
                    sla === "danger" && "shadow-[inset_2px_0_0_0_var(--danger)]",
                    sla === "warn" && "shadow-[inset_2px_0_0_0_var(--warn)]",
                    isActive && "shadow-[inset_2px_0_0_0_var(--accent)]",
                  )}
                >
                  {showSelection ? (
                    <span
                      role="presentation"
                      className="flex h-5 w-4 shrink-0 items-center"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      {isLow ? (
                        <Checkbox
                          aria-label={`Select ${item.request.title}`}
                          checked={isSelected}
                          onCheckedChange={(v) => toggle(item.id, v === true)}
                        />
                      ) : null}
                    </span>
                  ) : null}
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex min-w-0 items-center gap-1.5 text-xs text-ink-3">
                      <CategoryDot category="human" size={6} />
                      <span className="truncate">{item.workflowName}</span>
                      <ChevronRight
                        className="size-3 shrink-0"
                        strokeWidth={1.75}
                        aria-hidden="true"
                      />
                      <span className="truncate font-medium text-ink">{item.nodeName}</span>
                      {isLow ? (
                        <Hint
                          hint="Eligible for bulk approval"
                          className="ml-1 inline-flex h-4 shrink-0 items-center gap-1 rounded-xs bg-ok-soft px-1 text-2xs font-medium leading-none text-ok-text"
                        >
                          <ShieldCheck className="size-2.5" strokeWidth={2} aria-hidden="true" />
                          Low risk
                        </Hint>
                      ) : null}
                    </div>
                    <div className="truncate text-sm text-ink">{item.request.title}</div>
                    {item.reason ? (
                      <div className="truncate text-xs text-ink-3">{item.reason}</div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center sm:gap-3">
                    <Hint
                      hint="Waiting since request"
                      className="font-mono text-2xs text-ink-3 tabular"
                    >
                      {formatDurationShort(waiting)}
                    </Hint>
                    {expiresAt ? (
                      <SlaChip
                        expiresAt={expiresAt}
                        size="sm"
                        now={fixedNow}
                        ticking={fixedNow === undefined}
                        thresholds={slaThresholds}
                      />
                    ) : (
                      <span className="font-mono text-2xs text-ink-3">no SLA</span>
                    )}
                    {assignee ? (
                      <Avatar name={assignee} size="sm" />
                    ) : (
                      <Hint
                        hint="Unassigned"
                        className="inline-block size-5 rounded-full border border-dashed border-border-strong"
                      />
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {onBulkApprove ? (
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title={`Approve ${selectedIds.length} low-risk ${selectedIds.length === 1 ? "review" : "reviews"}`}
          description="Each run resumes with the proposed action as if you had approved it individually. This is recorded under your name."
          confirmLabel="Approve all"
          icon={<ShieldCheck strokeWidth={1.75} aria-hidden="true" />}
          onConfirm={confirmBulk}
        >
          <ul className="flex flex-col gap-1">
            {lowRisk
              .filter((i) => selected.has(i.id))
              .map((i) => (
                <li key={i.id} className="flex min-w-0 items-center gap-2 text-xs">
                  <CategoryDot category="human" size={6} />
                  <span className="truncate text-ink-2">{i.workflowName}</span>
                  <ChevronRight
                    className="size-3 shrink-0 text-ink-3"
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                  <span className="truncate text-ink">{i.request.title}</span>
                </li>
              ))}
          </ul>
        </ConfirmDialog>
      ) : null}
    </div>
  );
});
