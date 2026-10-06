import { forwardRef, useCallback, useImperativeHandle, useMemo, useState } from "react";
import { EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers as cmLineNumbers,
  placeholder as cmPlaceholder,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
} from "@codemirror/language";
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { Braces, WrapText } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  Button,
  IconButton,
  useControllableState,
  useFieldContext,
  useFieldControl,
} from "@/primitives";
import { yamlLanguage } from "@/inspector";
import { formsEditorExtensions } from "./codemirror";
import { useEditorView } from "./useEditorView";
import {
  formatJson,
  type CodeEditorHandle,
  type CodeEditorProps,
  type CodeLanguage,
} from "./CodeEditor";

const LANGUAGE_LABEL: Record<CodeLanguage, string> = {
  javascript: "JavaScript",
  typescript: "TypeScript",
  json: "JSON",
  yaml: "YAML",
};

function languageExtension(language: CodeLanguage): Extension {
  switch (language) {
    case "javascript":
      return javascript();
    case "typescript":
      return javascript({ typescript: true });
    case "json":
      return json();
    case "yaml":
      return yamlLanguage;
    default:
      return [];
  }
}

/**
 * The CodeMirror implementation behind `CodeEditor` (CodeEditor.tsx loads it on demand).
 * Editable CodeMirror 6 editor for JavaScript, TypeScript and JSON with the
 * shared theme, line numbers, bracket matching, closing brackets and basic
 * autocomplete. The status line shows `Ln, Col`, the language, a wrap toggle
 * and "Format JSON" for JSON documents. Escape then Tab leaves the editor.
 */
export const CodeEditorView = forwardRef<CodeEditorHandle, CodeEditorProps>(function CodeEditorView(
  {
    value,
    defaultValue = "",
    onChange,
    language = "json",
    placeholder,
    disabled,
    readOnly = false,
    invalid,
    id,
    className,
    minRows = 6,
    maxRows = 24,
    lineNumbers = true,
    wrap: wrapDefault = false,
    statusLine = true,
    statusAddon,
    onFormatError,
    "aria-label": ariaLabel,
    "aria-describedby": ariaDescribedBy,
  },
  ref,
) {
  const [text, setText] = useControllableState(value, defaultValue, onChange);
  const [wrap, setWrap] = useState(wrapDefault);
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const [formatError, setFormatError] = useState<string | null>(null);
  const field = useFieldControl({
    id,
    disabled,
    "aria-invalid": invalid,
    "aria-describedby": ariaDescribedBy,
  });
  const isDisabled = Boolean(field.disabled);
  const editable = !isDisabled && !readOnly;
  const labelId = useFieldContext()?.labelId;

  const extensions = useMemo<Extension>(() => {
    const attrs: Record<string, string> = { "aria-multiline": "true" };
    if (field.id) attrs.id = field.id;
    // the content is a div, so <label for> cannot name it: default to the language
    if (ariaLabel) attrs["aria-label"] = ariaLabel;
    else if (labelId) attrs["aria-labelledby"] = labelId;
    else attrs["aria-label"] = `${language ?? "code"} editor`;
    // reachable by keyboard, also when disabled or read-only (to scroll and read)
    attrs.tabindex = "0";
    if (field["aria-describedby"]) attrs["aria-describedby"] = field["aria-describedby"];
    if (field["aria-invalid"]) attrs["aria-invalid"] = "true";
    return [
      languageExtension(language),
      lineNumbers ? [cmLineNumbers(), highlightActiveLineGutter(), foldGutter()] : [],
      wrap ? EditorView.lineWrapping : [],
      EditorView.editable.of(editable),
      EditorState.readOnly.of(!editable),
      EditorView.contentAttributes.of(attrs),
      placeholder ? cmPlaceholder(placeholder) : [],
      EditorView.updateListener.of((update) => {
        if (update.selectionSet || update.docChanged) {
          const head = update.state.selection.main.head;
          const line = update.state.doc.lineAt(head);
          setCursor({ line: line.number, col: head - line.from + 1 });
        }
        if (update.docChanged) setFormatError(null);
      }),
    ];
  }, [
    language,
    lineNumbers,
    wrap,
    editable,
    placeholder,
    field.id,
    field["aria-describedby"],
    field["aria-invalid"],
    ariaLabel,
    labelId,
  ]);

  const staticExtensions = useMemo<Extension>(
    () => [
      formsEditorExtensions,
      history(),
      drawSelection(),
      indentUnit.of("  "),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      autocompletion(),
      highlightActiveLine(),
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...completionKeymap,
        indentWithTab,
      ]),
    ],
    [],
  );

  const { containerRef, view } = useEditorView({
    value: text,
    onChange: setText,
    extensions,
    staticExtensions,
  });
  useImperativeHandle(ref, () => ({ focus: () => view?.focus(), view }), [view]);

  const format = useCallback(() => {
    if (!view) return;
    const result = formatJson(view.state.doc.toString());
    if (!result.ok) {
      setFormatError(result.message);
      onFormatError?.(result.message);
      return;
    }
    setFormatError(null);
    const current = view.state.doc.toString();
    if (current === result.text) return;
    view.dispatch({ changes: { from: 0, to: current.length, insert: result.text } });
  }, [view, onFormatError]);

  return (
    <div
      data-disabled={isDisabled || undefined}
      data-invalid={field["aria-invalid"] || undefined}
      className={cn(
        "flex w-full min-w-0 flex-col overflow-hidden rounded-sm border border-border bg-surface",
        "transition-[border-color,box-shadow] duration-(--dur-fast) ease-(--ease-out)",
        "hover:border-border-strong focus-within:border-accent focus-within:shadow-(--focus)",
        "data-invalid:border-danger data-invalid:focus-within:border-danger",
        "data-disabled:cursor-not-allowed data-disabled:bg-surface-2",
        readOnly && "bg-surface-2",
        className,
      )}
    >
      <div
        ref={containerRef}
        role="presentation"
        style={{ "--min-h": `${minRows * 20 + 8}px`, "--max-h": `${maxRows * 20 + 8}px` }}
        className="fa-code min-w-0 [&_.cm-editor]:max-h-(--max-h) [&_.cm-editor]:min-h-(--min-h) [&_.cm-scroller]:max-h-(--max-h) [&_.cm-scroller]:overflow-auto"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) {
            e.preventDefault();
            view?.focus();
          }
        }}
      />
      {statusLine ? (
        <div className="flex h-7 shrink-0 items-center gap-2 border-t border-border bg-surface-2 pl-2 pr-1 text-2xs text-ink-3">
          <span className="shrink-0 font-mono tabular">
            Ln {cursor.line}, Col {cursor.col}
          </span>
          <span className="hidden shrink-0 sm:inline" aria-hidden="true">
            ·
          </span>
          <span className="hidden shrink-0 font-mono sm:inline">{LANGUAGE_LABEL[language]}</span>
          {formatError ? (
            <span className="min-w-0 truncate text-danger-text" role="alert">
              {formatError}
            </span>
          ) : null}
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            {statusAddon}
            <IconButton
              label={wrap ? "Disable soft wrap" : "Soft wrap"}
              size="xs"
              variant="ghost"
              aria-pressed={wrap}
              onClick={() => setWrap((w) => !w)}
              className={cn(wrap && "bg-surface-3 text-ink")}
            >
              <WrapText strokeWidth={1.75} />
            </IconButton>
            {language === "json" && editable ? (
              <Button size="sm" variant="ghost" leadingIcon={<Braces />} onClick={format}>
                Format JSON
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
});
