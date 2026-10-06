import { CodeEditor } from "./CodeEditor";
import { ExpressionInput, ExpressionTextarea } from "./ExpressionInput";
import { TemplateEditor, TemplateInput } from "./TemplateEditor";

/**
 * Fetches CodeMirror and every editor built on it ahead of their first render, so they appear
 * without a placeholder (tests, or a page that is about to show editors anyway).
 */
export async function preloadCodeEditors(): Promise<void> {
  await Promise.all(
    [CodeEditor, ExpressionInput, ExpressionTextarea, TemplateEditor, TemplateInput].map((e) =>
      e.preload(),
    ),
  );
}
