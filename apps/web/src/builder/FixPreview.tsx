"use client";
/**
 * What a critic fix would change, shown before it is applied: each RFC 6902 operation in words
 * ("Set Classify › config.model to "gpt-x"") and a line diff of the definition before and after.
 */
import { applyJsonPatch, JsonPatchError, type JsonValue } from "@flowaid/shared";
import type { JsonPatch, WorkflowDefinition } from "@flowaid/workflow-core";
import { DiffView } from "@flowaid/ui/data";

export interface PatchStep {
  verb: string;
  target: string;
  value?: string;
}

const VERB = {
  add: "Add",
  remove: "Remove",
  replace: "Set",
  move: "Move",
  copy: "Copy",
  test: "Check",
} as const;

const unescape = (t: string) => t.replace(/~1/g, "/").replace(/~0/g, "~");

/** "Classify › config.model" for "/nodes/2/config/model"; the pointer itself when it is not a node or edge. */
export function describePointer(pointer: string, def: WorkflowDefinition): string {
  const [head, index, ...rest] = pointer.split("/").slice(1).map(unescape);
  const tail = rest.length ? ` › ${rest.join(".")}` : "";
  if (head === "nodes" && index !== undefined) {
    if (index === "-") return "a new node";
    const node = def.nodes[Number(index)];
    return `${node ? node.name : `node ${index}`}${tail}`;
  }
  if (head === "edges" && index !== undefined) {
    if (index === "-") return "a new edge";
    const edge = def.edges[Number(index)];
    const name = (id: string) => def.nodes.find((n) => n.id === id)?.name ?? id;
    return `${edge ? `edge ${name(edge.from.node)} → ${name(edge.to.node)}` : `edge ${index}`}${tail}`;
  }
  return pointer.slice(1).split("/").map(unescape).join(".") || "the workflow";
}

function short(value: unknown): string {
  const text = JSON.stringify(value) ?? "null";
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

export function describePatch(patch: JsonPatch, def: WorkflowDefinition): PatchStep[] {
  return patch.map((op) => {
    if (op.op === "move" || op.op === "copy")
      return {
        verb: VERB[op.op],
        target: `${describePointer(op.from, def)} to ${describePointer(op.path, def)}`,
      };
    // a whole new node reads by its name rather than its JSON
    if (op.op === "add" && /^\/nodes\/(-|\d+)$/.test(op.path)) {
      const name = (op.value as { name?: unknown } | null)?.name;
      return { verb: "Add node", target: typeof name === "string" ? name : "a new node" };
    }
    return {
      verb: VERB[op.op],
      target: describePointer(op.path, def),
      ...("value" in op ? { value: short(op.value) } : {}),
    };
  });
}

/** The definition after the patch, or null when it no longer applies (the draft moved on). */
export function patchedDefinition(
  def: WorkflowDefinition,
  patch: JsonPatch,
): WorkflowDefinition | null {
  try {
    return applyJsonPatch(def as unknown as JsonValue, patch) as unknown as WorkflowDefinition;
  } catch (e) {
    if (e instanceof JsonPatchError) return null;
    throw e;
  }
}

export function FixPreview({
  patch,
  definition,
}: {
  patch: JsonPatch;
  definition: WorkflowDefinition;
}) {
  const steps = describePatch(patch, definition);
  const after = patchedDefinition(definition, patch);
  return (
    <div className="flex flex-col gap-2">
      <ol className="flex flex-col gap-1 text-xs" aria-label="Changes">
        {steps.map((s, i) => (
          <li key={i} className="flex flex-wrap items-baseline gap-x-1.5">
            <span className="font-medium text-ink">{s.verb}</span>
            <span className="text-ink-2">{s.target}</span>
            {s.value !== undefined ? (
              <>
                <span className="text-ink-3">to</span>
                <code className="break-all font-mono text-2xs text-ink-2">{s.value}</code>
              </>
            ) : null}
          </li>
        ))}
      </ol>
      {after ? (
        <DiffView
          oldValue={definition}
          newValue={after}
          oldLabel="Draft"
          newLabel="With the fix"
          mode="inline"
          modeToggle={false}
          context={2}
          maxHeight={240}
        />
      ) : (
        <p className="text-xs text-warn-text">
          The draft changed since the review; applying re-checks the fix first.
        </p>
      )}
    </div>
  );
}
