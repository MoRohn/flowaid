/**
 * The `template` widget: a multi-line template editor over FlowExpr (UI.md §5, P1-07).
 *
 * - Completion after `{{` and inside holes: the node ports in `refs` (`node.port`), `$vars.*`,
 *   `$scope.item|index|iteration|carry`, `$run.*` and every FlowExpr function with its arity.
 * - Compiler diagnostics that carry `location.range` are underlined at that range, with the
 *   message on hover and the first error under the field.
 * - `checkTemplate` counts the references and underlines holes whose step, output or setting
 *   does not exist; the footer shows the count, the issues and any parse error.
 *
 * `TemplateInput` is the single-line form of the same editor.
 */
import { forwardRef, useCallback, useMemo, useState } from "react";
import {
  insertCompletionText,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import {
  EXPRESSION_FUNCTION_NAMES,
  FUNCTION_SIGNATURES,
  RunFieldSchema,
  ScopeFieldSchema,
  type Diagnostic,
  type JsonSchema,
  type Ref,
} from "@flowaid/workflow-core";
import type { ExpressionScope } from "@/types";
import { findExpressionRegions } from "./expression";
import {
  ExpressionInput,
  ExpressionTextarea,
  type ExpressionEditorHandle,
  type ExpressionInputProps,
  type ExpressionTextareaProps,
  type TemplateStatus,
} from "./ExpressionInput";
import { checkTemplate } from "./templateCheck";
import {
  EMPTY_SCOPE,
  externalDiagnostics,
  extraCompletionSource,
  scopeReferences,
  type EditorDiagnostic,
} from "./expressionExtensions";

const NO_REFS: readonly TemplateRef[] = [];

/** A reference the template may use, with the schema of the value it points at. */
export interface TemplateRef {
  ref: Ref;
  schema: JsonSchema;
}

export interface TemplateEditorProps extends Omit<ExpressionTextareaProps, "scope" | "extensions"> {
  /** Upstream values the holes may reference. */
  refs?: readonly TemplateRef[];
  /** Workflow variables (`$vars.<name>`). */
  variables?: readonly string[];
  /** Offer `$scope.*` (the field is inside a loop or foreach body). */
  inContainer?: boolean;
  /** Compiler diagnostics for this template; those with `location.range` are underlined. */
  diagnostics?: readonly Diagnostic[];
  /** Legacy scope-based checking, used when `refs` is not given. */
  scope?: ExpressionScope;
}

function schemaLabel(schema: JsonSchema): string {
  const s = schema as { type?: unknown; enum?: unknown[] };
  if (Array.isArray(s.enum)) return "enum";
  if (Array.isArray(s.type)) return s.type.join(" | ");
  return typeof s.type === "string" ? s.type : "any";
}

function arity(name: (typeof EXPRESSION_FUNCTION_NAMES)[number]): string {
  const sig = FUNCTION_SIGNATURES[name];
  if (sig.minArgs === sig.maxArgs) return `${sig.minArgs} arg${sig.minArgs === 1 ? "" : "s"}`;
  return Number.isFinite(sig.maxArgs)
    ? `${sig.minArgs}–${sig.maxArgs} args`
    : `${sig.minArgs}+ args`;
}

const TOKEN = /[$A-Za-z_][\w$]*(?:\.[\w$]*)*$/;

/** The completion candidates for the text before the caret inside a hole. */
export function templateCompletions(
  before: string,
  refs: readonly TemplateRef[],
  variables: readonly string[],
  inContainer: boolean,
): { from: number; options: Completion[] } | null {
  const match = TOKEN.exec(before);
  const token = match?.[0] ?? "";
  const from = before.length - token.length + (token.lastIndexOf(".") + 1);
  const dot = token.lastIndexOf(".");
  const head = dot < 0 ? "" : token.slice(0, dot);
  const field = (label: string, detail: string, type = "property"): Completion => ({
    label,
    detail,
    type,
  });

  if (head === "$vars")
    return { from, options: variables.map((v) => field(v, "variable", "variable")) };
  if (head === "$scope") {
    if (!inContainer) return null;
    return {
      from,
      options: ScopeFieldSchema.options.map((f) =>
        field(f, f === "item" || f === "index" ? "foreach" : "loop"),
      ),
    };
  }
  if (head === "$run") return { from, options: RunFieldSchema.options.map((f) => field(f, "run")) };
  if (head !== "") {
    // `node.` → that node's ports.
    const ports = refs.flatMap((r) =>
      r.ref.kind === "port" && r.ref.node === head && !r.ref.path
        ? [field(r.ref.port, schemaLabel(r.schema), "output")]
        : [],
    );
    return ports.length > 0 ? { from, options: ports } : null;
  }

  const nodes = [...new Set(refs.flatMap((r) => (r.ref.kind === "port" ? [r.ref.node] : [])))];
  const continueWithDot = (label: string, detail: string, type: string): Completion => ({
    label,
    detail,
    type,
    apply: (view, _c, f, t) => view.dispatch(insertCompletionText(view.state, `${label}.`, f, t)),
  });
  const options: Completion[] = [
    ...nodes.map((n) => continueWithDot(n, "node", "node")),
    ...(variables.length > 0 ? [continueWithDot("$vars", "workflow variables", "keyword")] : []),
    ...(inContainer ? [continueWithDot("$scope", "loop / foreach", "keyword")] : []),
    continueWithDot("$run", "run metadata", "keyword"),
    ...EXPRESSION_FUNCTION_NAMES.map((fn): Completion => ({
      label: fn,
      detail: arity(fn),
      type: "function",
      apply: (view, _c, f, t) => {
        view.dispatch(insertCompletionText(view.state, `${fn}()`, f, t));
        view.dispatch({ selection: { anchor: view.state.selection.main.head - 1 } });
      },
    })),
  ];
  return { from, options };
}

/** CodeMirror source for `templateCompletions` (only inside `{{ … }}`). */
function source(refs: readonly TemplateRef[], variables: readonly string[], inContainer: boolean) {
  return (context: CompletionContext): CompletionResult | null => {
    const text = context.state.doc.toString();
    const region = findExpressionRegions(text).find(
      (r) => context.pos >= r.innerFrom && context.pos <= r.innerTo,
    );
    if (!region) return null;
    const before = text.slice(region.innerFrom, context.pos);
    if (!context.explicit && !/[\w$.]$/.test(before) && before.trim() !== "") return null;
    const found = templateCompletions(before, refs, variables, inContainer);
    if (!found || found.options.length === 0) return null;
    return { from: region.innerFrom + found.from, options: found.options, validFor: /^[\w$]*$/ };
  };
}

/** Compiler diagnostics with a character range, as editor underlines. */
export function rangedDiagnostics(diagnostics: readonly Diagnostic[] = []): EditorDiagnostic[] {
  return diagnostics.flatMap((d) =>
    d.location.range
      ? [
          {
            from: d.location.range.start,
            to: Math.max(d.location.range.end, d.location.range.start + 1),
            severity: d.severity,
            message: d.message,
          },
        ]
      : [],
  );
}

interface TemplateAssistOptions {
  refs: readonly TemplateRef[];
  variables: readonly string[];
  inContainer: boolean;
  diagnostics?: readonly Diagnostic[] | undefined;
}

/**
 * Completion, underlines and the footer status for template text in the compiler's grammar:
 * the compiler diagnostics that carry a range plus `checkTemplate`'s own findings.
 */
export function useTemplateAssist(
  text: string,
  { refs, variables, inContainer, diagnostics }: TemplateAssistOptions,
): { extensions: Extension; status: TemplateStatus } {
  const check = useMemo(
    () => checkTemplate(text, refs, variables, inContainer),
    [text, refs, variables, inContainer],
  );
  const marks = useMemo(
    () => [...rangedDiagnostics(diagnostics), ...check.diagnostics],
    [diagnostics, check.diagnostics],
  );
  const extensions = useMemo<Extension>(
    () => [
      scopeReferences.of(false),
      externalDiagnostics.of(marks),
      extraCompletionSource.of(source(refs, variables, inContainer)),
    ],
    [refs, variables, inContainer, marks],
  );
  const status = useMemo<TemplateStatus>(
    () => ({
      references: check.references.length,
      issues: check.diagnostics.filter((d) => d.severity !== "error").length,
      error: check.error,
    }),
    [check],
  );
  return { extensions, status };
}

/** Keeps the text a controlled-or-uncontrolled editor currently shows, for the checks above. */
function useCurrentText(
  value: string | undefined,
  defaultValue: string | undefined,
  onChange: ((value: string) => void) | undefined,
): [string, (value: string) => void] {
  const [own, setOwn] = useState(defaultValue ?? "");
  const change = useCallback(
    (next: string) => {
      setOwn(next);
      onChange?.(next);
    },
    [onChange],
  );
  return [value ?? own, change];
}

const NO_VARIABLES: readonly string[] = [];

function examplePlaceholder(refs: readonly TemplateRef[], lead: string): string {
  // the example names a reference this field can really use (the legacy default does not compile)
  const example = refs.find((r) => r.ref.kind === "port");
  return `${lead}${
    example?.ref.kind === "port"
      ? `, for example {{ ${example.ref.node}.${example.ref.port} }}`
      : ""
  }.`;
}

export const TemplateEditor = forwardRef<ExpressionEditorHandle, TemplateEditorProps>(
  function TemplateEditor(
    {
      refs,
      variables = NO_VARIABLES,
      inContainer = false,
      diagnostics,
      scope,
      className,
      value,
      defaultValue,
      onChange,
      ...props
    },
    ref,
  ) {
    const useRefs = refs !== undefined;
    const [text, change] = useCurrentText(value, defaultValue, onChange);
    const assist = useTemplateAssist(text, {
      refs: refs ?? NO_REFS,
      variables,
      inContainer,
      diagnostics,
    });
    const legacyMarks = useMemo(() => rangedDiagnostics(diagnostics), [diagnostics]);
    const legacyExtensions = useMemo<Extension>(
      () => [externalDiagnostics.of(legacyMarks)],
      [legacyMarks],
    );
    const firstError = diagnostics?.find((d) => d.severity === "error");
    const placeholder =
      props.placeholder ??
      (useRefs && refs
        ? examplePlaceholder(refs, "Write the text. Type {{ to insert a value")
        : undefined);
    return (
      <div className={className} data-widget="template">
        <ExpressionTextarea
          ref={ref}
          {...props}
          {...(value !== undefined ? { value } : {})}
          {...(defaultValue !== undefined ? { defaultValue } : {})}
          onChange={change}
          {...(placeholder !== undefined ? { placeholder } : {})}
          scope={scope ?? EMPTY_SCOPE}
          referencePicker={props.referencePicker ?? !useRefs}
          invalid={props.invalid === true || firstError !== undefined}
          extensions={useRefs ? assist.extensions : legacyExtensions}
          {...(useRefs ? { status: assist.status } : {})}
        />
        {firstError ? (
          <p className="mt-1 text-xs text-danger-text" role="alert">
            {firstError.message}
          </p>
        ) : null}
      </div>
    );
  },
);

export interface TemplateInputProps extends Omit<
  ExpressionInputProps,
  "scope" | "extensions" | "status" | "referencePicker"
> {
  /** Upstream values the holes may reference. */
  refs: readonly TemplateRef[];
  variables?: readonly string[];
  inContainer?: boolean;
  diagnostics?: readonly Diagnostic[];
}

/**
 * Single-line template field in the compiler's grammar: the same completion, underlines and
 * checks as `TemplateEditor`, on one line.
 */
export const TemplateInput = forwardRef<ExpressionEditorHandle, TemplateInputProps>(
  function TemplateInput(
    {
      refs,
      variables = NO_VARIABLES,
      inContainer = false,
      diagnostics,
      value,
      defaultValue,
      onChange,
      ...props
    },
    ref,
  ) {
    const [text, change] = useCurrentText(value, defaultValue, onChange);
    const assist = useTemplateAssist(text, { refs, variables, inContainer, diagnostics });
    return (
      <ExpressionInput
        ref={ref}
        {...props}
        {...(value !== undefined ? { value } : {})}
        {...(defaultValue !== undefined ? { defaultValue } : {})}
        onChange={change}
        placeholder={
          props.placeholder ?? examplePlaceholder(refs, "Text, with {{ to insert a value")
        }
        scope={EMPTY_SCOPE}
        referencePicker={false}
        extensions={assist.extensions}
        status={assist.status}
      />
    );
  },
);
