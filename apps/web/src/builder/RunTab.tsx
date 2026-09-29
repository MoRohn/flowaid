"use client";
/**
 * The builder's Run tab: input from the workflow's input schema (form ⇄ JSON), environment, run.
 * Required fields are checked before anything is sent; when the draft cannot run, the problems in
 * the way are listed here with a way to reach each one, and a run the server refused says why.
 */
import Link from "next/link";
import { useRef, useState } from "react";
import { AlertTriangle, Play } from "lucide-react";
import type { JsonSchema } from "@flowaid/workflow-core";
import { CodeEditor, SchemaForm, withDefaults, type SchemaFormHandle } from "@flowaid/ui/forms";
import {
  Button,
  FieldHint,
  FieldRow,
  Label,
  Select,
  SelectItem,
  StatusChip,
  ToggleGroup,
  ToggleGroupItem,
} from "@flowaid/ui/primitives";
import type { RunStatus } from "@flowaid/workflow-core";
import type { Environment } from "~/api/types";
import type { RunStartError } from "./errors";

/** A compile error in the way of running, with how to reach it. */
export interface BlockingProblem {
  key: string;
  /** "Generate text › system: Invalid input" */
  text: string;
  onShow?: () => void;
}

export interface RunTabProps {
  inputs: JsonSchema;
  environments: readonly Environment[];
  environmentId: string | null;
  onEnvironmentChange: (id: string) => void;
  value: Record<string, unknown> | null;
  onValueChange: (v: Record<string, unknown>) => void;
  onRun: (input: Record<string, unknown>) => void;
  running: boolean;
  status: RunStatus | null;
  disabledReason?: string | null;
  /** The compile errors behind `disabledReason`, when that is what blocks the run. */
  problems?: readonly BlockingProblem[];
  onShowProblems?: () => void;
  /** Why the last attempt did not start (cleared when a run starts). */
  error?: RunStartError | null;
  /** The workflow's Secrets settings, linked when an unbound key stopped the run. */
  secretsHref?: string;
}

/** Top-level required properties that are missing or empty, by name. */
export function missingRequired(schema: JsonSchema, value: Record<string, unknown>): string[] {
  const required = (schema as { required?: unknown }).required;
  if (!Array.isArray(required)) return [];
  return required.filter((k): k is string => {
    if (typeof k !== "string") return false;
    const v = value[k];
    return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
  });
}

const label = (schema: JsonSchema, key: string) => {
  const title = (schema as { properties?: Record<string, { title?: string }> }).properties?.[key]
    ?.title;
  if (title) return title;
  const spaced = key.replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

const hasFields = (schema: JsonSchema) =>
  Object.keys((schema as { properties?: object }).properties ?? {}).length > 0;

export function RunTab(p: RunTabProps) {
  const [mode, setMode] = useState<"form" | "json">("form");
  const value = p.value ?? withDefaults(p.inputs as never, {});
  // SchemaForm is uncontrolled here: it re-seeds only when the JSON editor hands a value back
  const [seed, setSeed] = useState(() => ({ n: 0, values: value }));
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const form = useRef<SchemaFormHandle>(null);
  const fields = useRef<HTMLDivElement>(null);

  const check = (input: Record<string, unknown>): boolean => {
    const gaps = missingRequired(p.inputs, input);
    setMissing(gaps);
    return gaps.length === 0;
  };

  const run = () => {
    if (mode === "json") {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(text) as Record<string, unknown>;
      } catch (e) {
        setJsonError(e instanceof Error ? e.message : "invalid JSON");
        return;
      }
      p.onValueChange(parsed);
      if (check(parsed)) p.onRun(parsed);
      return;
    }
    // the form marks each field it rejects; the missing ones are named next to the button too
    if (!check(value)) {
      form.current?.submit();
      // keyboard users land on the first field to fix, once the form has marked it
      setTimeout(
        () => fields.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
        50,
      );
      return;
    }
    p.onRun(value);
  };

  const env = p.environments.find((e) => e.id === p.environmentId);

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-3">
      <div className="flex flex-wrap items-end gap-3">
        <ToggleGroup
          type="single"
          value={mode}
          onValueChange={(v) => {
            if (v === "json") setText(JSON.stringify(value, null, 2));
            if (v === "form" && mode === "json") {
              try {
                const parsed = JSON.parse(text) as Record<string, unknown>;
                p.onValueChange(parsed);
                setSeed((cur) => ({ n: cur.n + 1, values: parsed }));
              } catch {
                /* keep the form value */
              }
            }
            if (v) setMode(v as "form" | "json");
          }}
          aria-label="Input editor"
        >
          <ToggleGroupItem value="form">Form</ToggleGroupItem>
          <ToggleGroupItem value="json">JSON</ToggleGroupItem>
        </ToggleGroup>
        {p.environments.length > 0 ? (
          <FieldRow className="w-44">
            <Label>Environment</Label>
            <Select
              value={p.environmentId ?? ""}
              onValueChange={p.onEnvironmentChange}
              aria-label="Environment"
              size="sm"
            >
              {p.environments.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.name}
                </SelectItem>
              ))}
            </Select>
          </FieldRow>
        ) : null}
        <div className="ml-auto flex items-center gap-3">
          {p.status ? <StatusChip status={p.status} /> : null}
          <Button
            leadingIcon={<Play strokeWidth={1.75} />}
            onClick={run}
            loading={p.running}
            disabled={Boolean(p.disabledReason)}
            aria-describedby={p.disabledReason ? "run-blocked" : undefined}
          >
            Run draft
          </Button>
        </div>
      </div>
      <FieldHint>
        Runs the unpublished draft once with this input
        {env ? `, using the ${env.name} environment's secrets and variables` : ""}. The trace and
        output appear in the next tabs; nothing is published.
      </FieldHint>

      {p.disabledReason ? (
        <div
          id="run-blocked"
          role="status"
          className="flex flex-col gap-1.5 rounded-sm border border-border bg-surface-2 p-2.5"
        >
          <p className="flex items-center gap-1.5 text-xs text-ink">
            <AlertTriangle className="size-3.5 text-warn" strokeWidth={1.75} aria-hidden="true" />
            {p.disabledReason}
          </p>
          {p.problems?.length ? (
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {p.problems.slice(0, 5).map((x) => (
                <li key={x.key} className="flex items-start gap-2 text-xs text-ink-2">
                  <span className="min-w-0 flex-1 break-words">{x.text}</span>
                  {x.onShow ? (
                    <Button size="sm" variant="ghost" className="shrink-0" onClick={x.onShow}>
                      Show
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {p.onShowProblems && p.problems?.length ? (
            <Button size="sm" variant="secondary" className="self-start" onClick={p.onShowProblems}>
              Open Problems
            </Button>
          ) : null}
        </div>
      ) : null}

      {p.error ? (
        <div role="alert" className="flex flex-col gap-1 rounded-sm border border-danger p-2.5">
          <p className="text-xs font-medium text-ink">{p.error.title}</p>
          <p className="text-xs text-ink-2">{p.error.action}</p>
          {p.error.items.length ? (
            <ul className="m-0 list-disc pl-4 text-xs text-ink-2">
              {p.error.items.slice(0, 6).map((x, i) => (
                <li key={i} className="break-words">
                  {x}
                </li>
              ))}
            </ul>
          ) : null}
          {p.error.kind === "secrets" && p.secretsHref ? (
            <Link
              className="self-start text-xs text-accent-text hover:underline"
              href={p.secretsHref}
            >
              Open Secrets settings
            </Link>
          ) : null}
          {p.error.code ? (
            <p className="font-mono text-2xs text-ink-3">
              {p.error.code}
              {p.error.requestId ? ` · request ${p.error.requestId}` : ""}
            </p>
          ) : null}
        </div>
      ) : null}

      {missing.length ? (
        <p className="text-xs text-danger" role="alert">
          Fill in {missing.map((k) => label(p.inputs, k)).join(", ")} to run.
        </p>
      ) : null}

      {mode === "form" ? (
        hasFields(p.inputs) ? (
          <div ref={fields} className="contents">
            <SchemaForm
              ref={form}
              key={seed.n}
              schema={p.inputs as never}
              defaultValues={seed.values}
              onChange={(v) => {
                p.onValueChange(v);
                if (missing.length) setMissing(missingRequired(p.inputs, v));
              }}
              onSubmit={(v) => p.onRun(v)}
              aria-label="Run input"
            />
          </div>
        ) : (
          <FieldHint>
            This workflow takes no input. Add fields on the Input node to ask for some.
          </FieldHint>
        )
      ) : (
        <>
          <CodeEditor
            language="json"
            value={text}
            onChange={(v) => {
              setText(v);
              setJsonError(null);
            }}
            minRows={6}
            maxRows={20}
            invalid={jsonError !== null}
            aria-label="Run input JSON"
          />
          {jsonError ? (
            <p className="text-xs text-danger" role="alert">
              {jsonError}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
