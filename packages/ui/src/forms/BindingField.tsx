import { useId, useMemo, useState, type ReactNode } from "react";
import {
  formatRef,
  parseExpression,
  parseRef,
  parseTemplate,
  type Binding,
} from "@flowaid/workflow-core";
import type { ExpressionScope } from "@/types";
import { FieldHint, Input, ToggleGroup, ToggleGroupItem } from "@/primitives";
import { CodeEditor } from "./CodeEditor";
import { ExpressionInput } from "./ExpressionInput";
import {
  BINDING_MODES,
  bindingModeOf,
  isBinding,
  literalFieldValue,
  literalOf,
  type BindingMode,
} from "./schema";

const MODE_LABEL: Record<BindingMode, string> = {
  literal: "Literal",
  ref: "Ref",
  template: "Template",
  expr: "Expr",
};

export interface BindingFieldProps {
  /** The field value: a literal, `{ kind: 'literal' }`, or a ref / template / expr `Binding`. */
  value: unknown;
  /** Receives the literal (wrapped only when it would read as a binding, or always with `alwaysBinding`) or the `Binding`. */
  onChange: (value: unknown) => void;
  onBlur?: () => void;
  /** Field label; names the mode switch ("<label> source"). */
  label: string;
  /** The literal editor: the field's own widget. Defaults to a JSON editor. */
  renderLiteral?: (literal: unknown, onLiteralChange: (value: unknown) => void) => ReactNode;
  /** `x-ui.widget: 'binding'`: literals are stored as `{ kind: 'literal', value }` too. */
  alwaysBinding?: boolean;
  /** Upstream references for the template editor and the ref suggestions. */
  scope?: ExpressionScope;
  modes?: readonly BindingMode[];
  disabled?: boolean;
  invalid?: boolean;
}

/** Problem with a ref / template / expr binding source, or null when it parses. */
export function bindingProblem(binding: Binding): string | null {
  switch (binding.kind) {
    case "template": {
      const parsed = parseTemplate(binding.source);
      return parsed.ok ? null : parsed.message;
    }
    case "expr": {
      if (binding.source.trim() === "") return "Enter an expression";
      const parsed = parseExpression(binding.source);
      return parsed.ok ? null : parsed.message;
    }
    case "ref":
    case "literal":
    case "object":
    case "array":
      return null;
    default:
      return null;
  }
}

function exprSeed(literal: unknown): string {
  if (typeof literal === "number" || typeof literal === "boolean") return String(literal);
  if (typeof literal === "string" && literal !== "") return JSON.stringify(literal);
  return "";
}

/** Canonical compact refs offered as suggestions: upstream node ports and workflow variables. */
function refSuggestions(scope: ExpressionScope | undefined): string[] {
  if (!scope) return [];
  const out: string[] = [];
  for (const node of scope.nodes)
    for (const port of node.outputs) out.push(`${node.id}.${port.id}`);
  for (const v of scope.variables) out.push(`$vars.${v.name}`);
  return out;
}

const EMPTY_SCOPE_VALUE: ExpressionScope = { inputs: [], variables: [], nodes: [] };

/**
 * `x-ui.bindable` field: a Literal ⇄ Ref / Template / Expr switch over the
 * field's own widget. Literal mode stores the plain value (the compiler reads
 * it as a literal); the other modes store a `Binding` (`{ kind: 'ref', ref }`,
 * `{ kind: 'template', source }`, `{ kind: 'expr', source }`) that the
 * compiler moves into `configBindings` and resolves before `execute()`.
 * An incomplete ref or an empty expression stores `null` (react-hook-form
 * would read `undefined` as "back to the default") until it parses.
 */
export function BindingField({
  value,
  onChange,
  onBlur,
  label,
  renderLiteral,
  alwaysBinding = false,
  scope,
  modes = BINDING_MODES,
  disabled,
  invalid,
}: BindingFieldProps) {
  const switchId = useId();
  const listId = useId();
  const [mode, setMode] = useState<BindingMode>(() => bindingModeOf(value));
  const [literal, setLiteral] = useState<unknown>(() => literalOf(value));
  const [refDraft, setRefDraft] = useState(() =>
    isBinding(value) && value.kind === "ref" ? formatRef(value.ref) : "",
  );
  const [templateDraft, setTemplateDraft] = useState(() =>
    isBinding(value) && value.kind === "template"
      ? value.source
      : typeof literalOf(value) === "string"
        ? String(literalOf(value))
        : "",
  );
  const [exprDraft, setExprDraft] = useState(() =>
    isBinding(value) && value.kind === "expr" ? value.source : "",
  );
  const [lastEmitted, setLastEmitted] = useState<unknown>(value);
  const suggestions = useMemo(() => refSuggestions(scope), [scope]);

  // Adopt values written from outside (reset, undo) that this field did not emit.
  if (value !== lastEmitted) {
    setLastEmitted(value);
    const nextMode = bindingModeOf(value);
    setMode(nextMode);
    if (nextMode === "literal") setLiteral(literalOf(value));
    if (isBinding(value)) {
      if (value.kind === "ref") setRefDraft(formatRef(value.ref));
      if (value.kind === "template") setTemplateDraft(value.source);
      if (value.kind === "expr") setExprDraft(value.source);
    }
  }

  const emit = (next: unknown) => {
    setLastEmitted(next);
    onChange(next);
  };
  const emitLiteral = (next: unknown) => {
    setLiteral(next);
    emit(
      alwaysBinding
        ? next === undefined
          ? null
          : { kind: "literal", value: next }
        : literalFieldValue(next),
    );
  };
  const emitRef = (text: string) => {
    setRefDraft(text);
    const parsed = parseRef(text.trim());
    emit(parsed.ok ? { kind: "ref", ref: parsed.ref } : null);
  };
  const emitTemplate = (source: string) => {
    setTemplateDraft(source);
    emit({ kind: "template", source });
  };
  const emitExpr = (source: string) => {
    setExprDraft(source);
    emit(source.trim() === "" ? null : { kind: "expr", source });
  };

  const switchTo = (next: BindingMode) => {
    if (next === mode) return;
    setMode(next);
    switch (next) {
      case "literal":
        emitLiteral(literal);
        break;
      case "ref":
        emitRef(refDraft);
        break;
      case "template":
        emitTemplate(
          templateDraft !== "" ? templateDraft : typeof literal === "string" ? literal : "",
        );
        break;
      case "expr":
        emitExpr(exprDraft !== "" ? exprDraft : exprSeed(literal));
        break;
    }
  };

  const refParse = refDraft.trim() === "" ? null : parseRef(refDraft.trim());
  const exprParse = exprDraft.trim() === "" ? null : parseExpression(exprDraft);

  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-binding-mode={mode}>
      <ToggleGroup
        id={switchId}
        type="single"
        size="sm"
        value={mode}
        onValueChange={(v) => {
          const next = modes.find((m) => m === v);
          if (next) switchTo(next);
        }}
        disabled={disabled}
        aria-label={`${label} source`}
      >
        {modes.map((m) => (
          <ToggleGroupItem key={m} value={m}>
            {MODE_LABEL[m]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {mode === "literal" ? (
        renderLiteral ? (
          renderLiteral(literal, emitLiteral)
        ) : (
          <CodeEditor
            aria-label={`${label} literal`}
            language="json"
            value={literal === undefined ? "" : JSON.stringify(literal, null, 2)}
            onChange={(text) => {
              if (text.trim() === "") {
                emitLiteral(undefined);
                return;
              }
              try {
                const parsed: unknown = JSON.parse(text);
                emitLiteral(parsed);
              } catch {
                // Keep the last parsed literal while the JSON is incomplete.
              }
            }}
            disabled={disabled}
            minRows={3}
          />
        )
      ) : null}
      {mode === "ref" ? (
        <>
          <Input
            aria-label={`${label} reference`}
            mono
            value={refDraft}
            onChange={(e) => emitRef(e.target.value)}
            onBlur={onBlur}
            placeholder="intent.decision.value"
            list={suggestions.length > 0 ? listId : undefined}
            invalid={invalid || (refParse !== null && !refParse.ok)}
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
          />
          {suggestions.length > 0 ? (
            <datalist id={listId}>
              {suggestions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          ) : null}
          <FieldHint>
            {refParse && !refParse.ok
              ? refParse.message
              : "node.port[.path], $vars.name, $scope.item or $run.id"}
          </FieldHint>
        </>
      ) : null}
      {mode === "template" ? (
        <ExpressionInput
          aria-label={`${label} template`}
          scope={scope ?? EMPTY_SCOPE_VALUE}
          value={templateDraft}
          onChange={emitTemplate}
          disabled={disabled}
          invalid={invalid}
        />
      ) : null}
      {mode === "expr" ? (
        <>
          <Input
            aria-label={`${label} expression`}
            mono
            value={exprDraft}
            onChange={(e) => emitExpr(e.target.value)}
            onBlur={onBlur}
            placeholder="intent.decision.confidence >= 0.8"
            invalid={invalid || (exprParse !== null && !exprParse.ok)}
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
          />
          <FieldHint>
            {exprParse && !exprParse.ok
              ? exprParse.message
              : "FlowExpr, evaluated before the node runs"}
          </FieldHint>
        </>
      ) : null}
    </div>
  );
}
