import {
  forwardRef,
  useId,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatProbability } from "@/lib/format";
import type { DecisionKind } from "@/types";
import {
  Button,
  FieldError,
  IconButton,
  Input,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
  useControllableState,
  useFieldControl,
} from "@/primitives";
import { DistributionList, ProbabilityRuler, type DistributionEntry } from "@/decision";
import { LevelsList } from "./LevelsList";
import { ReorderableList } from "./ReorderableList";

export interface ChoiceOption {
  /** snake_case identifier the decision returns. */
  key: string;
  /** What this option means, shown to the decision model. */
  description: string;
}

export type DecisionCriteria =
  | { kind: "choice"; options: ChoiceOption[] }
  | { kind: "score"; levels: string[] }
  | { kind: "boolean"; trueCriteria?: string; falseCriteria?: string };

export interface CriteriaIssue {
  /** Path into the criteria value, e.g. "options[2].key" or "levels". */
  path: string;
  message: string;
}

export const CHOICE_MAX_OPTIONS = 255;
export const SCORE_MIN_LEVELS = 2;
export const SCORE_MAX_LEVELS = 10;
const SNAKE_CASE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

/** Mirrors the TypeSafe API rules: choice needs options with unique snake_case keys, score needs 2–10 levels. */
export function validateCriteria(criteria: DecisionCriteria): CriteriaIssue[] {
  const issues: CriteriaIssue[] = [];
  switch (criteria.kind) {
    case "choice": {
      const { options } = criteria;
      if (options.length === 0) {
        issues.push({
          path: "options",
          message: "Choice criteria are required: add the options the decision can return.",
        });
        break;
      }
      if (options.length < 2)
        issues.push({ path: "options", message: "A choice needs at least 2 options." });
      if (options.length > CHOICE_MAX_OPTIONS)
        issues.push({
          path: "options",
          message: `At most ${CHOICE_MAX_OPTIONS} options are allowed (${options.length} given).`,
        });
      const seen = new Map<string, number>();
      options.forEach((opt, i) => {
        const key = opt.key.trim();
        if (key === "") issues.push({ path: `options[${i}].key`, message: "Key is required." });
        else if (!SNAKE_CASE.test(key))
          issues.push({
            path: `options[${i}].key`,
            message: "Key must be snake_case: lowercase letters, digits and underscores.",
          });
        else if (seen.has(key))
          issues.push({
            path: `options[${i}].key`,
            message: `Duplicate key "${key}" (also option ${(seen.get(key) ?? 0) + 1}).`,
          });
        else seen.set(key, i);
      });
      break;
    }
    case "score": {
      const { levels } = criteria;
      if (levels.length < SCORE_MIN_LEVELS || levels.length > SCORE_MAX_LEVELS)
        issues.push({
          path: "levels",
          message: `A score needs between ${SCORE_MIN_LEVELS} and ${SCORE_MAX_LEVELS} levels (${levels.length} given).`,
        });
      levels.forEach((level, i) => {
        if (level.trim() === "")
          issues.push({ path: `levels[${i}]`, message: "Describe this level." });
      });
      break;
    }
    case "boolean":
      break;
    default:
      break;
  }
  return issues;
}

/** Default criteria for a kind, used when switching kinds. */
export function emptyCriteria(kind: DecisionKind): DecisionCriteria {
  switch (kind) {
    case "choice":
      return {
        kind: "choice",
        options: [
          { key: "", description: "" },
          { key: "", description: "" },
        ],
      };
    case "score":
      return { kind: "score", levels: ["", ""] };
    case "boolean":
      return { kind: "boolean", trueCriteria: "", falseCriteria: "" };
    default:
      return { kind: "boolean" };
  }
}

/** Turns free text into a snake_case key: "Needs refund" → "needs_refund". */
export function toSnakeCase(text: string): string {
  return text
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_");
}

interface PreviewEntry {
  key: string;
  label: string;
}

function previewEntries(criteria: DecisionCriteria): PreviewEntry[] {
  switch (criteria.kind) {
    case "choice": {
      // Keys are user-edited and may collide while typing (the editor flags
      // that as a validation issue); the preview still needs unique React keys.
      const seen = new Map<string, number>();
      return criteria.options.map((o, i) => {
        const base = o.key.trim() || `option_${i + 1}`;
        const n = seen.get(base) ?? 0;
        seen.set(base, n + 1);
        return {
          key: n === 0 ? base : `${base}__${n + 1}`,
          label: o.key.trim() || `Option ${i + 1}`,
        };
      });
    }
    case "score":
      return criteria.levels.map((l, i) => ({
        key: String(i),
        label: l.trim() || `Level ${i + 1}`,
      }));
    case "boolean":
      return [
        { key: "true", label: criteria.trueCriteria?.trim() || "Yes" },
        { key: "false", label: criteria.falseCriteria?.trim() || "No" },
      ];
    default:
      return [];
  }
}

/**
 * Live preview of what the decision returns, drawn with the decision group's
 * visuals: a probability ruler and per-key rows with a uniform mock
 * distribution (1/N each). The first entry is marked as chosen so the
 * chosen/others contrast is visible while editing.
 */
function CriteriaPreview({ criteria }: { criteria: DecisionCriteria }) {
  const entries = previewEntries(criteria);
  const n = entries.length;
  if (n === 0) return null;
  // Keys are shown next to placeholder labels ("Option 2" · option_2). While
  // two options share a key the preview keys carry a dedupe suffix that is
  // not a real key, so the mono key column is hidden until the clash is fixed.
  const hasDuplicateKeys =
    criteria.kind === "choice" &&
    new Set(criteria.options.map((o) => o.key.trim())).size < criteria.options.length;
  const p = 1 / n;
  const distribution: DistributionEntry[] = entries.map((e) => ({
    key: e.key,
    label: e.label,
    probability: p,
  }));
  const chosen = entries[0]?.key;
  return (
    <div
      className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-3"
      aria-label="Decision preview"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="text-eyebrow whitespace-nowrap">Preview</span>
        <span className="whitespace-nowrap font-mono text-2xs text-ink-3 tabular">
          uniform · {n} {n === 1 ? "outcome" : "outcomes"} · p = {formatProbability(p)}
        </span>
      </div>
      <ProbabilityRuler
        distribution={distribution}
        chosen={chosen}
        sort={false}
        size="sm"
        aria-label={`Uniform distribution over ${n} outcomes`}
      />
      <DistributionList
        distribution={distribution}
        chosen={chosen}
        maxRows={6}
        density="compact"
        showKeys={criteria.kind === "choice" && !hasDuplicateKeys}
      />
    </div>
  );
}

export interface CriteriaEditorProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "onChange" | "defaultValue"
> {
  value?: DecisionCriteria;
  defaultValue?: DecisionCriteria;
  onChange?: (criteria: DecisionCriteria) => void;
  /** Lock the kind (when the node type already fixes it). */
  kind?: DecisionKind;
  /** Hide the kind switcher. */
  hideKind?: boolean;
  /** Hide the live preview. */
  hidePreview?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  /** Show issues inline (default) or leave it to the parent form. */
  showIssues?: boolean;
  id?: string;
  /** Extra content between the editor and the preview. */
  children?: ReactNode;
}

function issueAt(issues: CriteriaIssue[], path: string): string | undefined {
  return issues.find((i) => i.path === path)?.message;
}

/**
 * Editor for TypeSafe question criteria. Choice: option key + description
 * rows (snake_case, unique, ≤255). Score: 2–10 ordered level descriptions
 * with drag reorder. Boolean: optional texts for true/false. Validation
 * messages match the TypeSafe API; a live preview shows the outcome space.
 */
export const CriteriaEditor = forwardRef<HTMLDivElement, CriteriaEditorProps>(
  function CriteriaEditor(
    {
      value,
      defaultValue,
      onChange,
      kind: lockedKind,
      hideKind = false,
      hidePreview = false,
      disabled,
      invalid,
      showIssues = true,
      id,
      className,
      children,
      ...rest
    },
    ref,
  ) {
    const [criteria, setCriteria] = useControllableState<DecisionCriteria>(
      value,
      defaultValue ?? emptyCriteria(lockedKind ?? "choice"),
      onChange,
    );
    const field = useFieldControl({ id, disabled, "aria-invalid": invalid });
    const isDisabled = Boolean(field.disabled);
    const issues = useMemo(() => validateCriteria(criteria), [criteria]);
    const baseId = useId();
    const keyIds = useRef<Map<number, string>>(new Map());
    const nextKeyId = useRef(0);
    const [touched, setTouched] = useState(false);

    // Stable ids for reorderable rows.
    const rowId = (index: number) => {
      let existing = keyIds.current.get(index);
      if (!existing) {
        existing = `${baseId}-${nextKeyId.current}`;
        nextKeyId.current += 1;
        keyIds.current.set(index, existing);
      }
      return existing;
    };

    const set = (next: DecisionCriteria) => {
      setTouched(true);
      setCriteria(next);
    };

    const switchKind = (kind: DecisionKind) => {
      if (kind === criteria.kind) return;
      keyIds.current.clear();
      set(emptyCriteria(kind));
    };

    const listIssue =
      criteria.kind === "choice"
        ? issueAt(issues, "options")
        : criteria.kind === "score"
          ? issueAt(issues, "levels")
          : undefined;
    const showListIssue = showIssues && listIssue && (touched || Boolean(field["aria-invalid"]));

    return (
      <div
        ref={ref}
        id={field.id}
        role="group"
        aria-describedby={field["aria-describedby"]}
        className={cn("flex min-w-0 flex-col gap-3", className)}
        {...rest}
      >
        {!hideKind && !lockedKind ? (
          <ToggleGroup
            type="single"
            size="sm"
            value={criteria.kind}
            onValueChange={(v) => {
              if (v === "choice" || v === "score" || v === "boolean") switchKind(v);
            }}
            disabled={isDisabled}
            aria-label="Decision kind"
          >
            <ToggleGroupItem value="choice">Choice</ToggleGroupItem>
            <ToggleGroupItem value="score">Score</ToggleGroupItem>
            <ToggleGroupItem value="boolean">Boolean</ToggleGroupItem>
          </ToggleGroup>
        ) : null}

        {criteria.kind === "choice" ? (
          <div className="flex flex-col gap-1.5">
            <div className="grid grid-cols-[20px_minmax(0,2fr)_minmax(0,3fr)_28px] items-center gap-1.5 px-0 text-2xs font-medium text-ink-3">
              <span />
              <span>Key</span>
              <span>Description</span>
              <span />
            </div>
            <ReorderableList
              items={criteria.options}
              keyOf={(_o, i) => rowId(i)}
              disabled={isDisabled}
              label="Options"
              onReorder={(options) => {
                keyIds.current.clear();
                set({ kind: "choice", options });
              }}
              renderItem={(opt, index, handle) => {
                const keyIssue = issueAt(issues, `options[${index}].key`);
                const showKeyIssue =
                  showIssues && keyIssue && (touched || Boolean(field["aria-invalid"]));
                return (
                  <div className="flex flex-col gap-1">
                    <div className="grid grid-cols-[20px_minmax(0,2fr)_minmax(0,3fr)_28px] items-center gap-1.5">
                      {handle}
                      <Input
                        mono
                        aria-label={`Option ${index + 1} key`}
                        placeholder="needs_refund"
                        value={opt.key}
                        invalid={showKeyIssue ? true : undefined}
                        disabled={isDisabled}
                        autoComplete="off"
                        spellCheck={false}
                        onChange={(e) =>
                          set({
                            kind: "choice",
                            options: criteria.options.map((o, i) =>
                              i === index ? { ...o, key: e.target.value } : o,
                            ),
                          })
                        }
                        onBlur={(e) => {
                          const normalised = toSnakeCase(e.target.value);
                          if (normalised !== opt.key)
                            set({
                              kind: "choice",
                              options: criteria.options.map((o, i) =>
                                i === index ? { ...o, key: normalised } : o,
                              ),
                            });
                        }}
                      />
                      <Input
                        aria-label={`Option ${index + 1} description`}
                        placeholder="The customer asks for money back"
                        value={opt.description}
                        disabled={isDisabled}
                        onChange={(e) =>
                          set({
                            kind: "choice",
                            options: criteria.options.map((o, i) =>
                              i === index ? { ...o, description: e.target.value } : o,
                            ),
                          })
                        }
                      />
                      <IconButton
                        label="Remove option"
                        size="sm"
                        variant="ghost"
                        disabled={isDisabled}
                        onClick={() => {
                          keyIds.current.clear();
                          set({
                            kind: "choice",
                            options: criteria.options.filter((_, i) => i !== index),
                          });
                        }}
                      >
                        <X strokeWidth={1.75} />
                      </IconButton>
                    </div>
                    {showKeyIssue ? (
                      <p className="pl-[26px] text-2xs text-danger-text">{keyIssue}</p>
                    ) : null}
                  </div>
                );
              }}
            />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                leadingIcon={<Plus />}
                disabled={isDisabled || criteria.options.length >= CHOICE_MAX_OPTIONS}
                onClick={() =>
                  set({
                    kind: "choice",
                    options: [...criteria.options, { key: "", description: "" }],
                  })
                }
              >
                Add option
              </Button>
              <span className="ml-auto font-mono text-2xs text-ink-3 tabular">
                {criteria.options.length} / {CHOICE_MAX_OPTIONS}
              </span>
            </div>
            {showListIssue ? <FieldError>{listIssue}</FieldError> : null}
          </div>
        ) : null}

        {criteria.kind === "score" ? (
          <LevelsList
            aria-label="Levels"
            value={criteria.levels}
            disabled={isDisabled}
            showIssues={showIssues && (touched || Boolean(field["aria-invalid"]))}
            onChange={(levels) => set({ kind: "score", levels })}
          />
        ) : null}

        {criteria.kind === "boolean" ? (
          <div className="grid gap-3 @md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${baseId}-true`} className="text-xs font-medium text-ink-2">
                When true <span className="font-normal text-ink-3">(optional)</span>
              </label>
              <Textarea
                id={`${baseId}-true`}
                autoGrow
                minRows={2}
                maxRows={6}
                placeholder="The message threatens to cancel or mentions legal action"
                value={criteria.trueCriteria ?? ""}
                disabled={isDisabled}
                onChange={(e) => set({ ...criteria, trueCriteria: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${baseId}-false`} className="text-xs font-medium text-ink-2">
                When false <span className="font-normal text-ink-3">(optional)</span>
              </label>
              <Textarea
                id={`${baseId}-false`}
                autoGrow
                minRows={2}
                maxRows={6}
                placeholder="A routine question with no urgency signals"
                value={criteria.falseCriteria ?? ""}
                disabled={isDisabled}
                onChange={(e) => set({ ...criteria, falseCriteria: e.target.value })}
              />
            </div>
          </div>
        ) : null}

        {children}
        {!hidePreview ? <CriteriaPreview criteria={criteria} /> : null}
      </div>
    );
  },
);
