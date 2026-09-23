import { forwardRef, useId, useMemo, useState, type ButtonHTMLAttributes } from "react";
import { Command as Cmdk } from "cmdk";
import { Check, ChevronDown, Cpu, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatTokens } from "@/lib/format";
import type { ModelView } from "@/types";
import {
  Badge,
  Hint,
  Popover,
  PopoverContent,
  PopoverTrigger,
  useFieldControl,
} from "@/primitives";

export type ModelKind = ModelView["kind"];

export interface ModelPickerProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "value" | "onChange"
> {
  models: ModelView[];
  /** Restricts the list. Decision models are TypeSafe `jev-*` and the rule/LLM adapters only. */
  kind?: ModelKind;
  value?: string | null;
  onValueChange?: (modelId: string, model: ModelView) => void;
  placeholder?: string;
  invalid?: boolean;
  /** Width of the popover in px. */
  width?: number;
  size?: "sm" | "md";
}

const DECISION_PROVIDERS = new Set([
  "typesafe",
  "rule",
  "rules",
  "llm",
  "llm-adapter",
  "rule-adapter",
]);

/** True when the model may answer a TypeSafe decision. */
export function isDecisionModel(model: ModelView): boolean {
  if (model.kind !== "decision") return false;
  const provider = model.provider.toLowerCase();
  return model.id.startsWith("jev-") || DECISION_PROVIDERS.has(provider);
}

/** Models allowed for `kind`; decision is stricter than the model's own `kind` flag. */
export function filterModelsByKind(models: ModelView[], kind?: ModelKind): ModelView[] {
  if (!kind) return models;
  if (kind === "decision") return models.filter(isDecisionModel);
  return models.filter((m) => m.kind === kind);
}

/** "$0.15 / $0.60" per million tokens, or "—" when unknown. Free (local) models read "free". */
export function formatModelPrice(model: ModelView): string {
  const { inputCostPerMTok: i, outputCostPerMTok: o } = model;
  if (i === undefined && o === undefined) return model.local ? "free" : "—";
  const fmt = (n: number | undefined) =>
    n === undefined ? "—" : n === 0 ? "$0" : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
  return `${fmt(i)} / ${fmt(o)}`;
}

/** Groups models by provider preserving first-seen order. */
export function groupModelsByProvider(
  models: ModelView[],
): Array<{ provider: string; models: ModelView[] }> {
  const groups = new Map<string, ModelView[]>();
  for (const m of models) {
    const list = groups.get(m.provider) ?? [];
    list.push(m);
    groups.set(m.provider, list);
  }
  return [...groups.entries()].map(([provider, list]) => ({ provider, models: list }));
}

const HEALTH_CLASS: Record<NonNullable<ModelView["health"]>, string> = {
  healthy: "bg-ok",
  degraded: "bg-warn",
  down: "bg-danger",
  unknown: "bg-ink-4",
};

function HealthDot({ health = "unknown" }: { health?: ModelView["health"] }) {
  return (
    <Hint
      hint={`Health: ${health}`}
      announce={false}
      role="img"
      aria-label={`Health: ${health}`}
      className={cn("size-1.5 shrink-0 rounded-full", HEALTH_CLASS[health])}
    />
  );
}

/**
 * Searchable model picker: a compact trigger ("jev-latest, TypeSafe") opening
 * a command list grouped by provider. Rows show context window, price per
 * million tokens (mono), a health dot and a "local" chip for Ollama/vLLM.
 */
export const ModelPicker = forwardRef<HTMLButtonElement, ModelPickerProps>(function ModelPicker(
  {
    models,
    kind,
    value,
    onValueChange,
    placeholder = "Choose a model",
    invalid,
    width = 360,
    size = "md",
    className,
    disabled,
    id,
    ...rest
  },
  ref,
) {
  const [open, setOpen] = useState(false);
  const popupId = useId();
  const field = useFieldControl({
    id,
    disabled,
    "aria-invalid": invalid,
    "aria-describedby": rest["aria-describedby"],
  });
  const list = useMemo(() => filterModelsByKind(models, kind), [models, kind]);
  const groups = useMemo(() => groupModelsByProvider(list), [list]);
  const selected = models.find((m) => m.id === value);
  const total = list.length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          ref={ref}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? popupId : undefined}
          aria-haspopup="listbox"
          {...rest}
          id={field.id}
          disabled={field.disabled}
          aria-invalid={field["aria-invalid"]}
          aria-describedby={field["aria-describedby"]}
          aria-required={field["aria-required"]}
          className={cn(
            "group flex w-full min-w-0 items-center gap-2 rounded-sm border border-border bg-surface text-left text-ink shadow-1",
            "transition-[border-color,box-shadow,background-color] duration-(--dur-fast) ease-(--ease-out)",
            "hover:bg-surface-3 data-[state=open]:border-accent",
            "disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-4 disabled:shadow-none",
            "aria-invalid:border-danger",
            size === "sm" ? "h-6 px-1.5 text-xs" : "h-7 px-2 text-sm",
            className,
          )}
        >
          <Cpu className="size-4 shrink-0 text-ink-3" strokeWidth={1.75} aria-hidden="true" />
          {selected ? (
            <span className="flex min-w-0 flex-1 items-baseline gap-1.5 truncate">
              <span className="truncate font-mono text-xs">{selected.name}</span>
              <span className="truncate text-2xs text-ink-3">{selected.provider}</span>
              {selected.local ? (
                <Badge size="sm" tone="outline" mono className="ml-auto">
                  local
                </Badge>
              ) : null}
            </span>
          ) : (
            <span className="min-w-0 flex-1 truncate text-ink-3">{placeholder}</span>
          )}
          <ChevronDown
            className="size-4 shrink-0 text-ink-3 transition-transform duration-(--dur-fast) group-data-[state=open]:rotate-180"
            strokeWidth={1.75}
            aria-hidden="true"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        id={popupId}
        bare
        width={width}
        className="flex max-h-[min(420px,70vh)] flex-col overflow-hidden"
      >
        <Cmdk label="Models" loop className="flex min-h-0 flex-col">
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-2.5">
            <Search className="size-4 shrink-0 text-ink-3" strokeWidth={1.75} aria-hidden="true" />
            <Cmdk.Input
              placeholder={`Search ${total} ${kind ?? ""} ${total === 1 ? "model" : "models"}`.replace(
                /\s+/g,
                " ",
              )}
              className="h-full min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3 focus-visible:shadow-none"
            />
          </div>
          <Cmdk.List className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1 [scrollbar-width:thin]">
            <Cmdk.Empty className="py-8 text-center text-xs text-ink-3">
              {total === 0 ? `No ${kind ?? ""} models are configured.` : "No model matches."}
            </Cmdk.Empty>
            {groups.map((group) => (
              <Cmdk.Group
                key={group.provider}
                heading={group.provider}
                className="[&_[cmdk-group-heading]]:text-eyebrow [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2"
              >
                {group.models.map((m) => {
                  const isSelected = m.id === value;
                  return (
                    <Cmdk.Item
                      key={m.id}
                      value={m.id}
                      keywords={[m.name, m.provider, m.kind, m.local ? "local" : ""]}
                      disabled={m.health === "down"}
                      onSelect={() => {
                        onValueChange?.(m.id, m);
                        setOpen(false);
                      }}
                      className={cn(
                        "relative flex h-9 cursor-default select-none items-center gap-2 rounded-xs px-2 text-sm text-ink outline-none",
                        "data-[selected=true]:bg-surface-3 data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50",
                      )}
                    >
                      <HealthDot health={m.health} />
                      <span className="flex min-w-0 flex-1 flex-col leading-tight">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate font-mono text-xs">{m.name}</span>
                          {m.local ? (
                            <Badge size="sm" tone="outline" mono>
                              local
                            </Badge>
                          ) : null}
                        </span>
                        <span className="mt-0.5 flex items-center gap-2 font-mono text-2xs text-ink-3 tabular">
                          {m.contextTokens !== undefined ? (
                            <span>{formatTokens(m.contextTokens)} ctx</span>
                          ) : null}
                          <span>{formatModelPrice(m)}</span>
                          {m.inputCostPerMTok !== undefined || m.outputCostPerMTok !== undefined ? (
                            <span className="text-ink-3">per M tok</span>
                          ) : null}
                        </span>
                      </span>
                      {isSelected ? (
                        <Check
                          className="size-3.5 shrink-0 text-accent"
                          strokeWidth={2.25}
                          aria-hidden="true"
                        />
                      ) : null}
                    </Cmdk.Item>
                  );
                })}
              </Cmdk.Group>
            ))}
          </Cmdk.List>
        </Cmdk>
      </PopoverContent>
    </Popover>
  );
});
