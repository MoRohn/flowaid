import { cn } from "@/lib/cn";
import type { EditorView } from "@codemirror/view";
import type { ReactNode } from "react";
import { lazyEditor, rowsHeight } from "./lazyEditor";

export type CodeLanguage = "javascript" | "typescript" | "json" | "yaml";

export interface CodeEditorHandle {
  focus: () => void;
  /** The CodeMirror view, once the editor has loaded. */
  view: EditorView | null;
}

export interface CodeEditorProps {
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  language?: CodeLanguage;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  invalid?: boolean;
  id?: string;
  className?: string;
  /** Visible height in lines before scrolling. */
  minRows?: number;
  maxRows?: number;
  lineNumbers?: boolean;
  /** Start with soft wrapping on. The status line has a toggle. */
  wrap?: boolean;
  /** Hide the status line (cursor position, language, actions). */
  statusLine?: boolean;
  /** Extra content at the right of the status line. */
  statusAddon?: ReactNode;
  /** Called when "Format JSON" fails to parse. Also shown inline. */
  onFormatError?: (message: string) => void;
  "aria-label"?: string;
  "aria-describedby"?: string;
}

/** Pretty-prints JSON with two-space indentation; returns the parse error otherwise. */
export function formatJson(
  source: string,
): { ok: true; text: string } | { ok: false; message: string } {
  try {
    return { ok: true, text: JSON.stringify(JSON.parse(source), null, 2) };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message.replace(/^JSON\.parse: /, "") : "Invalid JSON",
    };
  }
}

/**
 * Editable CodeMirror 6 editor for JavaScript, TypeScript, JSON and YAML with the shared theme,
 * line numbers, bracket matching, closing brackets and basic autocomplete; the status line shows
 * `Ln, Col`, the language, a wrap toggle and "Format JSON". CodeMirror loads on demand: until it
 * has, a box of the editor's size holds its place (CodeEditorView.tsx is the implementation).
 */
export const CodeEditor = lazyEditor<CodeEditorProps, CodeEditorHandle>(
  "CodeEditor",
  () => import("./CodeEditorView").then((m) => m.CodeEditorView),
  ({ value, defaultValue, minRows = 6, maxRows = 24, statusLine = true, readOnly, className }) => (
    <div
      aria-busy="true"
      className={cn(
        "flex w-full min-w-0 flex-col overflow-hidden rounded-sm border border-border bg-surface",
        readOnly && "bg-surface-2",
        className,
      )}
    >
      <div style={{ height: rowsHeight(value ?? defaultValue, minRows, maxRows) }} />
      {statusLine ? <div className="h-7 shrink-0 border-t border-border bg-surface-2" /> : null}
    </div>
  ),
);
