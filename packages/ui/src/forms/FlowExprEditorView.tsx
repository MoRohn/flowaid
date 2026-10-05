/**
 * The FlowExpr editor itself (CodeMirror), loaded on demand by `FlowExprEditor`: the whole text
 * is one FlowExpr expression, so references complete anywhere in it, not only inside `{{ … }}`
 * (`boolean_1.` offers that step's outputs, `$vars.` the settings, `$scope.` the loop fields,
 * and every function with its arity), and references the step cannot read are underlined with
 * what to write instead, with the parse error under the field (`checkExpression`).
 */
import { forwardRef, useCallback, useMemo, useState } from "react";
import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import type { Diagnostic } from "@flowaid/workflow-core";
import type {
  ExpressionEditorHandle,
  ExpressionTextareaProps,
  TemplateStatus,
} from "./ExpressionInput";
import { ExpressionTextareaView as ExpressionTextarea } from "./ExpressionInputView";
import {
  EMPTY_SCOPE,
  externalDiagnostics,
  extraCompletionSource,
  scopeReferences,
} from "./expressionExtensions";
import { checkExpression } from "./templateCheck";
import type { TemplateRef } from "./TemplateEditor";
import { rangedDiagnostics, templateCompletions } from "./TemplateEditorView";

const NO_VARIABLES: readonly string[] = [];

export interface FlowExprEditorProps extends Omit<
  ExpressionTextareaProps,
  "scope" | "extensions" | "status" | "referencePicker"
> {
  /** The step outputs the expression may read (`node.port`). */
  refs: readonly TemplateRef[];
  /** Workflow settings (`$vars.<name>`). */
  variables?: readonly string[];
  /** Offer `$scope.*` (the step is inside a loop or for-each body). */
  inContainer?: boolean;
  /** Compiler diagnostics for this field; those with `location.range` are underlined. */
  diagnostics?: readonly Diagnostic[];
}

/**
 * The completions for the expression text before the caret: the step outputs, settings, loop
 * fields and functions, as in a template's holes; none inside a string literal.
 */
export function flowExprCompletions(
  before: string,
  refs: readonly TemplateRef[],
  variables: readonly string[],
  inContainer: boolean,
): ReturnType<typeof templateCompletions> {
  if (insideString(before)) return null;
  const found = templateCompletions(before, refs, variables, inContainer);
  return found && found.options.length > 0 ? found : null;
}

/** Completion anywhere in the text, in the compiler's grammar. */
function flowExprSource(
  refs: readonly TemplateRef[],
  variables: readonly string[],
  inContainer: boolean,
) {
  return (context: CompletionContext): CompletionResult | null => {
    const before = context.state.doc.sliceString(0, context.pos);
    // open while a name or a path is being typed (or on request), not after every space or quote
    if (!context.explicit && !/[\w$.]$/.test(before)) return null;
    const found = flowExprCompletions(before, refs, variables, inContainer);
    return found ? { from: found.from, options: found.options, validFor: /^[\w$]*$/ } : null;
  };
}

/** Whether the caret sits inside a string literal (an odd number of unescaped quotes before it). */
function insideString(before: string): boolean {
  let quote: string | null = null;
  for (let i = 0; i < before.length; i += 1) {
    const c = before[i];
    if (c === "\\") {
      i += 1;
      continue;
    }
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
  }
  return quote !== null;
}

export const FlowExprEditorView = forwardRef<ExpressionEditorHandle, FlowExprEditorProps>(
  function FlowExprEditorView(
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
    const [own, setOwn] = useState(defaultValue ?? "");
    const text = value ?? own;
    const change = useCallback(
      (next: string) => {
        setOwn(next);
        onChange?.(next);
      },
      [onChange],
    );
    const check = useMemo(
      () => checkExpression(text, refs, variables, inContainer),
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
        extraCompletionSource.of(flowExprSource(refs, variables, inContainer)),
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
    const example = refs.find((r) => r.ref.kind === "port")?.ref;
    return (
      <ExpressionTextarea
        ref={ref}
        minRows={2}
        maxRows={12}
        {...props}
        {...(value !== undefined ? { value } : {})}
        {...(defaultValue !== undefined ? { defaultValue } : {})}
        onChange={change}
        placeholder={
          props.placeholder ??
          (example?.kind === "port"
            ? `An expression, for example ${example.node}.${example.port}`
            : "An expression")
        }
        scope={EMPTY_SCOPE}
        referencePicker={false}
        extensions={extensions}
        status={status}
      />
    );
  },
);
