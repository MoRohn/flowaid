import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { WrapText } from "lucide-react";
import { EditorView, lineNumbers as lineNumbersExt, highlightSpecialChars } from "@codemirror/view";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { bracketMatching, foldGutter } from "@codemirror/language";
import { json } from "@codemirror/lang-json";
import { javascript } from "@codemirror/lang-javascript";
import { cn } from "@/lib/cn";
import { CopyButton, IconButton, useControllableState } from "@/primitives";
import { flowaidCodeMirrorTheme, yamlLanguage } from "./codeMirrorTheme";

export type CodeBlockLanguage = "json" | "javascript" | "typescript" | "yaml" | "text";

function languageExtension(language: CodeBlockLanguage): Extension {
  switch (language) {
    case "json":
      return json();
    case "javascript":
      return javascript();
    case "typescript":
      return javascript({ typescript: true });
    case "yaml":
      return yamlLanguage;
    case "text":
      return [];
  }
}

const LANGUAGE_LABEL: Record<CodeBlockLanguage, string> = {
  json: "json",
  javascript: "js",
  typescript: "ts",
  yaml: "yaml",
  text: "text",
};

export interface CodeBlockProps extends Omit<HTMLAttributes<HTMLDivElement>, "children" | "title"> {
  code: string;
  language?: CodeBlockLanguage;
  /** Show the line-number gutter. Default true. */
  lineNumbers?: boolean;
  /** Fold gutter for objects/arrays and blocks. Default false. */
  foldable?: boolean;
  /** Soft-wrap long lines (controlled). */
  wrap?: boolean;
  defaultWrap?: boolean;
  onWrapChange?: (wrap: boolean) => void;
  /** Max height in px (or any CSS length) before the block scrolls. Default 320. */
  maxHeight?: number | string;
  /** Header with a title, the language and actions. Set false for a bare block with floating actions. Default true. */
  header?: boolean;
  /** Mono label at the start of the header, e.g. a file name or "config". */
  title?: ReactNode;
  /** Extra actions rendered before the wrap/copy buttons. */
  actions?: ReactNode;
  /** Show the wrap toggle. Default true. */
  wrapToggle?: boolean;
  /** Show the copy button. Default true. */
  copyable?: boolean;
  /** Extra CodeMirror extensions appended after the theme (forms/ can pass its own). */
  extensions?: Extension;
}

/**
 * Read-only CodeMirror 6 block themed with `flowaidCodeMirrorTheme`. JSON and
 * JavaScript/TypeScript get full syntax highlighting; YAML uses a light
 * stream tokenizer. Line numbers, a wrap toggle, a copy button and a max
 * height with internal scrolling are built in.
 */
export const CodeBlock = forwardRef<HTMLDivElement, CodeBlockProps>(function CodeBlock(
  {
    code,
    language = "text",
    lineNumbers = true,
    foldable = false,
    wrap,
    defaultWrap = false,
    onWrapChange,
    maxHeight = 320,
    header = true,
    title,
    actions,
    wrapToggle = true,
    copyable = true,
    extensions,
    className,
    style,
    ...rest
  },
  ref,
) {
  const [isWrapped, setWrapped] = useControllableState(wrap, defaultWrap, onWrapChange);
  const host = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const compartments = useRef({
    language: new Compartment(),
    wrap: new Compartment(),
    gutter: new Compartment(),
    fold: new Compartment(),
    extra: new Compartment(),
  });
  const [lineCount, setLineCount] = useState(() =>
    code.length === 0 ? 0 : code.split("\n").length,
  );

  const setHost = useCallback(
    (node: HTMLDivElement | null) => {
      host.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  // Create the view once; later prop changes reconfigure compartments.
  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const c = compartments.current;
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: code,
        extensions: [
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          highlightSpecialChars(),
          bracketMatching(),
          flowaidCodeMirrorTheme,
          c.gutter.of(lineNumbers ? lineNumbersExt() : []),
          c.fold.of(foldable ? foldGutter() : []),
          c.wrap.of(isWrapped ? EditorView.lineWrapping : []),
          c.language.of(languageExtension(language)),
          c.extra.of(extensions ?? []),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Initial values are read once on mount; later changes reconfigure compartments below.
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== code) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: code } });
    }
    setLineCount(code.length === 0 ? 0 : view.state.doc.lines);
  }, [code]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: compartments.current.language.reconfigure(languageExtension(language)),
    });
  }, [language]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: compartments.current.wrap.reconfigure(isWrapped ? EditorView.lineWrapping : []),
    });
  }, [isWrapped]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: compartments.current.gutter.reconfigure(lineNumbers ? lineNumbersExt() : []),
    });
  }, [lineNumbers]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: compartments.current.fold.reconfigure(foldable ? foldGutter() : []),
    });
  }, [foldable]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: compartments.current.extra.reconfigure(extensions ?? []),
    });
  }, [extensions]);

  const controls = (
    <>
      {actions}
      {wrapToggle ? (
        <IconButton
          label={isWrapped ? "Unwrap lines" : "Wrap lines"}
          size="sm"
          aria-pressed={isWrapped}
          onClick={() => setWrapped(!isWrapped)}
          className={cn(isWrapped && "bg-surface-3 text-ink")}
        >
          <WrapText strokeWidth={1.75} />
        </IconButton>
      ) : null}
      {copyable ? <CopyButton value={code} label="Copy code" size="sm" /> : null}
    </>
  );

  const maxH = typeof maxHeight === "number" ? `${maxHeight}px` : maxHeight;

  return (
    <div
      data-language={language}
      className={cn(
        "group/code relative flex min-w-0 flex-col overflow-hidden rounded-sm border border-border bg-surface-2",
        className,
      )}
      style={style}
      {...rest}
    >
      {header ? (
        <div className="flex h-7 shrink-0 items-center gap-2 border-b border-border bg-surface px-1.5 pl-2.5">
          {title !== undefined ? (
            <span className="min-w-0 truncate font-mono text-2xs text-ink-2">{title}</span>
          ) : null}
          <span className="font-mono text-2xs uppercase tracking-(--tracking-caps) text-ink-3">
            {LANGUAGE_LABEL[language]}
          </span>
          <span className="font-mono text-2xs text-ink-3 tabular">
            {lineCount} {lineCount === 1 ? "line" : "lines"}
          </span>
          <span className="ml-auto flex items-center gap-0.5">{controls}</span>
        </div>
      ) : (
        <div
          className={cn(
            "absolute right-1 top-1 z-10 flex items-center gap-0.5 rounded-sm border border-border bg-surface p-0.5 shadow-1",
            "opacity-0 transition-opacity duration-(--dur-fast) group-hover/code:opacity-100 group-focus-within/code:opacity-100",
          )}
        >
          {controls}
        </div>
      )}
      <div
        ref={setHost}
        className="min-w-0 text-xs [&_.cm-scroller]:max-h-(--code-max-h)"
        style={{ "--code-max-h": maxH }}
      />
    </div>
  );
});
