"use client";
/**
 * The inspector when no node is selected: the workflow itself. Its name and description, and its
 * settings — the workflow variables (`$vars.<name>`) that templates use for limits, windows and
 * scores — edited as plain fields with their own validation. Environments can still override a
 * setting per deployment; what is edited here is the default every run starts from.
 */
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { JsonValue, Variable, WorkflowDefinition } from "@flowaid/workflow-core";
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
}: {
  definition: WorkflowDefinition;
  store: BuilderStore;
  readOnly: boolean;
  name: string;
  onRename?: (name: string) => void;
  /** Saves the description on the workflow itself (lists, search), besides the draft. */
  onDescribe?: (description: string) => void;
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
    </div>
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
