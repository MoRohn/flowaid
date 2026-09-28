"use client";
/**
 * Confirm dialogs for the run actions (API.md §3.4, ARCHITECTURE.md §5.9): replay (re-execute or
 * reuse recorded results), fork onto the draft or the run's version with a patched input, restart
 * from a node with its inputs optionally overridden, and retry a failed node in place.
 */
import { useState } from "react";
import { ConfirmDialog, FieldRow, RadioGroup, RadioItem, Textarea } from "@flowaid/ui/primitives";

export type RunAction =
  | { kind: "replay" }
  | {
      kind: "fork";
      /** The run's published version, or null when the run executed the draft. */
      versionId: string | null;
      input: unknown;
      /** The workflow's published versions, newest first, to fork onto. */
      versions?: readonly { id: string; version: number }[];
    }
  | { kind: "restart"; nodeId: string; nodeName: string; scope?: string }
  | { kind: "retry"; nodeRunId: string; nodeName: string };

export interface RunActionRequest {
  path: string;
  body?: Record<string, unknown>;
}

/** Parses an optional JSON object field: empty is `undefined`, anything but an object is an error. */
export function parseObject(text: string): { value?: Record<string, unknown>; error?: string } {
  if (!text.trim()) return {};
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return { error: "Enter a JSON object" };
    return { value: value as Record<string, unknown> };
  } catch {
    return { error: "Not valid JSON" };
  }
}

const pretty = (v: unknown) => (v === undefined || v === null ? "" : JSON.stringify(v, null, 2));

export interface RunActionDialogProps {
  runId: string;
  action: RunAction | null;
  onOpenChange: (open: boolean) => void;
  /** Sends the request; reject to keep the dialog open (the caller reports the error). */
  onSubmit: (request: RunActionRequest) => Promise<void>;
}

export function RunActionDialog({ action, ...props }: RunActionDialogProps) {
  // A fresh form per action, so nothing typed for one action leaks into the next.
  return action ? <ActionForm key={JSON.stringify(action)} action={action} {...props} /> : null;
}

function ActionForm({
  runId,
  action,
  onOpenChange,
  onSubmit,
}: RunActionDialogProps & { action: RunAction }) {
  const [mode, setMode] = useState("reexecute");
  // "draft", or the id of a published version
  const [target, setTarget] = useState(
    action.kind === "fork" && action.versionId ? action.versionId : "draft",
  );
  const [json, setJson] = useState(action.kind === "fork" ? pretty(action.input) : "");
  const [busy, setBusy] = useState(false);

  const parsed = parseObject(json);
  const base = `/v1/runs/${runId}`;
  const request = (): RunActionRequest => {
    switch (action.kind) {
      case "replay":
        return { path: `${base}/replay`, body: { mode } };
      case "fork":
        return {
          path: `${base}/fork`,
          body: {
            ...(target === "draft" ? { draft: true } : { versionId: target }),
            ...(parsed.value ? { input: parsed.value } : {}),
          },
        };
      case "restart":
        return {
          path: `${base}/restart`,
          body: {
            nodeId: action.nodeId,
            ...(action.scope ? { scope: action.scope } : {}),
            ...(parsed.value ? { input: parsed.value } : {}),
          },
        };
      case "retry":
        return { path: `${base}/node-runs/${action.nodeRunId}/retry` };
    }
  };
  const confirm = async () => {
    setBusy(true);
    try {
      await onSubmit(request());
      onOpenChange(false);
    } catch {
      // The caller reported the error; the dialog stays open to adjust and try again.
    } finally {
      setBusy(false);
    }
  };

  const copy = {
    replay: {
      title: "Replay this run",
      description: "Starts a new run of the same version with the same input.",
      confirm: "Replay",
    },
    fork: {
      title: "Fork this run",
      description:
        "Starts a new run with results reused from this one, on the version you choose and with the input you edit.",
      confirm: "Fork",
    },
    restart: {
      title: `Restart from ${action.kind === "restart" ? action.nodeName : ""}`,
      description:
        "Starts a new run that reuses this run's results up to the node, then executes the node and everything after it.",
      confirm: "Restart",
    },
    retry: {
      title: `Retry ${action.kind === "retry" ? action.nodeName : ""}`,
      description:
        "Reopens this failed run and executes the node again, then continues from its result. No new run is created.",
      confirm: "Retry node",
    },
  }[action.kind];

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!busy) onOpenChange(open);
      }}
      title={copy.title}
      description={copy.description}
      confirmLabel={copy.confirm}
      loading={busy}
      confirmDisabled={Boolean(parsed.error)}
      onConfirm={() => void confirm()}
    >
      {action.kind === "replay" ? (
        <RadioGroup value={mode} onValueChange={setMode} aria-label="Replay mode">
          <RadioItem
            value="reexecute"
            label="Execute every node again"
            description="Models and tools are called again; results may differ."
          />
          <RadioItem
            value="recorded"
            label="Reuse recorded results"
            description="Node results are taken from this run where the inputs match."
          />
        </RadioGroup>
      ) : null}
      {action.kind === "fork" ? (
        <div className="flex flex-col gap-4">
          <RadioGroup value={target} onValueChange={setTarget} aria-label="Fork onto">
            {forkVersions(action).map((v) => (
              <RadioItem
                key={v.id}
                value={v.id}
                label={`v${v.version}`}
                {...(v.id === action.versionId ? { description: "This run's version" } : {})}
              />
            ))}
            <RadioItem
              value="draft"
              label="The current draft"
              description="Try unpublished changes against this run's data."
            />
          </RadioGroup>
          <FieldRow
            label="Input"
            hint="Fields you set replace the run's input."
            {...errorOf(parsed)}
          >
            <Textarea
              mono
              autoGrow
              minRows={4}
              maxRows={14}
              value={json}
              onChange={(e) => setJson(e.target.value)}
            />
          </FieldRow>
        </div>
      ) : null}
      {action.kind === "restart" ? (
        <FieldRow
          label="Override the node's inputs"
          hint="Optional. A JSON object of input ports and values; leave empty to use the recorded inputs."
          optional
          {...errorOf(parsed)}
        >
          <Textarea
            mono
            autoGrow
            minRows={3}
            maxRows={12}
            value={json}
            onChange={(e) => setJson(e.target.value)}
          />
        </FieldRow>
      ) : null}
    </ConfirmDialog>
  );
}

const errorOf = (p: { error?: string }) => (p.error ? { error: p.error } : {});

/** The versions a fork can target: the published ones, and the run's own when it is not listed. */
export function forkVersions(
  action: Extract<RunAction, { kind: "fork" }>,
): { id: string; version: number | string }[] {
  const listed: { id: string; version: number | string }[] = [...(action.versions ?? [])];
  if (action.versionId && !listed.some((v) => v.id === action.versionId))
    listed.unshift({ id: action.versionId, version: "?" });
  return listed;
}
