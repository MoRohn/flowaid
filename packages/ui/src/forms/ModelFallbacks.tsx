import { useState } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ModelView } from "@/types";
import { Button, FieldHint, IconButton, Select, SelectItem } from "@/primitives";
import { ModelPicker, type ModelKind } from "./ModelPicker";

/** A model a generation node may use (`ModelRefSchema`). */
export interface ModelCandidate {
  provider: string;
  model: string;
}

export type RoutingStrategy = "ordered" | "cheapest" | "fastest" | "healthiest";

/** RFC-0005 `GenerationPolicySchema`, as the picker edits it. */
export interface GenerationPolicyValue {
  candidates: ModelCandidate[];
  strategy?: RoutingStrategy;
  requirements?: { tools?: boolean; jsonSchema?: boolean; vision?: boolean; minContext?: number };
  maxCostUsdPerCall?: number;
}

/** What the field holds: one model, or a policy over up to five. */
export type ModelSelectionValue = ModelCandidate | GenerationPolicyValue;

export const MAX_MODEL_CANDIDATES = 5;

export const ROUTING_STRATEGIES: readonly {
  value: RoutingStrategy;
  label: string;
  hint: string;
}[] = [
  { value: "ordered", label: "In order", hint: "Try the models top to bottom." },
  {
    value: "cheapest",
    label: "Cheapest first",
    hint: "Try the lowest catalog price first; the rest are fallbacks.",
  },
  {
    value: "fastest",
    label: "Fastest first",
    hint: "Try the lowest recent p95 latency first.",
  },
  {
    value: "healthiest",
    label: "Healthiest first",
    hint: "Try the model with the fewest recent errors first.",
  },
];

function isCandidate(value: unknown): value is ModelCandidate {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ModelCandidate).provider === "string" &&
    typeof (value as ModelCandidate).model === "string"
  );
}

/** The candidates a stored value names, in order (an empty list for anything else). */
export function selectionCandidates(value: unknown): ModelCandidate[] {
  if (isCandidate(value)) return [{ provider: value.provider, model: value.model }];
  if (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as GenerationPolicyValue).candidates)
  )
    return (value as GenerationPolicyValue).candidates.filter(isCandidate);
  return [];
}

/**
 * The value to store: a plain `{ provider, model }` while there is one model in order and nothing
 * else set (so simple definitions stay simple), otherwise a policy. Keeps requirements and the
 * per-call cost cap the value already had.
 */
export function toModelSelection(
  candidates: readonly ModelCandidate[],
  strategy: RoutingStrategy,
  previous?: unknown,
): ModelSelectionValue | undefined {
  if (candidates.length === 0) return undefined;
  const rest: Omit<GenerationPolicyValue, "candidates" | "strategy"> = {};
  if (typeof previous === "object" && previous !== null && "candidates" in previous) {
    const p = previous as GenerationPolicyValue;
    if (p.requirements) rest.requirements = p.requirements;
    if (p.maxCostUsdPerCall !== undefined) rest.maxCostUsdPerCall = p.maxCostUsdPerCall;
  }
  if (candidates.length === 1 && strategy === "ordered" && Object.keys(rest).length === 0)
    return { ...(candidates[0] as ModelCandidate) };
  return { candidates: candidates.map((c) => ({ ...c })), strategy, ...rest };
}

function strategyOf(value: unknown): RoutingStrategy {
  const s = (value as GenerationPolicyValue | undefined)?.strategy;
  return ROUTING_STRATEGIES.some((x) => x.value === s) ? (s as RoutingStrategy) : "ordered";
}

function idOf(c: ModelCandidate, models: readonly ModelView[]): string {
  return (
    models.find((m) => m.id === c.model && m.provider.toLowerCase() === c.provider.toLowerCase())
      ?.id ?? c.model
  );
}

export interface ModelFallbacksProps {
  models: ModelView[];
  kind?: ModelKind;
  value: unknown;
  onValueChange: (value: ModelSelectionValue | undefined) => void;
  disabled?: boolean;
  invalid?: boolean;
  "aria-label"?: string;
  className?: string;
}

/**
 * The model field of a generation node (RFC-0005): the primary model, up to four fallbacks and
 * how to route between them. With one model it stores a plain `{ provider, model }`.
 */
export function ModelFallbacks({
  models,
  kind,
  value,
  onValueChange,
  disabled,
  invalid,
  "aria-label": ariaLabel = "Model",
  className,
}: ModelFallbacksProps) {
  const candidates = selectionCandidates(value);
  const strategy = strategyOf(value);
  const [adding, setAdding] = useState(false);
  const emit = (next: ModelCandidate[], nextStrategy = strategy) =>
    onValueChange(toModelSelection(next, next.length > 1 ? nextStrategy : "ordered", value));
  const replace = (i: number, m: ModelView) =>
    emit(candidates.map((c, j) => (j === i ? { provider: m.provider, model: m.id } : c)));
  const remove = (i: number) => emit(candidates.filter((_, j) => j !== i));
  const canAdd = candidates.length > 0 && candidates.length < MAX_MODEL_CANDIDATES && !disabled;
  const hint = ROUTING_STRATEGIES.find((s) => s.value === strategy)?.hint;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <ModelPicker
        aria-label={ariaLabel}
        models={models}
        {...(kind ? { kind } : {})}
        value={candidates[0] ? idOf(candidates[0], models) : null}
        onValueChange={(_, m) =>
          candidates.length === 0 ? emit([{ provider: m.provider, model: m.id }]) : replace(0, m)
        }
        {...(invalid !== undefined ? { invalid } : {})}
        {...(disabled !== undefined ? { disabled } : {})}
      />
      {candidates.length > 1 || adding ? (
        <ol role="list" aria-label="Fallback models" className="flex flex-col gap-1.5 pl-3">
          {candidates.slice(1).map((c, k) => {
            const i = k + 1;
            return (
              <li key={`${c.provider}/${c.model}/${i}`} className="flex items-center gap-1.5">
                <span className="w-4 shrink-0 text-right font-mono text-2xs text-ink-3">
                  {i + 1}
                </span>
                <ModelPicker
                  size="sm"
                  aria-label={`Fallback ${i}`}
                  models={models}
                  {...(kind ? { kind } : {})}
                  value={idOf(c, models)}
                  onValueChange={(_, m) => replace(i, m)}
                  {...(disabled !== undefined ? { disabled } : {})}
                />
                <IconButton
                  size="sm"
                  variant="ghost"
                  label={`Remove fallback ${i}`}
                  disabled={disabled}
                  onClick={() => remove(i)}
                >
                  <X strokeWidth={1.75} />
                </IconButton>
              </li>
            );
          })}
          {adding ? (
            <li className="flex items-center gap-1.5">
              <span className="w-4 shrink-0 text-right font-mono text-2xs text-ink-3">
                {candidates.length + 1}
              </span>
              <ModelPicker
                size="sm"
                aria-label={`Fallback ${candidates.length}`}
                placeholder="Choose a fallback"
                models={models}
                {...(kind ? { kind } : {})}
                value={null}
                onValueChange={(_, m) => {
                  setAdding(false);
                  emit([...candidates, { provider: m.provider, model: m.id }]);
                }}
              />
              <IconButton size="sm" variant="ghost" label="Cancel" onClick={() => setAdding(false)}>
                <X strokeWidth={1.75} />
              </IconButton>
            </li>
          ) : null}
        </ol>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {canAdd && !adding ? (
          <Button
            size="sm"
            variant="ghost"
            leadingIcon={<Plus strokeWidth={1.75} />}
            onClick={() => setAdding(true)}
          >
            Add fallback
          </Button>
        ) : null}
        {candidates.length > 1 ? (
          <Select
            size="sm"
            aria-label="Routing"
            value={strategy}
            {...(disabled !== undefined ? { disabled } : {})}
            onValueChange={(v) => emit(candidates, v as RoutingStrategy)}
            className="w-44"
          >
            {ROUTING_STRATEGIES.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </Select>
        ) : null}
      </div>
      {candidates.length > 1 && hint ? (
        <FieldHint>
          {hint} A model that fails with a retryable error, or whose circuit is open, hands over to
          the next.
        </FieldHint>
      ) : null}
    </div>
  );
}
