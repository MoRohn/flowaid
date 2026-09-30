"use client";
/**
 * Create an evaluation set: what it checks, which workflow it tests, then a review. Built step
 * by step (or all at once, "All fields"); the draft is kept in this browser tab until the set is
 * created, and creating it ends on how to fill and run it. Creating a set runs nothing.
 */
import Link from "next/link";
import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldRow,
  Input,
  Select,
  SelectItem,
  Textarea,
} from "@flowaid/ui/primitives";
import { post } from "~/api/client";
import type { WorkflowSummary } from "~/api/types";
import type { EvaluationSet } from "~/admin/types";
import { useMutate } from "~/admin/ui";
import { DraftStatus, GuidedFlow, type FlowStep } from "~/guide/GuidedFlow";
import { CheckList, QualityNote, blockers, type Check } from "~/guide/Readiness";
import { useKeptDraft } from "~/guide/useKeptDraft";
import { useSession } from "~/session";
import { ANY_WORKFLOW, emptySetDraft, setBody, setReviewNotes, type SetDraft } from "./logic";

export function NewSetDialog({
  open,
  onOpenChange,
  workflows,
  existingNames,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  workflows: readonly WorkflowSummary[];
  /** names already taken in this workspace */
  existingNames: readonly string[];
}) {
  const s = useSession();
  // the draft survives closing the dialog in this tab
  const kept = useKeptDraft<SetDraft>(`flowaid:draft:${s.ws}:evaluation-set`, emptySetDraft);
  const { draft: d, setDraft } = kept;
  const [created, setCreated] = useState<EvaluationSet | null>(null);
  const set = <K extends keyof SetDraft>(k: K, v: SetDraft[K]) =>
    setDraft((prev) => ({ ...prev, [k]: v }));
  // a kept draft may name a workflow deleted since
  const workflowId = workflows.some((w) => w.id === d.workflowId) ? d.workflowId : ANY_WORKFLOW;
  const workflowName = workflows.find((w) => w.id === workflowId)?.name ?? null;
  const draft = { ...d, workflowId };
  const create = useMutate(() => post<EvaluationSet>("/v1/evaluations/sets", setBody(draft)), {
    success: (x) => `Created ${x.name}`,
    invalidate: [["evaluation-sets", s.ws]],
    onSuccess: (x) => {
      kept.discard();
      setCreated(x);
    },
    // the draft stays in the form (and in this tab) so nothing typed is lost
    errorTitle: "Could not create the set",
  });
  const notes = setReviewNotes(draft, { existingNames, workflowName });
  const checks: Check[] = notes.map((n) => ({ id: n.id, label: n.message, state: n.state }));
  const blocked = blockers(checks).length > 0;
  const nameNote = notes.find((n) => n.id === "name-taken");

  const steps: FlowStep[] = [
    {
      id: "goal",
      title: "Say what it checks",
      why: "A set is one promise about a workflow, such as “refunds reach the right team”. Name it after that promise; the description says what a failure would mean.",
      done: d.name.trim().length > 0 && !nameNote,
      requirement: nameNote ? "choose a name no other set uses" : "give the set a name",
      example: (
        <>
          <strong className="font-medium text-ink">Refund routing</strong> — “Refund requests reach
          the refunds branch; anything over $500 is passed to a person.” An example: describe your
          own workflow's promise.
        </>
      ),
      children: (
        <>
          <FieldRow
            label="Name"
            htmlFor="set-name"
            required
            error={nameNote ? "Another set already has this name" : undefined}
          >
            <Input
              id="set-name"
              value={d.name}
              maxLength={200}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Refund routing regression"
            />
          </FieldRow>
          <FieldRow label="Description" htmlFor="set-desc" optional>
            <Textarea
              id="set-desc"
              rows={2}
              maxLength={2000}
              value={d.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="What must keep working, and why it matters"
            />
          </FieldRow>
        </>
      ),
    },
    {
      id: "workflow",
      title: "Choose the workflow",
      why: "Tie the set to the workflow it tests. Its runs can then be added as cases from the run page, new cases get the workflow's input form, and running the set needs no workflow choice.",
      done: workflowId !== ANY_WORKFLOW,
      optional: true,
      example:
        "Keep Any workflow only for a set shared by several workflows that take the same input, such as two versions of a router you are comparing.",
      children: (
        <FieldRow
          label="Workflow"
          htmlFor="set-wf"
          hint={
            workflows.length === 0 ? (
              <>
                No workflows yet.{" "}
                <a className="text-accent-text hover:underline" href={`/${s.ws}/workflows`}>
                  Create one
                </a>{" "}
                first; this draft is kept.
              </>
            ) : (
              "Tie the set to one workflow, or keep it reusable"
            )
          }
        >
          <Select id="set-wf" value={workflowId} onValueChange={(v) => set("workflowId", v)}>
            <SelectItem value={ANY_WORKFLOW}>Any workflow</SelectItem>
            {workflows.map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.name}
              </SelectItem>
            ))}
          </Select>
        </FieldRow>
      ),
    },
    {
      id: "review",
      title: "Review and create",
      why: "Creating the set saves it empty. Nothing runs until you add cases and press Run evaluation on its page.",
      done: !blocked,
      doneLabel: "Ready to create",
      requirement: "fix the items marked as needed",
      children: (
        <>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-sm border border-border px-3 py-2 text-sm">
            <dt className="text-ink-3">Name</dt>
            <dd className="m-0 text-ink">{d.name.trim() || "—"}</dd>
            <dt className="text-ink-3">Workflow</dt>
            <dd className="m-0 text-ink">{workflowName ?? "Any workflow"}</dd>
          </dl>
          <CheckList checks={checks} aria-label="Before you create" />
          <QualityNote>
            A set is only as good as its cases. A pass rate means something once the cases cover
            typical requests, edge cases and requests that must reach a person, and expect a
            specific answer rather than only a finished run.
          </QualityNote>
        </>
      ),
    },
  ];

  // the draft is cleared once the set exists: name its workflow from the set itself
  const createdFor = workflows.find((w) => w.id === created?.workflowId)?.name;
  if (created)
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 strokeWidth={1.75} className="size-4 text-ok-text" aria-hidden />
              {created.name} is created
            </DialogTitle>
            <DialogDescription>The set is empty. To put it to work:</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <ol className="m-0 flex list-decimal flex-col gap-1.5 pl-5 text-sm text-ink-2">
              <li>
                Add cases. The quickest way is from real runs: open a finished run
                {createdFor ? ` of ${createdFor}` : ""} and choose Add to evaluation. You can also
                write them by hand on the set's page.
              </li>
              <li>Cover typical requests, edge cases and requests that must reach a person.</li>
              <li>
                Press Run evaluation and choose the draft or a published version. Every case runs
                the workflow for real, so its model and tool calls happen and may cost money.
              </li>
              <li>Read the report: which cases failed, and which expectation each one missed.</li>
            </ol>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Done
            </Button>
            <Button variant="primary" asChild>
              <Link href={`/${s.ws}/evaluations/sets/${created.id}`}>Open {created.name}</Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>New evaluation set</DialogTitle>
          <DialogDescription>
            Cases pair an input with what the run must produce: outputs, decisions, branches, tools,
            latency and cost.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <GuidedFlow
            steps={steps}
            status={
              <DraftStatus
                dirty={kept.dirty}
                restored={kept.restored}
                onDiscard={kept.discard}
                what="the set"
              />
            }
          />
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            type="button"
            variant="primary"
            loading={create.isPending}
            disabled={blocked}
            onClick={() => create.mutate(undefined)}
          >
            Create set
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
