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
  CodeEditor,
  JsonSchemaEditor,
  SchemaForm,
  isBinding,
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
import type { BuilderStore } from "./store";
import type { Projection } from "./model";

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
          <SchemaForm
            key={`${node.id}:config:${epoch}`}
            schema={manifest.configSchema as never}
            defaultValues={node.config}
            scope={scope}
            nodeType={manifest.id}
            disabled={readOnly}
            onChange={(values) => s.setNodeConfig(node.id, values)}
            aria-label={`${node.name} configuration`}
          />
          {view && view.inputs.length > 0 ? (
            <section className="flex flex-col gap-3" aria-label="Inputs">
              <h3 className="text-eyebrow">Inputs</h3>
              {view.inputs.map((p) => (
                <div key={p.id} className="flex flex-col gap-1">
                  <BindingField
                    label={`${p.label}${p.required ? " *" : ""}`}
                    value={node.inputs[p.id]}
                    scope={scope}
                    disabled={readOnly}
                    onChange={(v) => s.setBinding(node.id, p.id, toBinding(v))}
                  />
                  {p.description ? <FieldHint>{p.description}</FieldHint> : null}
                </div>
              ))}
            </section>
          ) : null}
          {manifest.credentials.length > 0 ? (
            <section className="flex flex-col gap-3" aria-label="Credentials">
              <h3 className="text-eyebrow">Credentials</h3>
              {manifest.credentials.map((slot) => {
                const options = definition.secrets.filter(
                  (x) => slot.types.length === 0 || slot.types.includes(x.credentialType),
                );
                return (
                  <FieldRow key={slot.name}>
                    <Label>{slot.name}</Label>
                    <Select
                      value={node.credentials[slot.name] ?? ""}
                      disabled={readOnly}
                      aria-label={slot.name}
                      placeholder={
                        options.length ? "Choose a secret" : "Declare a secret in workflow settings"
                      }
                      onValueChange={(v) =>
                        s.updateNode(
                          node.id,
                          (n) => {
                            if (n.kind === "task") n.credentials[slot.name] = v;
                          },
                          "Bind credential",
                        )
                      }
                    >
                      {options.map((x) => (
                        <SelectItem key={x.name} value={x.name}>
                          {x.name}
                        </SelectItem>
                      ))}
                    </Select>
                  </FieldRow>
                );
              })}
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
          <BindingField
            label="Value"
            value={node.value}
            scope={scope}
            disabled={readOnly}
            onChange={(v) =>
              s.setBinding(node.id, "value", toBinding(v) ?? { kind: "literal", value: null })
            }
          />
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
          </FieldRow>
          <div className="flex items-center justify-between">
            <Label htmlFor={`early-${node.id}`}>End the run early</Label>
            <Switch
              id={`early-${node.id}`}
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
        <BranchEditor key={`${node.id}:${epoch}`} node={node} store={store} readOnly={readOnly} />
      ) : null}
      {node.kind === "human" ? (
        <HumanEditor
          key={`${node.id}:${epoch}`}
          node={node}
          store={store}
          scope={scope}
          readOnly={readOnly}
        />
      ) : null}

      <Collapsible title="Execution policy" defaultOpen={false}>
        <JsonField
          label="Policy"
          value={node.policy ?? {}}
          readOnly={readOnly}
          onValid={(v) =>
            s.setNodePolicy(node.id, Object.keys(v as object).length ? (v as never) : undefined)
          }
          hint="timeoutMs, retry { maxAttempts, backoff }, onError (fail | route | ignore), maxCostUsd, maxTokens, privacy."
        />
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

function BranchEditor({
  node,
  store,
  readOnly,
}: {
  node: Extract<WorkflowNode, { kind: "branch" }>;
  store: BuilderStore;
  readOnly?: boolean | undefined;
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
              className="w-28 font-mono"
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
          <Input
            aria-label="When"
            className="font-mono"
            defaultValue={c.when}
            disabled={readOnly}
            onBlur={(e) =>
              s.updateNode(
                node.id,
                (n) => {
                  if (n.kind === "branch" && n.cases[i]) n.cases[i].when = e.target.value || "true";
                },
                "Edit condition",
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

function HumanEditor({
  node,
  store,
  scope,
  readOnly,
}: {
  node: Extract<WorkflowNode, { kind: "human" }>;
  store: BuilderStore;
  scope: ExpressionScope;
  readOnly?: boolean | undefined;
}) {
  const s = store.getState();
  return (
    <section className="flex flex-col gap-3" aria-label="Review">
      <BindingField
        label="Title"
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
