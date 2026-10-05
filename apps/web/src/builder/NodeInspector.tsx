"use client";
/**
 * The inspector's Config tab (UI.md §5): task nodes render their manifest's `configSchema` with
 * `SchemaForm` and one `BindingField` per input port; structural nodes get focused editors; every
 * node can be edited as validated JSON (the same schema the compiler parses).
 */
import { useMemo, useState } from "react";
import {
  WorkflowNodeSchema,
  type Binding,
  type NodeManifest,
  type WorkflowDefinition,
  type WorkflowNode,
} from "@flowaid/workflow-core";
import type { ExpressionScope } from "@flowaid/ui";
import {
  BindingField,
  type BindingFieldProps,
  CodeEditor,
  FlowExprEditor,
  type TemplateRef,
  JsonSchemaEditor,
  SchemaForm,
  isBinding,
  templateRefsFromScope,
} from "@flowaid/ui/forms";
import {
  Button,
  Collapsible,
  FieldHint,
  FieldRow,
  Input,
  Label,
  Select,
  SelectItem,
  Switch,
  Textarea,
} from "@flowaid/ui/primitives";
// registers the PageIndex source and document pickers (`x-ui-ext.widget`)
import "~/knowledge/pageindex/widgets";
import type { BuilderStore } from "./store";
import type { Projection } from "./model";
import { useModelViews } from "./models";
import { CredentialSlots } from "./CredentialSlots";
import { PolicyEditor } from "./PolicyEditor";
import { savedStepConfig } from "./stepConfig";
import { createLoadOptions } from "./optionProviders";

// agent presets, MCP servers/tools/prompts and OpenAPI toolsets/operations for picker fields
const loadOptions = createLoadOptions();

export interface NodeInspectorProps {
  node: WorkflowNode;
  manifest: NodeManifest | undefined;
  definition: WorkflowDefinition;
  projection: Projection;
  store: BuilderStore;
  readOnly?: boolean;
}

/** Upstream values an expression or ref may use (UI.md §5: compatible-first ordering is the picker's job). */
export function expressionScope(
  def: WorkflowDefinition,
  projection: Projection,
  self: string,
): ExpressionScope {
  const input = projection.nodes.find((n) => n.kind === "input");
  return {
    inputs: input?.outputs ?? [],
    variables: def.variables.map((v) => ({
      name: v.name,
      type:
        typeof v.schema === "object" && v.schema && "type" in v.schema
          ? String((v.schema as { type: unknown }).type)
          : "any",
    })),
    nodes: projection.nodes
      .filter((n) => n.id !== self && n.kind !== "note" && n.outputs.length > 0)
      .map((n) => ({ id: n.id, name: n.name, outputs: n.outputs })),
  };
}

/**
 * The references a template field may use, in the compiler's grammar: `<node id>.<port>` for every
 * other node with outputs (the Input node's fields are `start.<field>` in a new workflow), plus the
 * workflow's variables. The compiler still decides which of them are upstream.
 */
export function templateRefs(scope: ExpressionScope): TemplateRef[] {
  return templateRefsFromScope(scope);
}

/** A manifest's default policy number, when it sets one. */
function manifestNumber(
  manifest: NodeManifest | undefined,
  read: (p: Record<string, unknown>) => unknown,
) {
  const v = manifest ? read(manifest.defaultPolicy) : undefined;
  return typeof v === "number" ? v : undefined;
}

/** What a `BindingField`'s Template mode completes and checks. */
type TemplateScope = Pick<BindingFieldProps, "templateRefs" | "variables" | "inContainer">;

function toBinding(value: unknown): Binding | undefined {
  if (value === undefined) return undefined;
  return isBinding(value) ? value : { kind: "literal", value: value as never };
}

export function NodeInspector({
  node,
  manifest,
  definition,
  projection,
  store,
  readOnly,
  epoch,
}: NodeInspectorProps & { epoch: number }) {
  const scope = useMemo(
    () => expressionScope(definition, projection, node.id),
    [definition, projection, node.id],
  );
  const s = store.getState();
  const view = projection.nodes.find((n) => n.id === node.id);
  const models = useModelViews();
  const refs = useMemo(() => templateRefs(scope), [scope]);
  const variables = useMemo(() => definition.variables.map((v) => v.name), [definition.variables]);
  const parentKind = node.parent
    ? definition.nodes.find((n) => n.id === node.parent)?.kind
    : undefined;
  const inContainer = parentKind === "loop" || parentKind === "foreach";
  // what Template mode completes and checks, the same as the config's template fields
  const templateScope = { templateRefs: refs, variables, inContainer };

  return (
    <div className="flex flex-col gap-5">
      <FieldRow>
        <Label htmlFor={`desc-${node.id}`}>Description</Label>
        <Textarea
          id={`desc-${node.id}`}
          rows={2}
          disabled={readOnly}
          defaultValue={node.kind === "note" ? node.text : (node.description ?? "")}
          key={`${node.id}:desc:${epoch}`}
          onBlur={(e) => {
            const v = e.target.value;
            s.updateNode(
              node.id,
              (n) => {
                if (n.kind === "note") n.text = v;
                else if (v) n.description = v;
                else delete n.description;
              },
              node.kind === "note" ? "Edit note" : "Edit description",
            );
          }}
        />
      </FieldRow>

      {node.kind === "task" && manifest ? (
        <>
          {manifest.credentials.length > 0 ? (
            <CredentialSlots
              node={node}
              slots={manifest.credentials}
              definition={definition}
              store={store}
              readOnly={Boolean(readOnly)}
              workflowId={s.workflowId}
            />
          ) : null}
          <SchemaForm
            key={`${node.id}:config:${epoch}`}
            schema={manifest.configSchema as never}
            defaultValues={node.config}
            scope={scope}
            nodeType={manifest.id}
            loadOptions={loadOptions}
            models={models}
            templateRefs={refs}
            variables={variables}
            inContainer={inContainer}
            disabled={readOnly}
            onChange={(values) =>
              s.setNodeConfig(node.id, savedStepConfig(manifest.configSchema, values))
            }
            aria-label={`${node.name} configuration`}
          />
          {view && view.inputs.length > 0 ? (
            <section className="flex flex-col gap-3" aria-label="Inputs">
              <h3 className="text-eyebrow">Inputs</h3>
              <FieldHint>
                What this step receives. Choose where each input's value comes from.
              </FieldHint>
              {view.inputs.map((p) => (
                <div key={p.id} className="flex flex-col gap-1.5">
                  <Label required={p.required}>{p.label}</Label>
                  <BindingField
                    label={p.label}
                    value={node.inputs[p.id]}
                    scope={scope}
                    disabled={readOnly}
                    structured
                    {...templateScope}
                    showModeHint
                    onChange={(v) => s.setBinding(node.id, p.id, toBinding(v))}
                  />
                  {p.description ? <FieldHint>{p.description}</FieldHint> : null}
                </div>
              ))}
            </section>
          ) : null}
        </>
      ) : null}

      {node.kind === "input" ? (
        <section className="flex flex-col gap-2" aria-label="Workflow inputs">
          <h3 className="text-eyebrow">Workflow inputs</h3>
          <FieldHint>
            Each property is an output port of this node and a field of the run input.
          </FieldHint>
          <JsonSchemaEditor
            value={definition.inputs}
            disabled={readOnly}
            onChange={(v) => s.setInputsSchema(v)}
            aria-label="Input schema"
          />
        </section>
      ) : null}

      {node.kind === "output" ? (
        <>
          <div className="flex flex-col gap-1.5">
            <Label>Result</Label>
            <BindingField
              label="Result"
              value={node.value}
              scope={scope}
              disabled={readOnly}
              structured
              {...templateScope}
              showModeHint
              onChange={(v) =>
                s.setBinding(node.id, "value", toBinding(v) ?? { kind: "literal", value: null })
              }
            />
            <FieldHint>What the run returns when it ends here.</FieldHint>
          </div>
          <FieldRow>
            <Label htmlFor={`outcome-${node.id}`}>Outcome label</Label>
            <Input
              id={`outcome-${node.id}`}
              key={`${node.id}:outcome:${epoch}`}
              defaultValue={node.outcome ?? ""}
              disabled={readOnly}
              placeholder="e.g. escalated"
              onBlur={(e) =>
                s.updateNode(
                  node.id,
                  (n) => {
                    if (n.kind !== "output") return;
                    if (e.target.value) n.outcome = e.target.value;
                    else delete n.outcome;
                  },
                  "Edit outcome",
                )
              }
            />
            <FieldHint>
              A short name for how the run ended here (for example refunded), recorded with the
              run's result.
            </FieldHint>
          </FieldRow>
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`early-${node.id}`}>End the run early</Label>
              <FieldHint id={`early-${node.id}-hint`}>
                {node.earlyExit
                  ? "On: the run finishes as soon as it reaches this output; steps still running are cancelled."
                  : "Off: the run also waits for its other paths to finish."}
              </FieldHint>
            </div>
            <Switch
              id={`early-${node.id}`}
              aria-describedby={`early-${node.id}-hint`}
              checked={node.earlyExit}
              disabled={readOnly}
              onCheckedChange={(v) =>
                s.updateNode(
                  node.id,
                  (n) => {
                    if (n.kind === "output") n.earlyExit = v;
                  },
                  "Toggle early exit",
                )
              }
            />
          </div>
          <section className="flex flex-col gap-2" aria-label="Workflow outputs">
            <h3 className="text-eyebrow">Workflow output schema</h3>
            <JsonSchemaEditor
              value={definition.outputs}
              disabled={readOnly}
              onChange={(v) => s.setOutputsSchema(v)}
              aria-label="Output schema"
            />
          </section>
        </>
      ) : null}

      {node.kind === "branch" ? (
        <BranchEditor
          key={`${node.id}:${epoch}`}
          node={node}
          store={store}
          readOnly={readOnly}
          refs={refs}
          variables={variables}
          inContainer={inContainer}
        />
      ) : null}
      {node.kind === "wait" && node.until.type === "event" ? (
        <EventWaitEditor
          key={`${node.id}:${epoch}`}
          node={node}
          store={store}
          scope={scope}
          templateScope={templateScope}
          readOnly={readOnly}
        />
      ) : null}
      {node.kind === "human" ? (
        <HumanEditor
          key={`${node.id}:${epoch}`}
          node={node}
          store={store}
          scope={scope}
          templateScope={templateScope}
          readOnly={readOnly}
        />
      ) : null}

      <Collapsible
        title={
          policySummary(node.policy)
            ? `Errors & limits · ${policySummary(node.policy)}`
            : "Errors & limits"
        }
        defaultOpen={false}
      >
        <div className="flex flex-col gap-4">
          <PolicyEditor
            nodeId={node.id}
            policy={node.policy}
            defaultTimeoutMs={
              manifestNumber(manifest, (p) => p.timeoutMs) ??
              definition.execution.defaultNodeTimeoutMs
            }
            defaultAttempts={
              manifestNumber(
                manifest,
                (p) => (p.retry as { maxAttempts?: unknown } | undefined)?.maxAttempts,
              ) ?? definition.execution.defaultRetry.maxAttempts
            }
            readOnly={readOnly}
            onChange={(v) => s.setNodePolicy(node.id, v as never)}
          />
          <Collapsible title="Edit policy as JSON" defaultOpen={false}>
            <JsonField
              label="Policy"
              value={node.policy ?? {}}
              readOnly={readOnly}
              onValid={(v) =>
                s.setNodePolicy(node.id, Object.keys(v as object).length ? (v as never) : undefined)
              }
              hint="Also: retry.backoff, retry.retryOn, pool, privacy."
            />
          </Collapsible>
        </div>
      </Collapsible>
      <Collapsible title="Edit as JSON" defaultOpen={false}>
        <JsonField
          label="Node"
          value={node}
          readOnly={readOnly}
          validate={(v) => {
            const r = WorkflowNodeSchema.safeParse(v);
            if (!r.success) return r.error.issues[0]?.message ?? "invalid node";
            if (r.data.id !== node.id)
              return "The id cannot change here; delete and re-add the node instead.";
            return null;
          }}
          onValid={(v) => {
            s.updateNode(
              node.id,
              (n) => Object.assign(n, WorkflowNodeSchema.parse(v)),
              "Edit node JSON",
            );
            s.bumpEpoch();
          }}
        />
      </Collapsible>
    </div>
  );
}

/** "retries 3 · 30 s" style summary of what a node overrides, for the collapsed header. */
export function policySummary(policy: WorkflowNode["policy"]): string {
  if (!policy) return "";
  const parts: string[] = [];
  if (policy.onError === "route") parts.push("failed path");
  if (policy.onError === "ignore") parts.push("carries on");
  if (policy.retry && policy.retry.maxAttempts > 1)
    parts.push(`${policy.retry.maxAttempts} attempts`);
  if (policy.timeoutMs !== undefined) parts.push(`${policy.timeoutMs / 1000} s`);
  if (policy.maxCostUsd !== undefined) parts.push(`$${policy.maxCostUsd}`);
  if (policy.maxTokens !== undefined) parts.push(`${policy.maxTokens} tokens`);
  return parts.join(" · ");
}

function BranchEditor({
  node,
  store,
  readOnly,
  refs,
  variables,
  inContainer,
}: {
  node: Extract<WorkflowNode, { kind: "branch" }>;
  store: BuilderStore;
  readOnly?: boolean | undefined;
  /** what a condition can read: earlier steps' outputs, the settings, the loop fields */
  refs: readonly TemplateRef[];
  variables: readonly string[];
  inContainer: boolean;
}) {
  const s = store.getState();
  return (
    <section className="flex flex-col gap-3" aria-label="Cases">
      <h3 className="text-eyebrow">Cases</h3>
      <FieldHint>
        Evaluated in order;{" "}
        {node.mode === "first" ? "the first true case fires" : "every true case fires"}. Otherwise “
        {node.defaultPort}”.
      </FieldHint>
      {node.cases.map((c, i) => (
        <div
          key={`${node.id}:${i}`}
          className="flex flex-col gap-1.5 rounded-sm border border-border p-2"
        >
          <div className="flex gap-2">
            <Input
              aria-label="Port"
              className="w-36 shrink-0 font-mono"
              defaultValue={c.port}
              disabled={readOnly}
              onBlur={(e) =>
                s.updateNode(
                  node.id,
                  (n) => {
                    if (n.kind === "branch" && n.cases[i]) n.cases[i].port = e.target.value.trim();
                  },
                  "Edit case",
                )
              }
            />
            <Input
              aria-label="Label"
              placeholder="Label"
              defaultValue={c.label ?? ""}
              disabled={readOnly}
              onBlur={(e) =>
                s.updateNode(
                  node.id,
                  (n) => {
                    if (n.kind === "branch" && n.cases[i]) {
                      if (e.target.value) n.cases[i].label = e.target.value;
                      else delete n.cases[i].label;
                    }
                  },
                  "Edit case",
                )
              }
            />
          </div>
          {/* a FlowExpr condition: earlier steps' outputs complete as you type */}
          <FlowExprEditor
            key={`${node.id}:when:${i}`}
            aria-label="When"
            minRows={1}
            maxRows={6}
            refs={refs}
            variables={variables}
            inContainer={inContainer}
            defaultValue={c.when}
            disabled={readOnly}
            onChange={(v) =>
              s.updateNode(
                node.id,
                (n) => {
                  if (n.kind === "branch" && n.cases[i]) n.cases[i].when = v.trim() || "true";
                },
                "Edit condition",
                `when:${node.id}:${i}`,
              )
            }
          />
          {node.cases.length > 1 && !readOnly ? (
            <Button
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={() =>
                s.updateNode(
                  node.id,
                  (n) => {
                    if (n.kind === "branch") n.cases.splice(i, 1);
                  },
                  "Remove case",
                )
              }
            >
              Remove case
            </Button>
          ) : null}
        </div>
      ))}
      {!readOnly ? (
        <Button
          variant="secondary"
          size="sm"
          className="self-start"
          onClick={() =>
            s.updateNode(
              node.id,
              (n) => {
                if (n.kind === "branch")
                  n.cases.push({ port: `case_${n.cases.length + 1}`, when: "true" });
              },
              "Add case",
            )
          }
        >
          Add case
        </Button>
      ) : null}
      <div className="flex items-center justify-between">
        <Label htmlFor={`all-${node.id}`}>Fire every matching case</Label>
        <Switch
          id={`all-${node.id}`}
          checked={node.mode === "all"}
          disabled={readOnly}
          onCheckedChange={(v) =>
            s.updateNode(
              node.id,
              (n) => {
                if (n.kind === "branch") n.mode = v ? "all" : "first";
              },
              "Branch mode",
            )
          }
        />
      </div>
    </section>
  );
}

/** An event wait (RFC-0006): the event name, how long to wait, and an optional correlation key. */
function EventWaitEditor({
  node,
  store,
  scope,
  templateScope,
  readOnly,
}: {
  node: Extract<WorkflowNode, { kind: "wait" }>;
  store: BuilderStore;
  scope: ExpressionScope;
  templateScope: TemplateScope;
  readOnly?: boolean | undefined;
}) {
  const s = store.getState();
  if (node.until.type !== "event") return null;
  const until = node.until;
  const setUntil = (label: string, recipe: (u: Extract<typeof until, { type: "event" }>) => void) =>
    s.updateNode(
      node.id,
      (n) => {
        if (n.kind === "wait" && n.until.type === "event") recipe(n.until);
      },
      label,
    );
  return (
    <section className="flex flex-col gap-3" aria-label="Event">
      <FieldRow>
        <Label htmlFor={`event-${node.id}`}>Event name</Label>
        <Input
          id={`event-${node.id}`}
          className="font-mono"
          defaultValue={until.eventName}
          disabled={readOnly}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (/^[a-z][a-z0-9_.-]{0,63}$/.test(v))
              setUntil("Edit event name", (u) => (u.eventName = v));
          }}
        />
      </FieldRow>
      <FieldRow>
        <Label htmlFor={`timeout-${node.id}`}>Timeout (seconds)</Label>
        <Input
          id={`timeout-${node.id}`}
          type="number"
          min={1}
          defaultValue={Math.round(until.timeoutMs / 1000)}
          disabled={readOnly}
          onBlur={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v >= 1)
              setUntil("Edit timeout", (u) => (u.timeoutMs = Math.round(v * 1000)));
          }}
        />
      </FieldRow>
      <Label>Correlation key</Label>
      <BindingField
        label="Correlation key"
        showModeHint
        {...templateScope}
        value={until.correlation}
        scope={scope}
        disabled={readOnly}
        onChange={(v) =>
          setUntil("Edit correlation key", (u) => {
            const b = toBinding(v);
            const empty = b?.kind === "literal" && (b.value === null || b.value === "");
            if (!b || empty) delete u.correlation;
            else u.correlation = b;
          })
        }
      />
      <FieldHint>
        Only events published with this key resume the run (for example an order id). Leave it empty
        to take the first event of this name.
      </FieldHint>
    </section>
  );
}

function HumanEditor({
  node,
  store,
  scope,
  templateScope,
  readOnly,
}: {
  node: Extract<WorkflowNode, { kind: "human" }>;
  store: BuilderStore;
  scope: ExpressionScope;
  templateScope: TemplateScope;
  readOnly?: boolean | undefined;
}) {
  const s = store.getState();
  return (
    <section className="flex flex-col gap-3" aria-label="Review">
      <Label>Task title</Label>
      <BindingField
        label="Title"
        showModeHint
        {...templateScope}
        value={node.title}
        scope={scope}
        disabled={readOnly}
        onChange={(v) =>
          s.updateNode(
            node.id,
            (n) => {
              if (n.kind === "human")
                n.title = (toBinding(v) ?? { kind: "literal", value: "" }) as never;
            },
            "Edit title",
          )
        }
      />
      <FieldHint>What the reviewer sees at the top of the task under Human tasks.</FieldHint>
      <FieldRow>
        <Label>Mode</Label>
        <Select
          value={node.mode.type}
          disabled={readOnly}
          aria-label="Mode"
          onValueChange={(v) =>
            s.updateNode(
              node.id,
              (n) => {
                if (n.kind !== "human") return;
                n.mode =
                  v === "choice"
                    ? {
                        type: "choice",
                        options: [
                          { id: "option_a", label: "Option A" },
                          { id: "option_b", label: "Option B" },
                        ],
                      }
                    : v === "form"
                      ? {
                          type: "form",
                          schema: { type: "object", properties: { note: { type: "string" } } },
                        }
                      : { type: "approval" };
              },
              "Change review mode",
            )
          }
        >
          <SelectItem value="approval">Approve or reject</SelectItem>
          <SelectItem value="choice">Choose an option</SelectItem>
          <SelectItem value="form">Fill a form</SelectItem>
          {node.mode.type === "review" ? (
            <SelectItem value="review">Review a value</SelectItem>
          ) : null}
        </Select>
      </FieldRow>
      <FieldRow>
        <Label htmlFor={`assignees-${node.id}`}>Assignees</Label>
        <Input
          id={`assignees-${node.id}`}
          key={`${node.id}:assignees`}
          defaultValue={node.assignees.join(", ")}
          disabled={readOnly}
          placeholder="email or role:editor, comma separated"
          onBlur={(e) =>
            s.updateNode(
              node.id,
              (n) => {
                if (n.kind === "human")
                  n.assignees = e.target.value
                    .split(",")
                    .map((x) => x.trim())
                    .filter(Boolean);
              },
              "Edit assignees",
            )
          }
        />
      </FieldRow>
      <div className="flex items-center justify-between">
        <Label htmlFor={`ext-${node.id}`}>Allow external review links</Label>
        <Switch
          id={`ext-${node.id}`}
          checked={node.externalReview}
          disabled={readOnly}
          onCheckedChange={(v) =>
            s.updateNode(
              node.id,
              (n) => {
                if (n.kind === "human") n.externalReview = v;
              },
              "Toggle external review",
            )
          }
        />
      </div>
    </section>
  );
}

/** A JSON editor that commits only valid documents. */
function JsonField({
  label,
  value,
  onValid,
  validate,
  hint,
  readOnly,
}: {
  label: string;
  value: unknown;
  onValid: (v: unknown) => void;
  validate?: (v: unknown) => string | null;
  hint?: string;
  readOnly?: boolean | undefined;
}) {
  const text = useMemo(() => JSON.stringify(value, null, 2), [value]);
  const [draft, setDraft] = useState(text);
  const [error, setError] = useState<string | null>(null);
  // re-seed when the node changes elsewhere (adjusting state during render, not in an effect)
  const [seen, setSeen] = useState(text);
  if (seen !== text) {
    setSeen(text);
    setDraft(text);
    setError(null);
  }
  const commit = () => {
    if (draft === text) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(draft);
    } catch (e) {
      setError(e instanceof Error ? e.message : "invalid JSON");
      return;
    }
    const problem = validate?.(parsed) ?? null;
    setError(problem);
    if (!problem) onValid(parsed);
  };
  return (
    <div className="flex flex-col gap-2">
      <CodeEditor
        language="json"
        value={draft}
        onChange={setDraft}
        readOnly={readOnly}
        invalid={error !== null}
        minRows={4}
        maxRows={24}
        aria-label={label}
      />
      {hint ? <FieldHint>{hint}</FieldHint> : null}
      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {!readOnly ? (
        <Button
          size="sm"
          variant="secondary"
          className="self-start"
          disabled={draft === text}
          onClick={commit}
        >
          Apply
        </Button>
      ) : null}
    </div>
  );
}
