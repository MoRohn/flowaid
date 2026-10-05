"use client";
/** Adds a run's input (and, optionally, its output as the expectation) to an evaluation set. */
import { useMutation, useQuery } from "@tanstack/react-query";
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
import { getAll, post } from "~/api/client";
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
  const [setId, setSetId] = useState<string>("");
  const [expectOutput, setExpectOutput] = useState(output !== undefined && output !== null);
  const sets = useQuery({
    queryKey: ["evaluation-sets", ws, workflowId],
    queryFn: () => getAll<EvaluationSetSummary>("/v1/evaluations/sets", { workflowId }),
    enabled: open,
  });
  // the only set that fits this workflow is the one meant
  const only = sets.data?.length === 1 ? sets.data[0]?.id : undefined;
  const chosen = setId || only || "";
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
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </Select>
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
            disabled={!chosen}
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
