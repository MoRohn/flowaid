/**
 * CodeMirror extensions that turn a plain editor into a template-expression
 * editor: `{{ … }}` regions render as accent chips, references are
 * highlighted, problems are underlined with a hover message, and the scope
 * drives autocomplete (after `{{`, after `.`, and on Ctrl+Space).
 */
import {
  autocompletion,
  completionKeymap,
  insertCompletionText,
  startCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { EditorState, Facet, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import type { ExpressionScope } from "@/types";
import {
  findExpressionRegions,
  scopeCompletions,
  validateExpression,
  type ExpressionValidation,
} from "./expression";

export const EMPTY_SCOPE: ExpressionScope = { inputs: [], variables: [], nodes: [] };

/** The scope available to the editor. Reconfigure it through a Compartment when upstream nodes change. */
export const expressionScope = Facet.define<ExpressionScope, ExpressionScope>({
  combine: (values) => values[0] ?? EMPTY_SCOPE,
});

/** A problem found outside the editor (e.g. a compiler diagnostic's `location.range`). */
export interface EditorDiagnostic {
  from: number;
  to: number;
  severity: "error" | "warning" | "info";
  message: string;
}

/** Problems to underline in addition to the editor's own checks. */
export const externalDiagnostics = Facet.define<
  readonly EditorDiagnostic[],
  readonly EditorDiagnostic[]
>({
  combine: (values) => values.flat(),
});

/**
 * Whether references are checked (and completed) against the `ExpressionScope`. Editors that
 * take their references from somewhere else (TemplateEditor's `refs`) turn it off.
 */
export const scopeReferences = Facet.define<boolean, boolean>({
  combine: (values) => values.at(-1) ?? true,
});

/** Additional completion sources; the first that answers wins. */
export const extraCompletionSource = Facet.define<CompletionSource>();

const chipMark = Decoration.mark({ class: "cm-fa-chip" });
const braceMark = Decoration.mark({ class: "cm-fa-chip cm-fa-chip-brace" });
const refMark = Decoration.mark({ class: "cm-fa-ref" });

function buildDecorations(state: EditorState): {
  decorations: DecorationSet;
  validation: ExpressionValidation;
} {
  const text = state.doc.toString();
  const scope = state.facet(expressionScope);
  const validation = validateExpression(text, scope);
  const ranges: Array<{ from: number; to: number; deco: Decoration; order: number }> = [];
  for (const region of findExpressionRegions(text)) {
    ranges.push({ from: region.from, to: region.from + 2, deco: braceMark, order: 0 });
    if (region.innerTo > region.innerFrom)
      ranges.push({ from: region.innerFrom, to: region.innerTo, deco: chipMark, order: 0 });
    if (region.closed)
      ranges.push({ from: region.innerTo, to: region.to, deco: braceMark, order: 0 });
  }
  const checkScope = state.facet(scopeReferences);
  if (checkScope) {
    for (const ref of validation.references) {
      if (ref.to > ref.from) ranges.push({ from: ref.from, to: ref.to, deco: refMark, order: 1 });
    }
  }
  const external = state.facet(externalDiagnostics).map((d) => ({
    from: Math.max(0, Math.min(d.from, text.length)),
    to: Math.max(0, Math.min(d.to, text.length)),
    severity: d.severity === "error" ? ("error" as const) : ("warning" as const),
    message: d.message,
  }));
  for (const issue of [...(checkScope ? validation.issues : []), ...external]) {
    if (issue.to <= issue.from) continue;
    ranges.push({
      from: issue.from,
      to: issue.to,
      order: 2,
      deco: Decoration.mark({
        class: issue.severity === "error" ? "cm-fa-error" : "cm-fa-warning",
        attributes: { title: issue.message },
      }),
    });
  }
  ranges.sort((a, b) => a.from - b.from || a.order - b.order);
  return {
    decorations: Decoration.set(
      ranges.map((r) => r.deco.range(r.from, r.to)),
      true,
    ),
    validation,
  };
}

/** Callback facet: receives the validation result after every document or scope change. */
export const onExpressionValidate = Facet.define<(result: ExpressionValidation) => void>();

const decorationPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      const built = buildDecorations(view.state);
      this.decorations = built.decorations;
      queueMicrotask(() => {
        for (const cb of view.state.facet(onExpressionValidate)) cb(built.validation);
      });
    }
    update(update: ViewUpdate) {
      const scopeChanged =
        update.startState.facet(expressionScope) !== update.state.facet(expressionScope) ||
        update.startState.facet(externalDiagnostics) !== update.state.facet(externalDiagnostics) ||
        update.startState.facet(scopeReferences) !== update.state.facet(scopeReferences);
      if (!update.docChanged && !scopeChanged) return;
      const built = buildDecorations(update.state);
      this.decorations = built.decorations;
      for (const cb of update.state.facet(onExpressionValidate)) cb(built.validation);
    }
  },
  { decorations: (v) => v.decorations },
);

/** Region containing `pos`, if the cursor is inside `{{ … }}`. */
function regionAt(text: string, pos: number) {
  return findExpressionRegions(text).find((r) => pos >= r.innerFrom && pos <= r.innerTo);
}

const PATH_TAIL = /(?:^|[^\w$.])([A-Za-z_$][\w$]*(?:\.[\w$]*)*)$/;

function completionSource(context: CompletionContext): CompletionResult | null {
  if (!context.state.facet(scopeReferences)) return null;
  const text = context.state.doc.toString();
  const region = regionAt(text, context.pos);
  if (!region) return null;
  const scope = context.state.facet(expressionScope);
  const before = text.slice(region.innerFrom, context.pos);
  const tail = PATH_TAIL.exec(before);
  let segments: string[] = [];
  let prefix = "";
  if (tail?.[1]) {
    const parts = tail[1].split(".");
    prefix = parts.pop() ?? "";
    segments = parts;
  } else if (!context.explicit) {
    // Only open on typing when the person just opened a region or typed a dot.
    const trimmed = before.trimEnd();
    if (trimmed !== "" && !trimmed.endsWith(".")) return null;
    if (trimmed.endsWith(".")) return null;
  }
  const candidates = scopeCompletions(segments, scope);
  if (candidates.length === 0) return null;
  const options: Completion[] = candidates.map((c) => {
    const continues =
      c.kind === "root" || c.kind === "node" || (c.kind === "member" && c.label === "output");
    return {
      label: c.label,
      detail: c.type,
      info: c.detail,
      type: c.kind,
      boost: c.kind === "output" || c.kind === "input" ? 1 : 0,
      apply: (view, _completion, from, to) => {
        view.dispatch(
          insertCompletionText(view.state, continues ? `${c.label}.` : c.label, from, to),
        );
        if (continues) startCompletion(view);
      },
    };
  });
  return {
    from: context.pos - prefix.length,
    options,
    validFor: /^[\w$]*$/,
  };
}

function extraSources(context: CompletionContext) {
  for (const source of context.state.facet(extraCompletionSource)) {
    const result = source(context);
    if (result) return result;
  }
  return null;
}

/** Typing `{{` inserts the closing braces and leaves the caret inside: `{{ | }}`. */
const autoCloseBraces = EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== "{" || from !== to) return false;
  const doc = view.state.doc;
  if (doc.sliceString(from - 1, from) !== "{") return false;
  const regions = findExpressionRegions(doc.toString());
  if (regions.some((r) => !r.closed)) return false;
  if (regions.some((r) => from > r.from && from < r.to)) return false;
  view.dispatch({
    changes: { from, to, insert: "{  }}" },
    selection: { anchor: from + 2 },
    userEvent: "input.type",
  });
  queueMicrotask(() => startCompletion(view));
  return true;
});

/** Keeps the document on one line by turning inserted line breaks into spaces. */
export const singleLine: Extension = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr;
  const fixes: Array<{ from: number; to: number; insert: string }> = [];
  tr.changes.iterChanges((_fromA, _toA, fromB, _toB, inserted) => {
    const s = inserted.toString();
    for (let i = 0; i < s.length; i += 1) {
      if (s.charAt(i) === "\n") fixes.push({ from: fromB + i, to: fromB + i + 1, insert: " " });
    }
  });
  if (fixes.length === 0) return tr;
  return [tr, { changes: fixes, sequential: true }];
});

/**
 * The expression editor extension set. Pass the scope through `expressionScope`
 * separately (typically inside a Compartment) so it can change at runtime.
 */
export function expressionExtensions(): Extension {
  return [
    decorationPlugin,
    autoCloseBraces,
    autocompletion({
      override: [completionSource, extraSources],
      activateOnTyping: true,
      icons: true,
      closeOnBlur: true,
      maxRenderedOptions: 40,
    }),
    keymap.of(completionKeymap),
  ];
}
