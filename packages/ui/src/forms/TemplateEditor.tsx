import type { Diagnostic, JsonSchema, Ref } from "@flowaid/workflow-core";
import type { ExpressionScope } from "@/types";
import {
  ExpressionInputFallback,
  ExpressionTextareaFallback,
  type ExpressionEditorHandle,
  type ExpressionInputProps,
  type ExpressionTextareaProps,
} from "./ExpressionInput";
import { lazyEditor } from "./lazyEditor";

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
 * The `template` widget: a multi-line template editor over FlowExpr with completion after `{{`,
 * compiler diagnostics underlined at their range and a footer with the reference count and
 * issues. CodeMirror loads on demand (TemplateEditorView.tsx is the implementation).
 */
export const TemplateEditor = lazyEditor<TemplateEditorProps, ExpressionEditorHandle>(
  "TemplateEditor",
  () => import("./TemplateEditorView").then((m) => m.TemplateEditorView),
  (props) => <ExpressionTextareaFallback {...props} />,
);

/** Single-line template field in the compiler's grammar; loads CodeMirror on demand. */
export const TemplateInput = lazyEditor<TemplateInputProps, ExpressionEditorHandle>(
  "TemplateInput",
  () => import("./TemplateEditorView").then((m) => m.TemplateInputView),
  (props) => <ExpressionInputFallback className={props.className} />,
);
