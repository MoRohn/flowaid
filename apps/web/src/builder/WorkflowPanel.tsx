"use client";
/**
 * The inspector when no node is selected: the workflow itself. Its name and description, and its
 * settings — the workflow variables (`$vars.<name>`) that templates use for limits, windows and
 * scores — edited as plain fields with their own validation, and its execution limits (time, cost,
 * steps at once). Environments can still override a setting per deployment; what is edited here
 * is the default every run starts from.
 */
import { useEffect, useState } from "react";
import type { Draft } from "immer";
import { Plus, Trash2 } from "lucide-react";
import {
  ExecutionPolicySchema,
  type JsonValue,
  type Variable,
  type WorkflowDefinition,
} from "@flowaid/workflow-core";
import {
  Button,
  FieldHint,
  FieldRow,
  IconButton,
  Input,
  Select,
  SelectItem,
  Switch,
  Textarea,
} from "@flowaid/ui/primitives";
import type { BuilderStore } from "./store";

/** "autoApproveLimit" → "Auto approve limit"; "max_items" → "Max items". */
export function settingLabel(name: string): string {
  const words = name
    .replace(/_+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

type Kind = "number" | "integer" | "boolean" | "string" | "enum" | "other";

export function settingKind(v: Pick<Variable, "schema">): Kind {
  const s = v.schema as { type?: unknown; enum?: unknown };
  if (Array.isArray(s.enum)) return "enum";
  if (s.type === "number" || s.type === "integer" || s.type === "boolean" || s.type === "string")
    return s.type;
  return "other";
}

/** Parses and checks a typed value against the setting's schema; an error says how to fix it. */
export function parseSetting(
  v: Pick<Variable, "schema">,
  text: string,
): { ok: true; value: JsonValue } | { ok: false; error: string } {
  const s = v.schema as { minimum?: number; maximum?: number };
  const kind = settingKind(v);
  if (kind === "number" || kind === "integer") {
    if (text.trim() === "") return { ok: false, error: "Enter a number." };
    const n = Number(text);
    if (!Number.isFinite(n)) return { ok: false, error: "Enter a number, for example 50." };
    if (kind === "integer" && !Number.isInteger(n))
      return { ok: false, error: "Use a whole number." };
    if (s.minimum !== undefined && n < s.minimum)
      return { ok: false, error: `Use ${s.minimum} or more.` };
    if (s.maximum !== undefined && n > s.maximum)
      return { ok: false, error: `Use ${s.maximum} or less.` };
    return { ok: true, value: n };
  }
  return { ok: true, value: text };
}

/** A scalar setting as field text; objects and arrays are not edited as text. */
function scalarText(v: JsonValue | undefined): string {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : "";
}

const VAR_NAME = /^[a-z][a-zA-Z0-9_]{0,63}$/;

export function WorkflowPanel({
  definition,
  store,
  readOnly,
  name,
  onRename,
  onDescribe,
  focus,
}: {
  definition: WorkflowDefinition;
  store: BuilderStore;
  readOnly: boolean;
  name: string;
  onRename?: (name: string) => void;
  /** Saves the description on the workflow itself (lists, search), besides the draft. */
  onDescribe?: (description: string) => void;
  /** An Execution field to focus (a problem's "Set a cost limit"); `n` repeats the request. */
  focus?: { field: ExecutionField; n: number };
}) {
  const settings = definition.variables.filter((v) => v.source !== "environment");
  const setDefault = (varName: string, value: JsonValue) =>
    store.getState().updateDefinition(
      (d) => {
        const v = d.variables.find((x) => x.name === varName);
        if (v) v.default = value;
      },
      `Change ${settingLabel(varName)}`,
    );

  return (
    <div className="flex flex-col gap-5 p-4">
      <div>
        <h2 className="text-sm font-semibold text-ink">This workflow</h2>
        <p className="text-xs text-ink-3">
          Select a step on the canvas to configure it, or use Add node. Everything here is your own
          copy: rename it and change it freely.
        </p>
      </div>

      <FieldRow label="Name" htmlFor="wf-panel-name">
        <Input
          id="wf-panel-name"
          defaultValue={name}
          key={name}
          maxLength={120}
          disabled={readOnly || !onRename}
          onBlur={(e) => {
            const next = e.target.value.trim();
            if (next && next !== name) onRename?.(next);
            else e.target.value = name;
          }}
        />
      </FieldRow>
      <FieldRow label="Description" htmlFor="wf-panel-desc" hint="What the workflow is for.">
        <Textarea
          id="wf-panel-desc"
          rows={3}
          maxLength={2000}
          disabled={readOnly}
          defaultValue={definition.description ?? ""}
          key={`desc:${definition.description ?? ""}`}
          onBlur={(e) => {
            const next = e.target.value.trim();
            if (next === (definition.description ?? "")) return;
            store.getState().updateDefinition((d) => {
              d.description = next;
            }, "Edit description");
            onDescribe?.(next);
          }}
        />
      </FieldRow>

      <section aria-labelledby="wf-settings" className="flex flex-col gap-3">
        <div>
          <h3 id="wf-settings" className="text-eyebrow">
            Settings
          </h3>
          <FieldHint>
            {settings.length
              ? "Values the steps use (limits, windows, scores). Runs use them from the next run; a deployment can override one per environment."
              : "This workflow has no settings. Add one to use a value in several steps as $vars.<name>."}
          </FieldHint>
        </div>
        {settings.map((v) => (
          <SettingField
            key={`${v.name}:${JSON.stringify(v.default ?? null)}`}
            variable={v}
            readOnly={readOnly}
            onChange={(value) => setDefault(v.name, value)}
            onRemove={() =>
              store.getState().updateDefinition(
                (d) => {
                  d.variables = d.variables.filter((x) => x.name !== v.name);
                },
                `Remove ${settingLabel(v.name)}`,
              )
            }
          />
        ))}
        {!readOnly ? (
          <AddSetting
            taken={definition.variables.map((v) => v.name)}
            onAdd={(variable) =>
              store.getState().updateDefinition(
                (d) => {
                  d.variables.push(variable);
                },
                `Add ${settingLabel(variable.name)}`,
              )
            }
          />
        ) : null}
      </section>

      <ExecutionSettings
        execution={definition.execution}
        readOnly={readOnly}
        {...(focus ? { focus } : {})}
        onChange={(recipe, label) =>
          store.getState().updateDefinition((d) => recipe(d.execution), label)
        }
      />
    </div>
  );
}

const EXECUTION_DEFAULTS = ExecutionPolicySchema.parse({});

/** Fields of the Execution section a problem's action can lead to. */
export type ExecutionField = "timeout" | "max-cost";
export const EXECUTION_FIELD_ID: Record<ExecutionField, string> = {
  timeout: "wf-exec-timeout",
  "max-cost": "wf-exec-max-cost",
};

const UNITS = [
  { id: "s", label: "seconds", ms: 1000 },
  { id: "min", label: "minutes", ms: 60_000 },
  { id: "h", label: "hours", ms: 3_600_000 },
  { id: "d", label: "days", ms: 86_400_000 },
] as const;
type Unit = (typeof UNITS)[number]["id"];

/** A duration as a number in its largest whole unit: 10 800 000 → 3 hours. */
export function durationParts(ms: number): { value: number; unit: Unit } {
  for (const u of [...UNITS].reverse())
    if (ms >= u.ms && ms % u.ms === 0) return { value: ms / u.ms, unit: u.id };
  return { value: ms / 1000, unit: "s" };
}

/** Checks a typed run time limit; the schema wants whole milliseconds, at least one second. */
export function parseDuration(
  text: string,
  unit: Unit,
): { ok: true; ms: number } | { ok: false; error: string } {
  const n = Number(text);
  if (text.trim() === "" || !Number.isFinite(n) || n <= 0)
    return { ok: false, error: "Enter how long a run may take, for example 15." };
  const ms = Math.round(n * (UNITS.find((u) => u.id === unit)?.ms ?? 1000));
  if (ms < 1000) return { ok: false, error: "Use at least 1 second." };
  return { ok: true, ms };
}

/** Checks a typed cost limit: empty means no limit. */
export function parseCostLimit(
  text: string,
): { ok: true; usd: number | undefined } | { ok: false; error: string } {
  const t = text.trim().replace(/^\$/, "");
  if (t === "") return { ok: true, usd: undefined };
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0)
    return { ok: false, error: "Enter an amount in US dollars above 0, for example 0.25." };
  return { ok: true, usd: n };
}

/**
 * The run's execution policy as fields (`execution` in the workflow JSON): how long a run may take
 * (waiting for a person counts), how much it may spend, and how many steps run at once. A problem
 * about either limit leads here (`focus`).
 */
function ExecutionSettings({
  execution: stored,
  readOnly,
  focus,
  onChange,
}: {
  execution: WorkflowDefinition["execution"];
  readOnly: boolean;
  focus?: { field: ExecutionField; n: number };
  onChange: (recipe: (e: Draft<WorkflowDefinition["execution"]>) => void, label: string) => void;
}) {
  // a draft written without them (a new blank workflow) runs with the schema's defaults
  const execution = { ...EXECUTION_DEFAULTS, ...stored };
  // the limit as typed, in the unit chosen; an edit from elsewhere (undo, JSON) shows anew
  const [text, setText] = useState(() => String(durationParts(execution.timeoutMs).value));
  const [unit, setUnit] = useState<Unit>(() => durationParts(execution.timeoutMs).unit);
  const [seenMs, setSeenMs] = useState(execution.timeoutMs);
  if (execution.timeoutMs !== seenMs) {
    const shown = durationParts(execution.timeoutMs);
    setSeenMs(execution.timeoutMs);
    setText(String(shown.value));
    setUnit(shown.unit);
  }
  const [timeoutError, setTimeoutError] = useState<string | null>(null);
  const [costError, setCostError] = useState<string | null>(null);
  const [concurrencyError, setConcurrencyError] = useState<string | null>(null);
  const focusN = focus?.n;
  const focusField = focus?.field;
  useEffect(() => {
    if (!focusField) return;
    const el = document.getElementById(EXECUTION_FIELD_ID[focusField]);
    el?.scrollIntoView?.({ block: "center" });
    el?.focus();
  }, [focusField, focusN]);

  const commitTimeout = (typed: string, u: Unit) => {
    const parsed = parseDuration(typed, u);
    if (!parsed.ok) return setTimeoutError(parsed.error);
    if (parsed.ms === execution.timeoutMs) return;
    setSeenMs(parsed.ms); // keep the unit chosen here: 90 minutes stays 90 minutes
    onChange((e) => {
      e.timeoutMs = parsed.ms;
    }, "Change the run time limit");
  };

  return (
    <section aria-labelledby="wf-execution" className="flex flex-col gap-3">
      <div>
        <h3 id="wf-execution" className="text-eyebrow">
          Execution
        </h3>
        <FieldHint>
          Limits every run of this workflow keeps to. A run that reaches one stops.
        </FieldHint>
      </div>
      <FieldRow
        label="Run time limit"
        htmlFor={EXECUTION_FIELD_ID.timeout}
        hint="How long a run may take from start to end. Time spent waiting for a person counts, so allow for your approvals' expiry."
        error={timeoutError ?? undefined}
      >
        <div className="flex gap-2">
          <Input
            id={EXECUTION_FIELD_ID.timeout}
            inputMode="decimal"
            className="w-24 font-mono"
            value={text}
            disabled={readOnly}
            aria-invalid={timeoutError ? true : undefined}
            onChange={(e) => {
              setText(e.target.value);
              setTimeoutError(null);
            }}
            onBlur={() => commitTimeout(text, unit)}
          />
          <Select
            value={unit}
            disabled={readOnly}
            aria-label="Run time limit unit"
            onValueChange={(v) => {
              const next = UNITS.find((u) => u.id === v)?.id;
              if (!next) return;
              setUnit(next);
              commitTimeout(text, next);
            }}
          >
            {UNITS.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.label}
              </SelectItem>
            ))}
          </Select>
        </div>
      </FieldRow>
      <FieldRow
        label="Cost limit per run"
        htmlFor={EXECUTION_FIELD_ID["max-cost"]}
        hint="US dollars of model and decision calls a run may spend. Leave empty for no limit."
        error={costError ?? undefined}
        optional
      >
        <Input
          id={EXECUTION_FIELD_ID["max-cost"]}
          key={`cost:${execution.maxCostUsd ?? ""}`}
          inputMode="decimal"
          className="font-mono"
          placeholder="No limit"
          defaultValue={execution.maxCostUsd === undefined ? "" : String(execution.maxCostUsd)}
          disabled={readOnly}
          aria-invalid={costError ? true : undefined}
          onChange={() => setCostError(null)}
          onBlur={(e) => {
            const parsed = parseCostLimit(e.target.value);
            if (!parsed.ok) return setCostError(parsed.error);
            if (parsed.usd === execution.maxCostUsd) return;
            onChange(
              (x) => {
                if (parsed.usd === undefined) delete x.maxCostUsd;
                else x.maxCostUsd = parsed.usd;
              },
              parsed.usd === undefined ? "Remove the cost limit" : "Change the cost limit",
            );
          }}
        />
      </FieldRow>
      <FieldRow
        label="Steps at once"
        htmlFor="wf-exec-concurrency"
        hint="How many steps of one run may work at the same time (1 to 64)."
        error={concurrencyError ?? undefined}
      >
        <Input
          id="wf-exec-concurrency"
          key={`concurrency:${execution.concurrency}`}
          inputMode="numeric"
          className="w-24 font-mono"
          defaultValue={String(execution.concurrency)}
          disabled={readOnly}
          aria-invalid={concurrencyError ? true : undefined}
          onChange={() => setConcurrencyError(null)}
          onBlur={(e) => {
            const n = Number(e.target.value);
            if (!Number.isInteger(n) || n < 1 || n > 64)
              return setConcurrencyError("Use a whole number from 1 to 64.");
            if (n !== execution.concurrency)
              onChange((x) => {
                x.concurrency = n;
              }, "Change steps at once");
          }}
        />
      </FieldRow>
    </section>
  );
}

function SettingField({
  variable,
  readOnly,
  onChange,
  onRemove,
}: {
  variable: Variable;
  readOnly: boolean;
  onChange: (value: JsonValue) => void;
  onRemove: () => void;
}) {
  const kind = settingKind(variable);
  const [error, setError] = useState<string | null>(null);
  const id = `wf-setting-${variable.name}`;
  const hint = (
    <>
      {variable.description ? `${variable.description} ` : ""}
      <span className="font-mono">$vars.{variable.name}</span>
    </>
  );
  const remove = !readOnly ? (
    <IconButton label={`Remove ${settingLabel(variable.name)}`} size="sm" onClick={onRemove}>
      <Trash2 strokeWidth={1.75} />
    </IconButton>
  ) : null;

  if (kind === "boolean")
    return (
      <FieldRow label={settingLabel(variable.name)} hint={hint} labelAddon={remove}>
        <Switch
          checked={variable.default === true}
          disabled={readOnly}
          aria-label={settingLabel(variable.name)}
          onCheckedChange={(on) => onChange(on)}
        />
      </FieldRow>
    );
  if (kind === "enum") {
    const options = ((variable.schema as { enum: unknown[] }).enum ?? []).map(String);
    return (
      <FieldRow label={settingLabel(variable.name)} hint={hint} labelAddon={remove}>
        <Select
          value={scalarText(variable.default)}
          disabled={readOnly}
          aria-label={settingLabel(variable.name)}
          onValueChange={(v) => onChange(v)}
        >
          {options.map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </Select>
      </FieldRow>
    );
  }
  if (kind === "other")
    return (
      <FieldRow label={settingLabel(variable.name)} hint={hint} labelAddon={remove}>
        <p className="font-mono text-2xs text-ink-3">
          {JSON.stringify(variable.default ?? null)} (edit in the workflow JSON)
        </p>
      </FieldRow>
    );
  return (
    <FieldRow
      label={settingLabel(variable.name)}
      htmlFor={id}
      hint={hint}
      error={error ?? undefined}
      labelAddon={remove}
    >
      <Input
        id={id}
        inputMode={kind === "string" ? undefined : "decimal"}
        className={kind === "string" ? undefined : "font-mono"}
        defaultValue={scalarText(variable.default)}
        disabled={readOnly}
        aria-invalid={error ? true : undefined}
        onChange={() => setError(null)}
        onBlur={(e) => {
          const parsed = parseSetting(variable, e.target.value);
          if (!parsed.ok) {
            setError(parsed.error);
            return;
          }
          if (parsed.value !== variable.default) onChange(parsed.value);
        }}
      />
    </FieldRow>
  );
}

function AddSetting({ taken, onAdd }: { taken: readonly string[]; onAdd: (v: Variable) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<"number" | "string" | "boolean">("number");
  const [value, setValue] = useState("");
  if (!open)
    return (
      <Button
        size="sm"
        variant="ghost"
        className="self-start"
        leadingIcon={<Plus strokeWidth={1.75} />}
        onClick={() => setOpen(true)}
      >
        Add a setting
      </Button>
    );
  const nameError = !name
    ? undefined
    : !VAR_NAME.test(name)
      ? "Start with a lowercase letter; letters, digits and _ only (for example maxAmount)."
      : taken.includes(name)
        ? "A setting with that name exists."
        : undefined;
  const parsed =
    type === "boolean"
      ? ({ ok: true, value: value === "true" } as const)
      : parseSetting({ schema: { type } }, value);
  const valid = name !== "" && !nameError && parsed.ok;
  return (
    <form
      className="flex flex-col gap-2 rounded-sm border border-border p-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid || !parsed.ok) return;
        onAdd({ name, schema: { type }, default: parsed.value, source: "definition" });
        setOpen(false);
        setName("");
        setValue("");
      }}
    >
      <FieldRow label="Name" htmlFor="wf-new-setting" error={nameError} required>
        <Input
          id="wf-new-setting"
          value={name}
          className="font-mono"
          placeholder="maxAmount"
          onChange={(e) => setName(e.target.value.trim())}
        />
      </FieldRow>
      <FieldRow label="Type">
        <Select
          value={type}
          aria-label="Type"
          onValueChange={(v) => {
            setType(v as typeof type);
            setValue(v === "boolean" ? "false" : "");
          }}
        >
          <SelectItem value="number">Number</SelectItem>
          <SelectItem value="string">Text</SelectItem>
          <SelectItem value="boolean">Yes or no</SelectItem>
        </Select>
      </FieldRow>
      {type === "boolean" ? (
        <FieldRow label="Value">
          <Switch
            checked={value === "true"}
            aria-label="Value"
            onCheckedChange={(on) => setValue(on ? "true" : "false")}
          />
        </FieldRow>
      ) : (
        <FieldRow
          label="Value"
          htmlFor="wf-new-setting-value"
          error={value !== "" && !parsed.ok ? parsed.error : undefined}
        >
          <Input
            id="wf-new-setting-value"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </FieldRow>
      )}
      <div className="flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" type="button" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button size="sm" type="submit" disabled={!valid}>
          Add setting
        </Button>
      </div>
    </form>
  );
}
