"use client";
/**
 * Confirm dialogs for the run actions (API.md §3.4, ARCHITECTURE.md §5.9): replay (re-execute or
 * reuse recorded results), fork onto the draft or the run's version with a patched input, restart
 * from a node with its inputs optionally overridden, retry a failed node in place, and cancel
 * (it can't be undone, so it asks first and takes an optional reason).
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
  | { kind: "retry"; nodeRunId: string; nodeName: string }
  /** `waitingFor`: the person's step the run waits on, named in the warning. */
  | { kind: "cancel"; waitingFor?: string };

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
  // the free choice first: re-executing calls (and charges) every model and tool again
  const [mode, setMode] = useState("recorded");
  // "draft", or the id of a published version
  const [target, setTarget] = useState(
    action.kind === "fork" && action.versionId ? action.versionId : "draft",
  );
  const [json, setJson] = useState(action.kind === "fork" ? pretty(action.input) : "");
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");

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
      case "cancel":
        return { path: `${base}/cancel`, body: reason.trim() ? { reason: reason.trim() } : {} };
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
      description:
        "Starts a new run of the same version with the same input. This run is left as it is.",
      confirm: mode === "reexecute" ? "Replay and call again" : "Replay",
    },
    fork: {
      title: "Fork this run",
      description:
        "Starts a new run on the version you choose, with the input you edit. Steps whose inputs are unchanged reuse this run's results; the rest call their models and tools again, at their usual cost.",
      confirm: "Fork",
    },
    restart: {
      title: `Restart from ${action.kind === "restart" ? action.nodeName : ""}`,
      description:
        "Starts a new run that reuses this run's results up to the node, then executes the node and everything after it. Model and tool calls from there on are made, and charged, again.",
      confirm: "Restart",
    },
    retry: {
      title: `Retry ${action.kind === "retry" ? action.nodeName : ""}`,
      description:
        "Reopens this failed run and executes the node again, then continues from its result. No new run is created. Use it for passing errors such as a timeout; a wrong setting fails the same way, so fix the draft and fork this run onto it instead.",
      confirm: "Retry node",
    },
    cancel: {
      title: "Cancel this run?",
      description: `Steps that are running finish their current call; nothing after them starts${
        action.kind === "cancel" && action.waitingFor
          ? `, and the task waiting on “${action.waitingFor}” closes unanswered`
          : ", and any task waiting for a person closes"
      }. This can't be undone: Replay starts the same request again from the beginning.`,
      confirm: "Cancel run",
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
      {...(action.kind === "cancel"
        ? { variant: "danger" as const, cancelLabel: "Keep running" }
        : {})}
      loading={busy}
      confirmDisabled={Boolean(parsed.error)}
      onConfirm={() => void confirm()}
    >
      {action.kind === "replay" ? (
        <RadioGroup value={mode} onValueChange={setMode} aria-label="Replay mode">
          <RadioItem
            value="recorded"
            label="Reuse recorded results"
            description="Step results are taken from this run where the inputs match, so those calls are not made or charged again."
          />
          <RadioItem
            value="reexecute"
            label="Run every step again"
            description="Models and tools are called again, at their usual cost; results may differ."
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
      {action.kind === "cancel" ? (
        <FieldRow
          label="Reason"
          optional
          hint="Kept with the run: its Events and the audit log show it."
        >
          <Textarea
            autoGrow
            minRows={2}
            maxRows={6}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why stop it now?"
          />
        </FieldRow>
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
