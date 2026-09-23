import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useLatestRef } from "@/lib/useLatestRef";

export interface UseEditorViewOptions {
  /** Controlled document. When it changes from outside, the editor updates in place. */
  value: string;
  onChange?: (value: string) => void;
  /**
   * Extensions that may change over time (scope, language, read-only). They
   * live in a Compartment and are reconfigured when the identity changes, so
   * memoise the array.
   */
  extensions: Extension;
  /** Extensions fixed for the editor's lifetime. */
  staticExtensions?: Extension;
  onFocusChange?: (focused: boolean) => void;
}

/**
 * Owns a CodeMirror EditorView bound to a container element. Keeps the
 * document in sync with `value` without resetting the cursor on every
 * keystroke: only external changes dispatch a replacement.
 */
export function useEditorView(options: UseEditorViewOptions): {
  containerRef: RefObject<HTMLDivElement | null>;
  view: EditorView | null;
} {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<EditorView | null>(null);
  const compartment = useRef(new Compartment());
  const onChangeRef = useLatestRef(options.onChange);
  const onFocusRef = useLatestRef(options.onFocusChange);
  const valueRef = useRef(options.value);

  const { extensions, staticExtensions, value } = options;

  useLayoutEffect(() => {
    const parent = containerRef.current;
    if (!parent) return;
    const state = EditorState.create({
      doc: valueRef.current,
      extensions: [
        compartment.current.of(extensions),
        staticExtensions ?? [],
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const next = update.state.doc.toString();
            valueRef.current = next;
            onChangeRef.current?.(next);
          }
          if (update.focusChanged) onFocusRef.current?.(update.view.hasFocus);
        }),
      ],
    });
    const instance = new EditorView({ state, parent });
    setView(instance);
    return () => {
      instance.destroy();
      setView(null);
    };
    // The initial extensions are captured once; later changes go through the compartment.
    // (The latest-value refs are stable; listing them does not re-create the editor.)
  }, [onChangeRef, onFocusRef]);

  useEffect(() => {
    if (!view) return;
    view.dispatch({ effects: compartment.current.reconfigure(extensions) });
  }, [view, extensions]);

  useEffect(() => {
    if (!view) return;
    if (value === valueRef.current) return;
    valueRef.current = value;
    const current = view.state.doc.toString();
    if (current === value) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
      selection: { anchor: Math.min(view.state.selection.main.anchor, value.length) },
    });
  }, [view, value]);

  return { containerRef, view };
}
