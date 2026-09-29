"use client";
/**
 * The inspector's "If this step fails" section: the everyday parts of a node's `NodePolicy`
 * (what happens on an error, retries, the time limit, the cost and token bounds) as plain
 * controls. Everything else in the policy (backoff, retryOn, pool, privacy) is kept as is and
 * stays editable as JSON below it.
 */
import { useState } from "react";
import type { NodePolicy } from "@flowaid/workflow-core";
import { FieldRow, NumberInput, RadioGroup, RadioItem } from "@flowaid/ui/primitives";

export type OnError = "fail" | "route" | "ignore";

/** The policy fields this form edits; `null` clears one (back to the default). */
export interface PolicyPatch {
  onError?: OnError;
  timeoutSeconds?: number | null;
  maxAttempts?: number | null;
  maxCostUsd?: number | null;
  maxTokens?: number | null;
}

/**
 * Applies a patch to a node policy and returns the new policy, or undefined when nothing is left
 * (the node then uses the manifest and workflow defaults). Unrelated fields are kept; a retry
 * keeps its backoff settings when only the attempt count changes.
 */
export function patchPolicy(
  policy: Partial<NodePolicy> | undefined,
  patch: PolicyPatch,
): Partial<NodePolicy> | undefined {
  const next: Record<string, unknown> = { ...policy };
  if (patch.onError !== undefined) {
    if (patch.onError === "fail") delete next.onError;
    else next.onError = patch.onError;
  }
  if (patch.timeoutSeconds !== undefined) {
    if (patch.timeoutSeconds === null) delete next.timeoutMs;
    else next.timeoutMs = Math.max(1, Math.round(patch.timeoutSeconds * 1000));
  }
  if (patch.maxAttempts !== undefined) {
    if (patch.maxAttempts === null) delete next.retry;
    else next.retry = { ...(policy?.retry ?? {}), maxAttempts: patch.maxAttempts };
  }
  if (patch.maxCostUsd !== undefined) {
    if (patch.maxCostUsd === null) delete next.maxCostUsd;
    else next.maxCostUsd = patch.maxCostUsd;
  }
  if (patch.maxTokens !== undefined) {
    if (patch.maxTokens === null) delete next.maxTokens;
    else next.maxTokens = patch.maxTokens;
  }
  // a parsed policy carries `onError: 'fail'` (the schema default); alone it overrides nothing
  const keys = Object.keys(next);
  if (keys.length === 0 || (keys.length === 1 && next.onError === "fail")) return undefined;
  return next;
}

const ON_ERROR: { value: OnError; label: string; description: string }[] = [
  {
    value: "fail",
    label: "Stop the run",
    description: "The run fails with this step's error. The default.",
  },
  {
    value: "route",
    label: "Take the failed path",
    description:
      "The step gets a “failed” connection on the canvas; the run continues along it, so you can handle the error with other steps.",
  },
  {
    value: "ignore",
    label: "Carry on without a result",
    description: "The step's outputs are empty (null) and the run continues as if it finished.",
  },
];

export function PolicyEditor({
  nodeId,
  policy,
  defaultTimeoutMs,
  defaultAttempts,
  readOnly,
  onChange,
}: {
  nodeId: string;
  policy: Partial<NodePolicy> | undefined;
  /** The timeout the node gets when it sets none (its manifest's, else the workflow's). */
  defaultTimeoutMs: number;
  /** The attempts the node gets when it sets no retry (its manifest's, else the workflow's). */
  defaultAttempts: number;
  readOnly?: boolean | undefined;
  onChange: (policy: Partial<NodePolicy> | undefined) => void;
}) {
  const onError: OnError = policy?.onError ?? "fail";
  const apply = (patch: PolicyPatch) => onChange(patchPolicy(policy, patch));
  const id = (name: string) => `policy-${nodeId}-${name}`;

  return (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-xs font-medium text-ink-2">When this step fails</legend>
        <RadioGroup
          value={onError}
          disabled={readOnly}
          onValueChange={(v) => {
            const next = ON_ERROR.find((o) => o.value === v);
            if (next) apply({ onError: next.value });
          }}
          aria-label="When this step fails"
        >
          {ON_ERROR.map((o) => (
            <RadioItem key={o.value} value={o.value} label={o.label} description={o.description} />
          ))}
        </RadioGroup>
      </fieldset>

      <div className="grid gap-3">
        <CommitNumber
          id={id("attempts")}
          label="Attempts"
          value={policy?.retry?.maxAttempts ?? null}
          min={1}
          max={20}
          step={1}
          placeholder={`Default: ${defaultAttempts}`}
          hint={`Tries in total, including the first. Only temporary errors (rate limits, an overloaded provider, timeouts) are retried, each after a longer wait. Empty uses the default (${defaultAttempts}).`}
          readOnly={readOnly}
          onCommit={(v) => apply({ maxAttempts: v })}
        />
        <CommitNumber
          id={id("timeout")}
          label="Time limit"
          unit="s"
          value={policy?.timeoutMs !== undefined ? policy.timeoutMs / 1000 : null}
          min={0.001}
          step={1}
          precision={3}
          placeholder={`Default: ${defaultTimeoutMs / 1000}`}
          hint={`The step fails with a timeout after this long. Empty uses the default (${defaultTimeoutMs / 1000} s).`}
          readOnly={readOnly}
          onCommit={(v) => apply({ timeoutSeconds: v })}
        />
        <CommitNumber
          id={id("cost")}
          label="Cost limit"
          unit="USD"
          value={policy?.maxCostUsd ?? null}
          min={0.0001}
          step={0.01}
          precision={4}
          placeholder="None"
          hint="The most this step should spend on model calls. Used for the run's worst-case cost estimate; agent steps need a cost or token limit."
          readOnly={readOnly}
          onCommit={(v) => apply({ maxCostUsd: v })}
        />
        <CommitNumber
          id={id("tokens")}
          label="Token limit"
          value={policy?.maxTokens ?? null}
          min={1}
          step={1000}
          precision={0}
          placeholder="None"
          hint="The most tokens this step should use. Agent steps need a cost or token limit."
          readOnly={readOnly}
          onCommit={(v) => apply({ maxTokens: v })}
        />
      </div>
    </div>
  );
}

/** A number field that writes to the workflow on blur or Enter, not on every keystroke. */
function CommitNumber({
  id,
  label,
  value,
  hint,
  readOnly,
  onCommit,
  ...rest
}: {
  id: string;
  label: string;
  value: number | null;
  hint: string;
  readOnly?: boolean | undefined;
  onCommit: (value: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  unit?: string;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState<number | null>(value);
  // adopt a value changed elsewhere (undo, the JSON editor)
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value);
  }
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <FieldRow label={label} htmlFor={id} hint={hint}>
      <NumberInput
        id={id}
        value={draft}
        disabled={readOnly}
        onValueChange={setDraft}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
        {...rest}
      />
    </FieldRow>
  );
}
