/**
 * Checks template text in the compiler's grammar (`{{ node.port }}`, `$vars.x`, `$scope.item`,
 * `$run.id`, FlowExpr inside the holes) against the references the field may use. The editor
 * shows the result: a reference count, underlines on holes whose references do not exist, and the
 * parse error, if any. The compiler still has the last word (it also knows which steps run
 * before this one), so unknown references are warnings, not errors.
 */
import { collectRefs, formatRef, parseTemplate, type Ref } from "@flowaid/workflow-core";
import type { ExpressionScope } from "@/types";
import type { EditorDiagnostic } from "./expressionExtensions";
import type { TemplateRef } from "./TemplateEditor";

export interface TemplateCheck {
  /** Distinct references the template reads, in compact form (`start.message`), first use first. */
  references: string[];
  /** Underlines: the parse error, and holes that read a reference this field cannot use. */
  diagnostics: EditorDiagnostic[];
  /** The parse error in words, when the text does not parse. */
  error: string | null;
}

/** The references a field may use, from the builder's scope: every other node's output ports. */
export function templateRefsFromScope(scope: ExpressionScope): TemplateRef[] {
  return scope.nodes.flatMap((n) =>
    n.outputs.map((p) => ({
      ref: { kind: "port" as const, node: n.id, port: p.id },
      schema: p.schema ?? {},
    })),
  );
}

/** Why `ref` cannot be read here, or null when it can. */
function refProblem(
  ref: Ref,
  ports: ReadonlyMap<string, ReadonlySet<string>>,
  variables: ReadonlySet<string>,
  inContainer: boolean,
): string | null {
  switch (ref.kind) {
    case "port": {
      const outputs = ports.get(ref.node);
      // the older reference forms read naturally but do not compile
      if (!outputs && ref.node === "input" && ports.has("start"))
        return `Write start.${ref.port} to read the run input.`;
      if (!outputs && ref.node === "variables") return `Write $vars.${ref.port} to read a setting.`;
      if (!outputs && ref.node === "nodes")
        return "Write <step id>.<output> instead, without nodes. in front.";
      if (!outputs) return `There is no step with the id “${ref.node}” to read from.`;
      if (!outputs.has(ref.port))
        return `Step “${ref.node}” has no output “${ref.port}”. It has: ${[...outputs].join(", ")}.`;
      return null;
    }
    case "var":
      return variables.has(ref.name)
        ? null
        : `There is no workflow setting called “${ref.name}”. Add it under Settings in the workflow panel.`;
    case "scope":
      return inContainer ? null : `$scope.${ref.field} only works inside a loop or for-each.`;
    case "run":
      return null;
  }
}

function sentence(message: string): string {
  const text = message.charAt(0).toUpperCase() + message.slice(1);
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

export function checkTemplate(
  source: string,
  refs: readonly TemplateRef[],
  variables: readonly string[],
  inContainer: boolean,
): TemplateCheck {
  const parsed = parseTemplate(source);
  if (!parsed.ok) {
    const from = Math.max(0, Math.min(parsed.offset, source.length - 1));
    const error = sentence(parsed.message);
    return {
      references: [],
      diagnostics: [{ from, to: from + 1, severity: "error", message: error }],
      error,
    };
  }
  const ports = new Map<string, Set<string>>();
  for (const r of refs) {
    if (r.ref.kind !== "port") continue;
    const set = ports.get(r.ref.node) ?? new Set<string>();
    set.add(r.ref.port);
    ports.set(r.ref.node, set);
  }
  const vars = new Set(variables);
  const references: string[] = [];
  const diagnostics: EditorDiagnostic[] = [];
  for (const part of parsed.template.parts) {
    if (part.kind !== "hole") continue;
    for (const ref of collectRefs(part.expr)) {
      const text = formatRef(ref);
      if (!references.includes(text)) references.push(text);
      const problem = refProblem(ref, ports, vars, inContainer);
      if (problem)
        diagnostics.push({
          from: part.range.start,
          to: part.range.end,
          severity: "warning",
          message: problem,
        });
    }
  }
  return { references, diagnostics, error: null };
}
