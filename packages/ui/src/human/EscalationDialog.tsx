import { useState, type ReactNode } from "react";
import { ArrowUpRight, User, Users } from "lucide-react";
import {
  Avatar,
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldRow,
  Select,
  SelectGroup,
  SelectItem,
  Textarea,
} from "@/primitives";
import type { HumanResponse } from "@/types";

export interface EscalationTarget {
  id: string;
  name: string;
  kind: "team" | "person";
  /** One line under the name: a role, a queue depth, a timezone. */
  description?: string;
  avatarSrc?: string;
}

export type EscalateResponse = Extract<HumanResponse, { action: "escalate" }>;

export interface EscalationOptions {
  /** Whether the target should be notified immediately (Slack, email). */
  notify: boolean;
}

export interface EscalationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targets: EscalationTarget[];
  /** Pre-selected target id. */
  defaultTo?: string;
  /** Initial notify state. Default true. */
  defaultNotify?: boolean;
  /** What is being escalated, for the description line. */
  subject?: ReactNode;
  /** Returns the escalate response and whether to notify. */
  onEscalate: (response: EscalateResponse, options: EscalationOptions) => void | Promise<void>;
  /** Externally tracked busy state. */
  loading?: boolean;
  className?: string;
}

/**
 * Hands a review to another team or person. Picks a target from `targets`
 * (grouped into teams and people), takes a reason and whether to notify, and
 * returns `{ action: "escalate", to: [target], comment }`. Escalate is disabled until a
 * target is chosen; Escape closes without submitting.
 */
export function EscalationDialog({
  open,
  onOpenChange,
  targets,
  defaultTo,
  defaultNotify = true,
  subject,
  onEscalate,
  loading,
  className,
}: EscalationDialogProps) {
  const [to, setTo] = useState<string | undefined>(defaultTo);
  const [comment, setComment] = useState("");
  const [notify, setNotify] = useState(defaultNotify);
  const [pending, setPending] = useState(false);
  const busy = loading ?? pending;

  // Opening the dialog (or new defaults while open) starts from the defaults again. Adjusted
  // during render from the previous key, React's pattern for resetting state on a prop change.
  const resetKey = open ? JSON.stringify([defaultTo ?? null, defaultNotify]) : null;
  const [resetFor, setResetFor] = useState(resetKey);
  if (resetFor !== resetKey) {
    setResetFor(resetKey);
    if (open) {
      setTo(defaultTo);
      setComment("");
      setNotify(defaultNotify);
    }
  }

  const teams = targets.filter((t) => t.kind === "team");
  const people = targets.filter((t) => t.kind === "person");
  const target = targets.find((t) => t.id === to);

  const submit = async () => {
    if (!to || busy) return;
    const trimmed = comment.trim();
    const response: EscalateResponse = trimmed
      ? { action: "escalate", to: [to], comment: trimmed }
      : { action: "escalate", to: [to] };
    const result = onEscalate(response, { notify });
    if (result instanceof Promise) {
      setPending(true);
      try {
        await result;
        onOpenChange(false);
      } finally {
        setPending(false);
      }
    } else {
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <DialogContent size="sm" className={className}>
        <DialogHeader className="flex-row items-start gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2 text-ink-2 [&_svg]:size-4">
            <ArrowUpRight strokeWidth={1.75} aria-hidden="true" />
          </span>
          <div className="flex min-w-0 flex-col gap-1 pt-0.5">
            <DialogTitle>Escalate review</DialogTitle>
            <DialogDescription>
              {subject ? (
                <>
                  Hand <span className="text-ink">{subject}</span> to someone else. The run stays
                  paused until they respond.
                </>
              ) : (
                "Hand this review to someone else. The run stays paused until they respond."
              )}
            </DialogDescription>
          </div>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <FieldRow label="Escalate to" required>
            <Select
              value={to}
              onValueChange={setTo}
              placeholder="Choose a team or person"
              leading={
                target?.kind === "person" ? (
                  <User strokeWidth={1.75} />
                ) : (
                  <Users strokeWidth={1.75} />
                )
              }
              disabled={busy}
            >
              {teams.length > 0 ? (
                <SelectGroup label="Teams">
                  {teams.map((t) => (
                    <SelectItem
                      key={t.id}
                      value={t.id}
                      description={t.description}
                      icon={<Users strokeWidth={1.75} />}
                    >
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ) : null}
              {people.length > 0 ? (
                <SelectGroup label="People">
                  {people.map((p) => (
                    <SelectItem
                      key={p.id}
                      value={p.id}
                      description={p.description}
                      icon={<Avatar name={p.name} src={p.avatarSrc} size="sm" />}
                    >
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ) : null}
            </Select>
          </FieldRow>
          <FieldRow
            label="Reason"
            optional
            hint="Shown to the person picking this up, and kept on the run's audit trail."
          >
            <Textarea
              autoGrow
              minRows={3}
              maxRows={8}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="What should they look at?"
              disabled={busy}
            />
          </FieldRow>
          <Checkbox
            checked={notify}
            onCheckedChange={(v) => setNotify(v === true)}
            disabled={busy}
            label="Notify now"
            description="Send a message to the target's configured channel as soon as the review is handed over."
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!to}
            loading={busy}
            onClick={() => {
              void submit();
            }}
            leadingIcon={<ArrowUpRight strokeWidth={1.75} aria-hidden="true" />}
          >
            Escalate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
