import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { cn } from "@/lib/cn";
import type { ExpressionScope } from "@/types";
import type { ExpressionValidation } from "./expression";
import { lazyEditor, rowsHeight } from "./lazyEditor";

export interface ExpressionEditorHandle {
  focus: () => void;
  /** Inserts text at the caret (replacing the selection). */
  insert: (text: string) => void;
  /** The CodeMirror view, once the editor has loaded. */
  view: EditorView | null;
}

export interface ExpressionInputProps {
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** Upstream references available to the expression. */
  scope: ExpressionScope;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  invalid?: boolean;
  id?: string;
  className?: string;
  /** Fired after every change with the parsed references and issues. */
  onValidate?: (result: ExpressionValidation) => void;
  /** Show the "Insert reference" button. */
  referencePicker?: boolean;
  /** Render the first validation error under the field. */
  showMessage?: boolean;
  /** Enter (without an open completion) submits, e.g. to close an inline editor. */
  onSubmit?: () => void;
  /** Extra CodeMirror extensions (completion sources, external diagnostics). */
  extensions?: Extension;
  /**
   * The field's own check, replacing the built-in `input.*` / `nodes.*` / `variables.*` scan
   * (TemplateEditor and TemplateInput check the compiler's `node.port` grammar).
   */
  status?: TemplateStatus;
  "aria-label"?: string;
  "aria-describedby"?: string;
}

/** What a template editor's own check found: shown in the footer and under the field. */
export interface TemplateStatus {
  references: number;
  /** Problems underlined in the text (unknown references). */
  issues: number;
  /** The parse error, when the text does not parse. */
  error: string | null;
}

export interface ExpressionTextareaProps extends Omit<ExpressionInputProps, "onSubmit"> {
  /** Initial visible height in lines. */
  minRows?: number;
  maxRows?: number;
}

/** A single-line field's place while CodeMirror loads: the input's border and height. */
export function ExpressionInputFallback({ className }: { className?: string | undefined }) {
  return (
    <div aria-busy="true" className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <div className="min-h-7 w-full rounded-sm border border-border bg-surface" />
    </div>
  );
}

/** A multi-line field's place while CodeMirror loads: its lines and its footer. */
export function ExpressionTextareaFallback({
  value,
  defaultValue,
  minRows = 4,
  maxRows = 16,
  className,
}: Pick<ExpressionTextareaProps, "value" | "defaultValue" | "minRows" | "maxRows" | "className">) {
  return (
    <div aria-busy="true" className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <div className="flex w-full min-w-0 flex-col overflow-hidden rounded-sm border border-border bg-surface">
        <div style={{ height: rowsHeight(value ?? defaultValue, minRows, maxRows) }} />
        <div className="h-7 shrink-0 border-t border-border bg-surface-2" />
      </div>
    </div>
  );
}

/**
 * Single-line template expression editor: `{{ … }}` regions render as accent
 * chips, references autocomplete from the scope, and unknown references are
 * underlined with a message. Enter submits; the caret never leaves one line.
 * CodeMirror loads on demand (ExpressionInputView.tsx is the implementation).
 */
export const ExpressionInput = lazyEditor<ExpressionInputProps, ExpressionEditorHandle>(
  "ExpressionInput",
  () => import("./ExpressionInputView").then((m) => m.ExpressionInputView),
  (props) => <ExpressionInputFallback className={props.className} />,
);

/**
 * Multi-line template editor for prompts: the whole text is a template and
 * every `{{ … }}` is a chip. A footer shows the reference count or the first
 * problem and hosts the "Insert reference" button. CodeMirror loads on demand.
 */
export const ExpressionTextarea = lazyEditor<ExpressionTextareaProps, ExpressionEditorHandle>(
  "ExpressionTextarea",
  () => import("./ExpressionInputView").then((m) => m.ExpressionTextareaView),
  (props) => <ExpressionTextareaFallback {...props} />,
);
