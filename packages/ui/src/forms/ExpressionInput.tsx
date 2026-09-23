import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useState,
  type KeyboardEvent,
} from "react";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, placeholder as cmPlaceholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { cn } from "@/lib/cn";
import type { ExpressionScope } from "@/types";
import { FieldError, useControllableState, useFieldControl } from "@/primitives";
import { formsEditorTheme } from "./codemirror";
import { referenceTemplate, type ExpressionValidation } from "./expression";
import {
  expressionExtensions,
  expressionScope,
  onExpressionValidate,
  singleLine,
} from "./expressionExtensions";
import { ExpressionReferencePicker } from "./ExpressionReferencePicker";
import { useEditorView } from "./useEditorView";

export interface ExpressionEditorHandle {
  focus: () => void;
  /** Inserts text at the caret (replacing the selection). */
  insert: (text: string) => void;
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
  "aria-label"?: string;
  "aria-describedby"?: string;
}

const baseExtensions: Extension = [
  history(),
  keymap.of([...historyKeymap, ...defaultKeymap]),
  formsEditorTheme,
];

function editorControlAttributes(field: ReturnType<typeof useFieldControl>, ariaLabel?: string) {
  const attrs: Record<string, string> = { role: "textbox", "aria-multiline": "false" };
  if (field.id) attrs.id = field.id;
  if (ariaLabel) attrs["aria-label"] = ariaLabel;
  if (field["aria-describedby"]) attrs["aria-describedby"] = field["aria-describedby"];
  if (field["aria-invalid"]) attrs["aria-invalid"] = "true";
  if (field["aria-required"]) attrs["aria-required"] = "true";
  return attrs;
}

/**
 * Single-line template expression editor: `{{ … }}` regions render as accent
 * chips, references autocomplete from the scope, and unknown references are
 * underlined with a message. Enter submits; the caret never leaves one line.
 */
export const ExpressionInput = forwardRef<ExpressionEditorHandle, ExpressionInputProps>(
  function ExpressionInput(
    {
      value,
      defaultValue = "",
      onChange,
      scope,
      placeholder = "{{ input.message }}",
      disabled,
      readOnly = false,
      invalid,
      id,
      className,
      onValidate,
      referencePicker = true,
      showMessage = true,
      onSubmit,
      "aria-label": ariaLabel,
      "aria-describedby": ariaDescribedBy,
    },
    ref,
  ) {
    const [text, setText] = useControllableState(value, defaultValue, onChange);
    const [validation, setValidation] = useState<ExpressionValidation | null>(null);
    const [focused, setFocused] = useState(false);
    const field = useFieldControl({
      id,
      disabled,
      "aria-invalid": invalid,
      "aria-describedby": ariaDescribedBy,
    });
    const isDisabled = Boolean(field.disabled);

    const handleValidate = useCallback(
      (result: ExpressionValidation) => {
        setValidation(result);
        onValidate?.(result);
      },
      [onValidate],
    );

    const extensions = useMemo<Extension>(
      () => [
        expressionScope.of(scope),
        onExpressionValidate.of(handleValidate),
        EditorView.editable.of(!isDisabled && !readOnly),
        EditorState.readOnly.of(isDisabled || readOnly),
        EditorView.contentAttributes.of(editorControlAttributes(field, ariaLabel)),
        cmPlaceholder(placeholder),
      ],
      // field is a fresh object each render; depend on its members.
      [
        scope,
        handleValidate,
        isDisabled,
        readOnly,
        field.id,
        field["aria-describedby"],
        field["aria-invalid"],
        field["aria-required"],
        ariaLabel,
        placeholder,
      ],
    );

    const staticExtensions = useMemo<Extension>(
      () => [baseExtensions, singleLine, expressionExtensions()],
      [],
    );

    const { containerRef, view } = useEditorView({
      value: text,
      onChange: setText,
      extensions,
      staticExtensions,
      onFocusChange: setFocused,
    });

    const insert = useCallback(
      (snippet: string) => {
        if (!view) return;
        const { from, to } = view.state.selection.main;
        view.dispatch({
          changes: { from, to, insert: snippet },
          selection: { anchor: from + snippet.length },
        });
        view.focus();
      },
      [view],
    );

    useImperativeHandle(ref, () => ({ focus: () => view?.focus(), insert, view }), [view, insert]);

    const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Enter" && !e.shiftKey && onSubmit) {
        const open = containerRef.current?.querySelector(".cm-tooltip-autocomplete");
        if (!open) {
          e.preventDefault();
          onSubmit();
        }
      }
    };

    const firstError = validation?.issues.find((i) => i.severity === "error");
    const showInvalid = Boolean(field["aria-invalid"]) || (Boolean(firstError) && !focused);

    return (
      <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
        <div
          role="presentation"
          data-disabled={isDisabled || undefined}
          data-invalid={showInvalid || undefined}
          onKeyDown={handleKeyDown}
          onMouseDown={(e) => {
            // Clicking the padding focuses the editor without moving an existing caret.
            if (e.target === e.currentTarget) {
              e.preventDefault();
              view?.focus();
            }
          }}
          className={cn(
            "group relative flex min-h-7 w-full min-w-0 items-center rounded-sm border border-border bg-surface",
            "transition-[border-color,box-shadow,background-color] duration-(--dur-fast) ease-(--ease-out)",
            "hover:border-border-strong focus-within:border-accent focus-within:shadow-(--focus)",
            "data-invalid:border-danger data-invalid:focus-within:border-danger",
            "data-disabled:cursor-not-allowed data-disabled:bg-surface-2 data-disabled:text-ink-4",
            readOnly && "bg-surface-2",
          )}
        >
          <div
            ref={containerRef}
            className="fa-expression min-w-0 flex-1 [&_.cm-content]:py-[3px] [&_.cm-editor]:min-h-[26px] [&_.cm-line]:pl-2 [&_.cm-scroller]:overflow-x-auto [&_.cm-scroller]:overflow-y-hidden [&_.cm-scroller]:[scrollbar-width:none]"
          />
          {referencePicker ? (
            <div className="flex shrink-0 items-center pr-1">
              <ExpressionReferencePicker
                scope={scope}
                disabled={isDisabled || readOnly}
                onInsert={(path) => insert(referenceTemplate(path))}
              />
            </div>
          ) : null}
        </div>
        {showMessage && firstError && !focused ? (
          <FieldError>{firstError.message}</FieldError>
        ) : null}
      </div>
    );
  },
);

export interface ExpressionTextareaProps extends Omit<ExpressionInputProps, "onSubmit"> {
  /** Initial visible height in lines. */
  minRows?: number;
  maxRows?: number;
}

/**
 * Multi-line template editor for prompts: the whole text is a template and
 * every `{{ … }}` is a chip. A footer shows the reference count or the first
 * problem and hosts the "Insert reference" button.
 */
export const ExpressionTextarea = forwardRef<ExpressionEditorHandle, ExpressionTextareaProps>(
  function ExpressionTextarea(
    {
      value,
      defaultValue = "",
      onChange,
      scope,
      placeholder = "Write the prompt. Insert values with {{ input.message }}.",
      disabled,
      readOnly = false,
      invalid,
      id,
      className,
      onValidate,
      referencePicker = true,
      minRows = 4,
      maxRows = 16,
      "aria-label": ariaLabel,
      "aria-describedby": ariaDescribedBy,
    },
    ref,
  ) {
    const [text, setText] = useControllableState(value, defaultValue, onChange);
    const [validation, setValidation] = useState<ExpressionValidation | null>(null);
    const [focused, setFocused] = useState(false);
    const field = useFieldControl({
      id,
      disabled,
      "aria-invalid": invalid,
      "aria-describedby": ariaDescribedBy,
    });
    const isDisabled = Boolean(field.disabled);

    const handleValidate = useCallback(
      (result: ExpressionValidation) => {
        setValidation(result);
        onValidate?.(result);
      },
      [onValidate],
    );

    const extensions = useMemo<Extension>(
      () => [
        expressionScope.of(scope),
        onExpressionValidate.of(handleValidate),
        EditorView.editable.of(!isDisabled && !readOnly),
        EditorState.readOnly.of(isDisabled || readOnly),
        EditorView.contentAttributes.of({
          ...editorControlAttributes(field, ariaLabel),
          "aria-multiline": "true",
        }),
        cmPlaceholder(placeholder),
      ],
      [
        scope,
        handleValidate,
        isDisabled,
        readOnly,
        field.id,
        field["aria-describedby"],
        field["aria-invalid"],
        field["aria-required"],
        ariaLabel,
        placeholder,
      ],
    );
    const staticExtensions = useMemo<Extension>(
      () => [baseExtensions, EditorView.lineWrapping, expressionExtensions()],
      [],
    );

    const { containerRef, view } = useEditorView({
      value: text,
      onChange: setText,
      extensions,
      staticExtensions,
      onFocusChange: setFocused,
    });

    const insert = useCallback(
      (snippet: string) => {
        if (!view) return;
        const { from, to } = view.state.selection.main;
        view.dispatch({
          changes: { from, to, insert: snippet },
          selection: { anchor: from + snippet.length },
        });
        view.focus();
      },
      [view],
    );
    useImperativeHandle(ref, () => ({ focus: () => view?.focus(), insert, view }), [view, insert]);

    const firstError = validation?.issues.find((i) => i.severity === "error");
    const refCount = validation?.references.length ?? 0;
    const showInvalid = Boolean(field["aria-invalid"]) || (Boolean(firstError) && !focused);

    return (
      <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
        <div
          data-disabled={isDisabled || undefined}
          data-invalid={showInvalid || undefined}
          className={cn(
            "flex w-full min-w-0 flex-col overflow-hidden rounded-sm border border-border bg-surface",
            "transition-[border-color,box-shadow] duration-(--dur-fast) ease-(--ease-out)",
            "hover:border-border-strong focus-within:border-accent focus-within:shadow-(--focus)",
            "data-invalid:border-danger data-invalid:focus-within:border-danger",
            "data-disabled:cursor-not-allowed data-disabled:bg-surface-2",
            readOnly && "bg-surface-2",
          )}
        >
          <div
            ref={containerRef}
            role="presentation"
            style={{ "--min-h": `${minRows * 20 + 8}px`, "--max-h": `${maxRows * 20 + 8}px` }}
            className="fa-expression min-w-0 [&_.cm-editor]:max-h-(--max-h) [&_.cm-editor]:min-h-(--min-h) [&_.cm-scroller]:max-h-(--max-h) [&_.cm-scroller]:overflow-auto"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) {
                e.preventDefault();
                view?.focus();
              }
            }}
          />
          <div className="flex h-7 shrink-0 items-center gap-2 border-t border-border bg-surface-2 pl-2 pr-1 text-2xs text-ink-3">
            {firstError && !focused ? (
              <span className="min-w-0 truncate text-danger-text">{firstError.message}</span>
            ) : (
              <span className="min-w-0 truncate font-mono tabular">
                {refCount === 0
                  ? "No references"
                  : `${refCount} ${refCount === 1 ? "reference" : "references"}`}
                {validation && validation.issues.length > 0 && focused
                  ? ` · ${validation.issues.length} ${validation.issues.length === 1 ? "issue" : "issues"}`
                  : ""}
              </span>
            )}
            {referencePicker ? (
              <div className="ml-auto flex shrink-0 items-center">
                <ExpressionReferencePicker
                  scope={scope}
                  disabled={isDisabled || readOnly}
                  onInsert={(path) => insert(referenceTemplate(path))}
                />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  },
);
