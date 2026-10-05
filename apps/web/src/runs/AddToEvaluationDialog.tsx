"use client";
/** Adds a run's input (and, optionally, its output as the expectation) to an evaluation set. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldHint,
  FieldRow,
  Label,
  Select,
  SelectItem,
  toast,
} from "@flowaid/ui/primitives";
import { get, getAll, post } from "~/api/client";
import { errorMessage } from "~/shell/states";
import type { EvaluationSetSummary } from "./types";

export interface AddToEvaluationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ws: string;
  runId: string;
  workflowId: string;
  /** The run's output, offered as the expected output. */
  output: unknown;
}

export function AddToEvaluationDialog({
  open,
  onOpenChange,
  ws,
  runId,
  workflowId,
  output,
}: AddToEvaluationDialogProps) {
  const qc = useQueryClient();
  const [setId, setSetId] = useState<string>("");
  const [expectOutput, setExpectOutput] = useState(output !== undefined && output !== null);
  const sets = useQuery({
    queryKey: ["evaluation-sets", ws, "for", workflowId],
    queryFn: () => getAll<EvaluationSetSummary>("/v1/evaluations/sets"),
    // the sets tied to this workflow, and those tied to none (any workflow can be tested on them)
    select: (rows) =>
      rows
        .filter((s) => s.workflowId === workflowId || s.workflowId === null)
        .sort((a, b) => Number(b.workflowId !== null) - Number(a.workflowId !== null)),
    enabled: open,
  });
  // the only set that fits this workflow is the one meant
  const only = sets.data?.length === 1 ? sets.data[0]?.id : undefined;
  const chosen = setId || only || "";
  // a run already in the set would only be a second copy of the same case
  const cases = useQuery({
    queryKey: ["evaluation-cases", ws, chosen],
    queryFn: () =>
      get<{ items: { ordinal: number; sourceRunId: string | null }[] }>(
        `/v1/evaluations/sets/${chosen}/cases?limit=200`,
      ),
    enabled: open && chosen !== "",
  });
  const already = cases.data?.items.find((c) => c.sourceRunId === runId);
  const add = useMutation({
    mutationFn: () =>
      post(`/v1/runs/${runId}/add-to-evaluation`, {
        setId: chosen,
        ...(expectOutput && output !== undefined && output !== null
          ? { expected: { output: [{ path: "", matcher: { type: "equals", value: output } }] } }
          : {}),
      }),
    onSuccess: () => {
      toast.success("Added to the evaluation set");
      void qc.invalidateQueries({ queryKey: ["evaluation-cases", ws, chosen] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Add to evaluation</DialogTitle>
          <DialogDescription>
            The run&apos;s input becomes a case of the set, with its decisions (each question of a
            step that asks several), branches and outcome as the expectation, so every future
            version is checked against it.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <FieldRow>
            <Label htmlFor="eval-set">Evaluation set</Label>
            <Select
              id="eval-set"
              value={chosen}
              onValueChange={setSetId}
              placeholder={
                sets.isPending
                  ? "Loading…"
                  : sets.data?.length
                    ? "Choose a set"
                    : "No sets for this workflow"
              }
              disabled={!sets.data?.length}
            >
              {(sets.data ?? []).map((s) => (
                <SelectItem
                  key={s.id}
                  value={s.id}
                  {...(s.workflowId === null ? { description: "Any workflow" } : {})}
                >
                  {s.name}
                </SelectItem>
              ))}
            </Select>
            {already ? (
              <FieldHint>
                <span className="text-warn-text">
                  This run is already case {already.ordinal + 1} of the set.
                </span>
              </FieldHint>
            ) : null}
            {sets.data?.length === 0 ? (
              <FieldHint>
                <a className="text-accent-text hover:underline" href={`/${ws}/evaluations`}>
                  Create an evaluation set
                </a>{" "}
                for this workflow first.
              </FieldHint>
            ) : null}
          </FieldRow>
          {output !== undefined && output !== null ? (
            <label className="flex items-center gap-2 text-sm text-ink">
              <Checkbox
                checked={expectOutput}
                onCheckedChange={(v) => setExpectOutput(v === true)}
              />
              Expect this run&apos;s output
            </label>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!chosen || Boolean(already)}
            loading={add.isPending}
            onClick={() => add.mutate()}
          >
            Add case
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
