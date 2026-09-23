/**
 * Editor for a decision batch's questions (`x-ui.widget: "questions"`): a record of question id →
 * `{ kind, instructions, criteria | options | levels }`, the shape `flowaid.decision.batch` sends
 * to TypeSafe in one request. Each question reuses the CriteriaEditor for its kind-specific part.
 */
import { useId, useState } from "react";
import { Plus, X } from "lucide-react";
import { Button, IconButton, Input, Label, Textarea } from "@/primitives";
import { CriteriaEditor, type DecisionCriteria } from "./CriteriaEditor";

/** One question as stored in the node config. */
export type BatchQuestion =
  | { kind: "boolean"; instructions: string; criteria?: { true: string; false: string } }
  | { kind: "choice"; instructions: string; options: Record<string, string> }
  | { kind: "score"; instructions: string; levels: string[] };

export type BatchQuestions = Record<string, BatchQuestion>;

const QUESTION_ID = /^[a-z][a-z0-9_]{0,63}$/;

function toCriteria(question: BatchQuestion): DecisionCriteria {
  switch (question.kind) {
    case "boolean":
      return {
        kind: "boolean",
        trueCriteria: question.criteria?.true ?? "",
        falseCriteria: question.criteria?.false ?? "",
      };
    case "choice":
      return {
        kind: "choice",
        options: Object.entries(question.options).map(([key, description]) => ({
          key,
          description,
        })),
      };
    case "score":
      return { kind: "score", levels: [...question.levels] };
  }
}

function fromCriteria(instructions: string, criteria: DecisionCriteria): BatchQuestion {
  switch (criteria.kind) {
    case "boolean": {
      const t = criteria.trueCriteria ?? "";
      const f = criteria.falseCriteria ?? "";
      // Both descriptions or neither (the compiler's E_DECISION_CONFIG rule).
      return t === "" && f === ""
        ? { kind: "boolean", instructions }
        : { kind: "boolean", instructions, criteria: { true: t, false: f } };
    }
    case "choice": {
      const options: Record<string, string> = {};
      for (const option of criteria.options)
        if (option.key !== "") options[option.key] = option.description;
      return { kind: "choice", instructions, options };
    }
    case "score":
      return { kind: "score", instructions, levels: [...criteria.levels] };
  }
}

function nextId(existing: BatchQuestions): string {
  let n = Object.keys(existing).length + 1;
  while (`question_${n}` in existing) n += 1;
  return `question_${n}`;
}

export interface QuestionsEditorProps {
  value: BatchQuestions;
  onChange: (next: BatchQuestions) => void;
  disabled?: boolean;
  "aria-label"?: string;
}

interface Row {
  id: string;
  question: BatchQuestion;
}

const rowsOf = (value: BatchQuestions): Row[] =>
  Object.entries(value).map(([id, question]) => ({ id, question }));

/** The record a list of rows stands for; while two rows share an id only the first is kept. */
function recordOf(rows: readonly Row[]): BatchQuestions {
  const out: BatchQuestions = {};
  for (const row of rows) if (!(row.id in out)) out[row.id] = row.question;
  return out;
}

export function QuestionsEditor({
  value,
  onChange,
  disabled,
  "aria-label": ariaLabel,
}: QuestionsEditorProps) {
  const baseId = useId();
  // Rows are the source of truth while editing: a record cannot hold two questions with one
  // id, and a rename must never silently merge questions.
  const [rows, setRows] = useState<Row[]>(() => rowsOf(value));
  const [lastEmitted, setLastEmitted] = useState<BatchQuestions>(value);
  if (value !== lastEmitted) {
    setLastEmitted(value);
    if (JSON.stringify(value) !== JSON.stringify(recordOf(rows))) setRows(rowsOf(value));
  }
  const commit = (next: Row[]) => {
    setRows(next);
    const record = recordOf(next);
    setLastEmitted(record);
    onChange(record);
  };
  const replace = (index: number, id: string, question: BatchQuestion) =>
    commit(rows.map((row, i) => (i === index ? { id, question } : row)));
  const remove = (index: number) => commit(rows.filter((_, i) => i !== index));
  const add = () =>
    commit([
      ...rows,
      { id: nextId(recordOf(rows)), question: { kind: "boolean", instructions: "" } },
    ]);
  const entries = rows.map((row) => [row.id, row.question] as const);

  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-col gap-3">
      {entries.length === 0 ? (
        <p className="text-xs text-ink-3">
          No questions yet. Every question is answered in the same decision request.
        </p>
      ) : null}
      {entries.map(([id, question], index) => {
        const fieldId = `${baseId}-${index}`;
        const duplicate = entries.some(([other], i) => i !== index && other === id);
        const idInvalid = !QUESTION_ID.test(id) || duplicate;
        return (
          <div
            key={index}
            className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3"
          >
            <div className="flex items-end gap-2">
              <div className="flex flex-1 flex-col gap-1">
                <Label htmlFor={`${fieldId}-id`}>Question id</Label>
                <Input
                  id={`${fieldId}-id`}
                  value={id}
                  disabled={disabled}
                  aria-invalid={idInvalid || undefined}
                  className="font-mono"
                  onChange={(event) => replace(index, event.target.value, question)}
                />
              </div>
              <IconButton
                label={`Remove question ${id}`}
                disabled={disabled}
                onClick={() => remove(index)}
              >
                <X />
              </IconButton>
            </div>
            {idInvalid ? (
              <p className="text-xs text-danger-text" role="alert">
                {duplicate
                  ? "Another question already uses this id."
                  : "Use snake_case: a lowercase letter, then letters, digits or _."}
              </p>
            ) : null}
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${fieldId}-instructions`}>Instructions</Label>
              <Textarea
                id={`${fieldId}-instructions`}
                value={question.instructions}
                disabled={disabled}
                rows={2}
                aria-invalid={question.instructions.trim() === "" || undefined}
                onChange={(event) =>
                  replace(index, id, { ...question, instructions: event.target.value })
                }
              />
            </div>
            <CriteriaEditor
              aria-label={`Answer for ${id}`}
              value={toCriteria(question)}
              onChange={(criteria) =>
                replace(index, id, fromCriteria(question.instructions, criteria))
              }
              disabled={disabled}
              hidePreview
            />
          </div>
        );
      })}
      <div>
        <Button size="sm" variant="ghost" leadingIcon={<Plus />} onClick={add} disabled={disabled}>
          Add question
        </Button>
      </div>
    </div>
  );
}
