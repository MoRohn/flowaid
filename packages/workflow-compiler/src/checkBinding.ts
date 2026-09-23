/**
 * `checkBinding()` — the canvas's single-binding check (ARCHITECTURE.md §4, `isValidConnection`
 * and inspector edits). It compiles the definition with one input binding replaced, so it can
 * never disagree with `compile()`, and returns only the diagnostics about that binding together
 * with the schema the binding would have.
 */
import {
  WorkflowDefinitionSchema,
  type Binding,
  type Diagnostic,
  type JsonSchema,
} from "@flowaid/workflow-core";
import { compile, type CompileInput } from "./compile.js";
import { escapePointerToken } from "@flowaid/workflow-core";

export interface BindingCheck {
  ok: boolean;
  diagnostics: Diagnostic[];
  /** The compiled binding's schema when the definition compiled. */
  schema?: JsonSchema;
}

export function checkBinding(
  definition: unknown,
  target: { node: string; port: string },
  binding: Binding,
  options: CompileInput,
): BindingCheck {
  const parsed = WorkflowDefinitionSchema.safeParse(definition);
  if (!parsed.success) return { ok: false, diagnostics: compile(definition, options).diagnostics };
  const doc = JSON.parse(JSON.stringify(parsed.data)) as {
    nodes: { id: string; kind: string; inputs?: Record<string, unknown> }[];
  };
  const index = doc.nodes.findIndex((n) => n.id === target.node);
  const node = doc.nodes[index];
  if (!node || !(node.kind === "task" || node.kind === "join" || node.kind === "subflow")) {
    return {
      ok: false,
      diagnostics: [
        {
          code: "E_REF_UNKNOWN_NODE",
          severity: "error",
          message: `No node '${target.node}' with bindable inputs`,
          location: { nodeId: target.node },
        },
      ],
    };
  }
  node.inputs = { ...(node.inputs ?? {}), [target.port]: binding };
  const result = compile(doc, options);
  const prefix = `/nodes/${index}/inputs/${escapePointerToken(target.port)}`;
  const mine = result.diagnostics.filter(
    (d) =>
      d.location.nodeId === target.node &&
      (d.location.port === target.port ||
        d.location.path === prefix ||
        d.location.path?.startsWith(`${prefix}/`) === true),
  );
  const plan = result.ok ? result.plan : undefined;
  const planNode = plan?.nodes[target.node];
  const op = planNode?.op;
  const compiled =
    op && (op.kind === "task" || op.kind === "join" || op.kind === "subflow")
      ? op.inputs[target.port]
      : undefined;
  return {
    ok: !mine.some((d) => d.severity === "error"),
    diagnostics: mine,
    ...(compiled ? { schema: compiled.schema } : {}),
  };
}
