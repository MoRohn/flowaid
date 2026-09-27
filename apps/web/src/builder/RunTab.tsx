"use client";
/** The builder's Run tab: input from the workflow's input schema (form ⇄ JSON), environment, run. */
import { useState } from "react";
import { Play } from "lucide-react";
import type { JsonSchema } from "@flowaid/workflow-core";
import { CodeEditor, SchemaForm, withDefaults } from "@flowaid/ui/forms";
import {
  Button,
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
}

export function RunTab(p: RunTabProps) {
  const [mode, setMode] = useState<"form" | "json">("form");
  const value = p.value ?? withDefaults(p.inputs as never, {});
  // SchemaForm is uncontrolled here: it re-seeds only when the JSON editor hands a value back
  const [seed, setSeed] = useState(() => ({ n: 0, values: value }));
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);

  const run = () => {
    if (mode === "json") {
      try {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        p.onValueChange(parsed);
        p.onRun(parsed);
      } catch (e) {
        setJsonError(e instanceof Error ? e.message : "invalid JSON");
      }
      return;
    }
    p.onRun(value);
  };

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
          >
            Run draft
          </Button>
        </div>
      </div>
      {p.disabledReason ? <p className="text-xs text-ink-3">{p.disabledReason}</p> : null}
      {mode === "form" ? (
        <SchemaForm
          key={seed.n}
          schema={p.inputs as never}
          defaultValues={seed.values}
          onChange={(v) => p.onValueChange(v)}
          aria-label="Run input"
        />
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
