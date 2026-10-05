/**
 * The `flowexpr` widget: a field whose whole text is a FlowExpr expression (`x-ui.language:
 * "flowexpr"`, such as a Transform's `expr` or an Assert's `condition`), edited with completion
 * over the step's references (`FlowExprEditorView`). The editor's CodeMirror loads when a form
 * first shows such a field, so pages without one do not carry it; until then the field shows its
 * text read-only.
 */
import { Suspense, forwardRef, lazy, useMemo } from "react";
import { Textarea } from "@/primitives";
import type { ExpressionEditorHandle } from "./ExpressionInput";
import type { FlowExprEditorProps } from "./FlowExprEditorView";
import { templateRefsFromScope } from "./templateCheck";
import {
  BLOCK_WIDGETS,
  registerWidget,
  useSchemaFormEnvironment,
  type SchemaWidgetProps,
} from "./widgets";

export type { FlowExprEditorProps } from "./FlowExprEditorView";

const NO_VARIABLES: readonly string[] = [];

const View = lazy(() =>
  import("./FlowExprEditorView").then((m) => ({ default: m.FlowExprEditorView })),
);

export const FlowExprEditor = forwardRef<ExpressionEditorHandle, FlowExprEditorProps>(
  function FlowExprEditor(props, ref) {
    return (
      <Suspense
        fallback={
          <Textarea
            aria-label={props["aria-label"]}
            aria-busy="true"
            mono
            readOnly
            rows={2}
            value={props.value ?? props.defaultValue ?? ""}
          />
        }
      >
        <View ref={ref} {...props} />
      </Suspense>
    );
  },
);

/** The SchemaForm widget: the step's references come from the form environment. */
export function FlowExprWidget({
  value,
  onChange,
  placeholder,
  disabled,
  invalid,
  label,
  "aria-label": ariaLabel,
}: SchemaWidgetProps) {
  const env = useSchemaFormEnvironment();
  const refs = useMemo(
    () => env.templateRefs ?? templateRefsFromScope(env.scope),
    [env.templateRefs, env.scope],
  );
  return (
    <div data-widget="flowexpr">
      <FlowExprEditor
        aria-label={ariaLabel ?? label}
        refs={refs}
        variables={env.variables ?? NO_VARIABLES}
        inContainer={env.inContainer ?? false}
        value={typeof value === "string" ? value : ""}
        onChange={onChange}
        {...(placeholder !== undefined ? { placeholder } : {})}
        {...(disabled !== undefined ? { disabled } : {})}
        {...(invalid !== undefined ? { invalid } : {})}
      />
    </div>
  );
}

registerWidget("flowexpr", FlowExprWidget);
BLOCK_WIDGETS.add("flowexpr");
