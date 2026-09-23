import { EditorView } from "@codemirror/view";
import {
  HighlightStyle,
  StreamLanguage,
  syntaxHighlighting,
  type StreamParser,
} from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { tags as t } from "@lezer/highlight";

/**
 * CodeMirror 6 theme built from the FlowAId CSS variables, so one extension
 * follows light and dark without re-configuring the editor. Background is
 * surface-2, text is ink, the selection is accent-soft-2 and the gutter is
 * ink-4. Syntax colours mirror JsonView: strings in the data hue, numbers in
 * the accent, booleans/null in the human hue, keys in ink-2.
 */
export const flowaidCodeMirrorTheme: Extension = [
  EditorView.theme({
    "&": {
      backgroundColor: "var(--surface-2)",
      color: "var(--ink)",
      fontSize: "var(--text-xs)",
      height: "auto",
    },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": {
      fontFamily: "var(--font-mono)",
      fontVariantNumeric: "tabular-nums",
      lineHeight: "1.6",
      overflow: "auto",
    },
    ".cm-content": {
      padding: "8px 0",
      caretColor: "var(--ink)",
      minHeight: "0",
    },
    ".cm-line": { padding: "0 12px 0 6px" },
    ".cm-gutters": {
      backgroundColor: "var(--surface-2)",
      color: "var(--ink-4)",
      border: "none",
      borderRight: "1px solid var(--border)",
      minWidth: "36px",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      padding: "0 8px 0 10px",
      minWidth: "36px",
    },
    ".cm-activeLine": { backgroundColor: "transparent" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--ink-3)" },
    "&.cm-focused .cm-activeLine": { backgroundColor: "var(--surface-3)" },
    "&.cm-focused .cm-activeLineGutter": { backgroundColor: "var(--surface-3)" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
      backgroundColor: "var(--accent-soft-2) !important",
    },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--ink)" },
    ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
      backgroundColor: "var(--accent-soft)",
      outline: "1px solid var(--accent-soft-2)",
    },
    ".cm-nonmatchingBracket": { color: "var(--danger)" },
    ".cm-tooltip": {
      backgroundColor: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-sm)",
      boxShadow: "var(--shadow-2)",
      color: "var(--ink)",
    },
    ".cm-tooltip-autocomplete ul li[aria-selected]": {
      backgroundColor: "var(--surface-3)",
      color: "var(--ink)",
    },
    ".cm-panels": {
      backgroundColor: "var(--surface)",
      color: "var(--ink)",
      borderColor: "var(--border)",
    },
    ".cm-searchMatch": { backgroundColor: "var(--warn-soft)" },
    ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--accent-soft-2)" },
    ".cm-placeholder": { color: "var(--ink-3)" },
    ".cm-foldPlaceholder": {
      backgroundColor: "var(--surface-3)",
      border: "none",
      color: "var(--ink-3)",
      padding: "0 4px",
      borderRadius: "var(--radius-xs)",
    },
  }),
  syntaxHighlighting(
    HighlightStyle.define([
      {
        tag: [t.comment, t.lineComment, t.blockComment],
        color: "var(--ink-3)",
        fontStyle: "italic",
      },
      { tag: [t.string, t.special(t.string), t.regexp], color: "var(--cat-data)" },
      { tag: [t.number, t.integer, t.float], color: "var(--accent-text)" },
      { tag: [t.bool, t.null, t.atom], color: "var(--cat-human)" },
      { tag: [t.propertyName, t.attributeName], color: "var(--ink-2)" },
      {
        tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword],
        color: "var(--ink)",
        fontWeight: "600",
      },
      { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--ink)" },
      { tag: [t.definition(t.variableName), t.variableName], color: "var(--ink)" },
      { tag: [t.typeName, t.className, t.namespace], color: "var(--cat-tool)" },
      { tag: [t.operator, t.punctuation, t.separator, t.bracket], color: "var(--ink-3)" },
      { tag: [t.meta, t.processingInstruction, t.docComment], color: "var(--ink-3)" },
      { tag: t.invalid, color: "var(--danger)" },
      { tag: t.heading, fontWeight: "600" },
      { tag: t.link, color: "var(--accent-text)", textDecoration: "underline" },
    ]),
  ),
];

// ---------------------------------------------------------------------------
// YAML: a light stream tokenizer (no parser dependency)
// ---------------------------------------------------------------------------

interface YamlState {
  /** True until the first non-space character of the line has been consumed. */
  lineStart: boolean;
}

const yamlParser: StreamParser<YamlState> = {
  name: "yaml",
  startState: () => ({ lineStart: true }),
  token(stream, state) {
    if (stream.sol()) state.lineStart = true;
    if (stream.eatSpace()) return null;
    if (stream.match(/^#.*/)) return "comment";
    if (state.lineStart) {
      if (stream.match(/^(---|\.\.\.)\s*$/)) {
        state.lineStart = false;
        return "meta";
      }
      if (stream.match(/^-\s+/)) return "punctuation";
      if (stream.match(/^-\s*$/)) return "punctuation";
      state.lineStart = false;
      if (
        stream.match(
          /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s#:{}[\],&*!|>'"%@`][^:#]*?)(?=\s*:(\s|$))/,
        )
      ) {
        return "propertyName";
      }
    }
    state.lineStart = false;
    if (stream.match(/^:(?=\s|$)/)) return "punctuation";
    if (stream.match(/^[{}[\],]/)) return "bracket";
    if (stream.match(/^[&*][\w-]+/)) return "labelName";
    if (stream.match(/^![\w!/:-]*/)) return "typeName";
    if (stream.match(/^[|>][+-]?\d*\s*$/)) return "operator";
    if (stream.match(/^"(?:[^"\\]|\\.)*"/) || stream.match(/^'(?:[^']|'')*'/)) return "string";
    if (stream.match(/^(true|false|True|False|TRUE|FALSE)\b/)) return "bool";
    if (stream.match(/^(null|Null|NULL|~)\b/)) return "null";
    if (
      stream.match(
        /^[-+]?(0x[0-9a-fA-F]+|0o[0-7]+|\d+(\.\d*)?([eE][-+]?\d+)?|\.\d+|\.inf|\.nan)(?=[\s,\]}]|$)/,
      )
    ) {
      return "number";
    }
    if (stream.match(/^[^\s#,\]}]+/)) return "string";
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: "#" } },
};

/** Minimal YAML language support: keys, scalars, comments, anchors and block markers. */
export const yamlLanguage = StreamLanguage.define(yamlParser);
