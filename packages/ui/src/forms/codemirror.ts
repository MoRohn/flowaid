/**
 * CodeMirror 6 styling for the editable editors. The base theme and syntax
 * colours come from the inspector group (`flowaidCodeMirrorTheme`) so
 * read-only CodeBlocks and editable CodeEditors look identical; this module
 * adds the autocomplete list, the expression chips and a compact single-line
 * variant for ExpressionInput. Every colour is a token; no hex anywhere.
 */
import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { flowaidCodeMirrorTheme } from "@/inspector";

/** Autocomplete popup, hover tooltips and expression chip marks. Shared by every forms editor. */
export const formsCompletionTheme = EditorView.theme({
  ".cm-content:focus-visible": { boxShadow: "none", outline: "none" },
  ".cm-tooltip": {
    borderRadius: "var(--radius-md)",
    boxShadow: "var(--shadow-3)",
    fontFamily: "var(--font-sans)",
    fontSize: "var(--text-xs)",
    overflow: "hidden",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": {
    fontFamily: "var(--font-sans)",
    maxHeight: "240px",
    minWidth: "240px",
    padding: "4px",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    height: "28px",
    padding: "0 8px",
    borderRadius: "var(--radius-xs)",
    color: "var(--ink)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--surface-3)",
    color: "var(--ink)",
  },
  ".cm-tooltip-autocomplete .cm-completionIcon": {
    width: "10px",
    height: "10px",
    padding: "0",
    marginRight: "0",
    opacity: "1",
    fontSize: "0",
    borderRadius: "3px",
    flex: "none",
    boxSizing: "border-box",
  },
  ".cm-tooltip-autocomplete .cm-completionIcon-root": {
    background: "var(--surface-3)",
    border: "1px solid var(--border-strong)",
  },
  ".cm-tooltip-autocomplete .cm-completionIcon-input": { background: "var(--cat-data)" },
  ".cm-tooltip-autocomplete .cm-completionIcon-variable": { background: "var(--cat-state)" },
  ".cm-tooltip-autocomplete .cm-completionIcon-node": { background: "var(--accent)" },
  ".cm-tooltip-autocomplete .cm-completionIcon-member": {
    background: "var(--surface-3)",
    border: "1px solid var(--border-strong)",
  },
  ".cm-tooltip-autocomplete .cm-completionIcon-output": {
    background: "var(--cat-decision)",
    borderRadius: "999px",
  },
  ".cm-tooltip-autocomplete .cm-completionIcon::after": { content: "none" },
  ".cm-tooltip-autocomplete .cm-completionLabel": {
    fontFamily: "var(--font-mono)",
    fontSize: "var(--text-xs)",
    flex: "none",
  },
  ".cm-tooltip-autocomplete .cm-completionMatchedText": {
    textDecoration: "none",
    color: "var(--accent-text)",
    fontWeight: "600",
  },
  ".cm-tooltip-autocomplete .cm-completionDetail": {
    marginLeft: "auto",
    fontFamily: "var(--font-mono)",
    fontSize: "var(--text-2xs)",
    fontStyle: "normal",
    color: "var(--ink-3)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: "45%",
  },
  ".cm-completionInfo": {
    padding: "8px 10px",
    fontSize: "var(--text-xs)",
    color: "var(--ink-2)",
    borderLeft: "1px solid var(--border)",
    marginLeft: "-1px",
  },
  ".cm-tooltip-hover": { padding: "6px 8px", maxWidth: "320px" },
  /* expression chips */
  ".cm-fa-chip": {
    backgroundColor: "var(--accent-soft)",
    color: "var(--accent-text)",
    borderRadius: "4px",
    padding: "1px 0",
    boxDecorationBreak: "clone",
    WebkitBoxDecorationBreak: "clone",
  },
  ".cm-fa-chip-brace": { color: "var(--accent-text)", opacity: "0.55" },
  ".cm-fa-ref": { color: "var(--accent-text)", fontWeight: "500" },
  ".cm-fa-error": {
    textDecoration: "underline wavy var(--danger)",
    textDecorationSkipInk: "none",
    textUnderlineOffset: "3px",
  },
  ".cm-fa-warning": {
    textDecoration: "underline dotted var(--warn)",
    textUnderlineOffset: "3px",
  },
});

/** Compact, transparent editor chrome for the expression inputs (they sit inside an Input-styled frame). */
export const formsInlineTheme = EditorView.theme({
  "&": {
    color: "var(--ink)",
    backgroundColor: "transparent",
    fontSize: "var(--text-xs)",
    fontFamily: "var(--font-mono)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "20px",
    fontVariantNumeric: "tabular-nums",
  },
  ".cm-content": { caretColor: "var(--ink)", padding: "4px 0" },
  ".cm-line": { padding: "0 8px" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--ink)", borderLeftWidth: "1.5px" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--accent-soft-2)",
  },
  ".cm-placeholder": { color: "var(--ink-3)", fontStyle: "normal" },
});

/** Theme for the expression editors: inline chrome + completion/chip styles. */
export const formsEditorTheme: Extension = [formsInlineTheme, formsCompletionTheme];

/** Theme for CodeEditor: the shared inspector theme (syntax colours included) + completion styles. */
export const formsEditorExtensions: Extension = [flowaidCodeMirrorTheme, formsCompletionTheme];
