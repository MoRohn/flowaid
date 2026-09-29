import { useId, useMemo, useState, type ReactNode } from "react";
import { Plus, X } from "lucide-react";
import {
  formatRef,
  parseExpression,
  parseRef,
  parseTemplate,
  type Binding,
} from "@flowaid/workflow-core";
import type { ExpressionScope } from "@/types";
import { Button, FieldHint, IconButton, Input, ToggleGroup, ToggleGroupItem } from "@/primitives";
import { CodeEditor } from "./CodeEditor";
import { TemplateEditor, type TemplateRef } from "./TemplateEditor";
import { templateRefsFromScope } from "./templateCheck";
import {
  BINDING_MODES,
  bindingModeOf,
  isBinding,
  literalFieldValue,
  literalOf,
  type BindingMode,
} from "./schema";

/**
 * The switch's modes: the four scalar sources, plus `fields` / `items` for object and array
 * bindings (a value assembled from one binding per field or item).
 */
type FieldMode = BindingMode | "fields" | "items";

const MODE_LABEL: Record<FieldMode, string> = {
  literal: "Value",
  ref: "Reference",
  template: "Template",
  expr: "Expression",
  fields: "Fields",
  items: "List",
};

/** One line under the editor saying what the current mode does, in plain words. */
const MODE_HINT: Record<FieldMode, string> = {
  literal: "A fixed value, the same on every run.",
  ref: "Uses a value from an earlier step, a setting or the run.",
  template: "Text with {{ node.port }} placeholders, filled in on each run.",
  expr: "A formula (FlowExpr) worked out just before this step runs.",
  fields: "An object built field by field; each field gets its own value.",
  items: "A list built item by item; each item gets its own value.",
};

type ObjectBinding = Extract<Binding, { kind: "object" }>;
type ArrayBinding = Extract<Binding, { kind: "array" }>;

function modeOf(value: unknown): FieldMode {
  if (isBinding(value) && value.kind === "object") return "fields";
  if (isBinding(value) && value.kind === "array") return "items";
  return bindingModeOf(value);
}

/** A nested field's value as a `Binding` (object and array bindings hold only bindings). */
function asBinding(value: unknown): Binding {
  if (isBinding(value)) return value;
  return { kind: "literal", value: (value ?? null) as never };
}

function literalBinding(value: unknown): Binding {
  return { kind: "literal", value: value as Extract<Binding, { kind: "literal" }>["value"] };
}

/** Seeds the Fields editor from a plain object literal, so switching to Fields keeps its values. */
function fieldsSeed(literal: unknown): Record<string, unknown> {
  if (literal === null || typeof literal !== "object" || Array.isArray(literal)) return {};
  return Object.fromEntries(
    Object.entries(literal as Record<string, unknown>).map(([k, v]) => [k, literalBinding(v)]),
  );
}

function uniqueFieldName(fields: Record<string, unknown>): string {
  for (let i = Object.keys(fields).length + 1; ; i++) {
    const name = `field_${i}`;
    if (!(name in fields)) return name;
  }
}

export interface BindingFieldProps {
  /** The field value: a literal, `{ kind: 'literal' }`, or a ref / template / expr `Binding`. */
  value: unknown;
  /** Receives the literal (wrapped only when it would read as a binding, or always with `alwaysBinding`) or the `Binding`. */
  onChange: (value: unknown) => void;
  onBlur?: () => void;
  /** Field label; names the mode switch ("<label> source"). */
  label: string;
  /** The literal editor: the field's own widget. Defaults to a JSON editor. */
  renderLiteral?: (literal: unknown, onLiteralChange: (value: unknown) => void) => ReactNode;
  /** `x-ui.widget: 'binding'`: literals are stored as `{ kind: 'literal', value }` too. */
  alwaysBinding?: boolean;
  /** Upstream references for the template editor and the ref suggestions. */
  scope?: ExpressionScope;
  /**
   * The references Template mode completes and checks (`node.port`); derived from `scope` when
   * not given. Variables likewise come from the scope unless given.
   */
  templateRefs?: readonly TemplateRef[];
  variables?: readonly string[];
  /** The field sits inside a loop or foreach body (`$scope.*` is available). */
  inContainer?: boolean;
  modes?: readonly BindingMode[];
  /**
   * Offer Fields: build an object from one binding per field (node inputs and output values,
   * where the compiler accepts object bindings). A stored object or array binding always shows
   * its own mode, so it is never displayed as an empty literal.
   */
  structured?: boolean;
  /** Show the one-line explanation of the current mode under the editor. */
  showModeHint?: boolean;
  disabled?: boolean;
  invalid?: boolean;
}

/** Problem with a ref / template / expr binding source, or null when it parses. */
export function bindingProblem(binding: Binding): string | null {
  switch (binding.kind) {
    case "template": {
      const parsed = parseTemplate(binding.source);
      return parsed.ok ? null : parsed.message;
    }
    case "expr": {
      if (binding.source.trim() === "") return "Enter an expression";
      const parsed = parseExpression(binding.source);
      return parsed.ok ? null : parsed.message;
    }
    case "ref":
    case "literal":
    case "object":
    case "array":
      return null;
    default:
      return null;
  }
}

function exprSeed(literal: unknown): string {
  if (typeof literal === "number" || typeof literal === "boolean") return String(literal);
  if (typeof literal === "string" && literal !== "") return JSON.stringify(literal);
  return "";
}

/** Canonical compact refs offered as suggestions: upstream node ports and workflow variables. */
function refSuggestions(scope: ExpressionScope | undefined): string[] {
  if (!scope) return [];
  const out: string[] = [];
  for (const node of scope.nodes)
    for (const port of node.outputs) out.push(`${node.id}.${port.id}`);
  for (const v of scope.variables) out.push(`$vars.${v.name}`);
  return out;
}

const EMPTY_SCOPE_VALUE: ExpressionScope = { inputs: [], variables: [], nodes: [] };

/**
 * `x-ui.bindable` field: a Literal ⇄ Ref / Template / Expr switch over the
 * field's own widget. Literal mode stores the plain value (the compiler reads
 * it as a literal); the other modes store a `Binding` (`{ kind: 'ref', ref }`,
 * `{ kind: 'template', source }`, `{ kind: 'expr', source }`) that the
 * compiler moves into `configBindings` and resolves before `execute()`.
 * An incomplete ref or an empty expression stores `null` (react-hook-form
 * would read `undefined` as "back to the default") until it parses.
 *
 * Object and array bindings (`{ kind: 'object', fields }`, `{ kind: 'array', items }`) open in
 * Fields / List mode: one nested `BindingField` per field or item. Switching away keeps the
 * fields in this component, so switching back restores them.
 */
export function BindingField({
  value,
  onChange,
  onBlur,
  label,
  renderLiteral,
  alwaysBinding = false,
  scope,
  modes = BINDING_MODES,
  structured = false,
  showModeHint = false,
  templateRefs,
  variables,
  inContainer = false,
  disabled,
  invalid,
}: BindingFieldProps) {
  const switchId = useId();
  const listId = useId();
  const [mode, setMode] = useState<FieldMode>(() => modeOf(value));
  // what each nested field last emitted (an incomplete ref is null), so a nested field is never
  // reset while it is being typed; emitted upward as bindings
  const [fieldsDraft, setFieldsDraft] = useState<Record<string, unknown>>(() =>
    isBinding(value) && value.kind === "object" ? value.fields : {},
  );
  const [itemsDraft, setItemsDraft] = useState<unknown[]>(() =>
    isBinding(value) && value.kind === "array" ? value.items : [],
  );
  // once a field has held an object or array binding, its mode stays on offer so switching
  // away can be reversed
  const [hadFields, setHadFields] = useState(() => modeOf(value) === "fields");
  const [hadItems, setHadItems] = useState(() => modeOf(value) === "items");
  const [literal, setLiteral] = useState<unknown>(() => literalOf(value));
  const [refDraft, setRefDraft] = useState(() =>
    isBinding(value) && value.kind === "ref" ? formatRef(value.ref) : "",
  );
  const [templateDraft, setTemplateDraft] = useState(() =>
    isBinding(value) && value.kind === "template"
      ? value.source
      : typeof literalOf(value) === "string"
        ? String(literalOf(value))
        : "",
  );
  const [exprDraft, setExprDraft] = useState(() =>
    isBinding(value) && value.kind === "expr" ? value.source : "",
  );
  const [lastEmitted, setLastEmitted] = useState<unknown>(value);
  const suggestions = useMemo(() => refSuggestions(scope), [scope]);
  const refs = useMemo(
    () => templateRefs ?? templateRefsFromScope(scope ?? EMPTY_SCOPE_VALUE),
    [templateRefs, scope],
  );
  const varNames = useMemo(
    () => variables ?? (scope ?? EMPTY_SCOPE_VALUE).variables.map((v) => v.name),
    [variables, scope],
  );

  // Adopt values written from outside (reset, undo) that this field did not emit.
  if (value !== lastEmitted) {
    setLastEmitted(value);
    const nextMode = modeOf(value);
    setMode(nextMode);
    if (nextMode === "literal") setLiteral(literalOf(value));
    if (isBinding(value)) {
      if (value.kind === "ref") setRefDraft(formatRef(value.ref));
      if (value.kind === "template") setTemplateDraft(value.source);
      if (value.kind === "expr") setExprDraft(value.source);
      if (value.kind === "object") {
        setFieldsDraft(value.fields);
        setHadFields(true);
      }
      if (value.kind === "array") {
        setItemsDraft(value.items);
        setHadItems(true);
      }
    }
  }

  const emit = (next: unknown) => {
    setLastEmitted(next);
    onChange(next);
  };
  const emitLiteral = (next: unknown) => {
    setLiteral(next);
    emit(
      alwaysBinding
        ? next === undefined
          ? null
          : { kind: "literal", value: next }
        : literalFieldValue(next),
    );
  };
  const emitRef = (text: string) => {
    setRefDraft(text);
    const parsed = parseRef(text.trim());
    emit(parsed.ok ? { kind: "ref", ref: parsed.ref } : null);
  };
  const emitTemplate = (source: string) => {
    setTemplateDraft(source);
    emit({ kind: "template", source });
  };
  const emitExpr = (source: string) => {
    setExprDraft(source);
    emit(source.trim() === "" ? null : { kind: "expr", source });
  };

  const emitFields = (fields: Record<string, unknown>) => {
    setFieldsDraft(fields);
    emit({
      kind: "object",
      fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, asBinding(v)])),
    } satisfies ObjectBinding);
  };
  const emitItems = (items: unknown[]) => {
    setItemsDraft(items);
    emit({ kind: "array", items: items.map(asBinding) } satisfies ArrayBinding);
  };

  const switchTo = (next: FieldMode) => {
    if (next === mode) return;
    setMode(next);
    switch (next) {
      case "fields":
        emitFields(Object.keys(fieldsDraft).length > 0 ? fieldsDraft : fieldsSeed(literal));
        break;
      case "items":
        emitItems(itemsDraft);
        break;
      case "literal":
        emitLiteral(literal);
        break;
      case "ref":
        emitRef(refDraft);
        break;
      case "template":
        emitTemplate(
          templateDraft !== "" ? templateDraft : typeof literal === "string" ? literal : "",
        );
        break;
      case "expr":
        emitExpr(exprDraft !== "" ? exprDraft : exprSeed(literal));
        break;
    }
  };

  const refParse = refDraft.trim() === "" ? null : parseRef(refDraft.trim());
  const exprParse = exprDraft.trim() === "" ? null : parseExpression(exprDraft);
  const shownModes: FieldMode[] = [
    ...modes,
    ...(structured || hadFields ? (["fields"] as const) : []),
    ...(hadItems ? (["items"] as const) : []),
  ];

  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-binding-mode={mode}>
      <ToggleGroup
        id={switchId}
        type="single"
        size="sm"
        // five modes do not fit a narrow inspector on one line
        className="h-auto min-h-6 flex-wrap"
        value={mode}
        onValueChange={(v) => {
          const next = shownModes.find((m) => m === v);
          if (next) switchTo(next);
        }}
        disabled={disabled}
        aria-label={`${label} source`}
      >
        {shownModes.map((m) => (
          <ToggleGroupItem key={m} value={m}>
            {MODE_LABEL[m]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {mode === "literal" ? (
        renderLiteral ? (
          renderLiteral(literal, emitLiteral)
        ) : (
          <CodeEditor
            aria-label={`${label} literal`}
            language="json"
            value={literal === undefined ? "" : JSON.stringify(literal, null, 2)}
            onChange={(text) => {
              if (text.trim() === "") {
                emitLiteral(undefined);
                return;
              }
              try {
                const parsed: unknown = JSON.parse(text);
                emitLiteral(parsed);
              } catch {
                // Keep the last parsed literal while the JSON is incomplete.
              }
            }}
            disabled={disabled}
            minRows={3}
          />
        )
      ) : null}
      {mode === "ref" ? (
        <>
          <Input
            aria-label={`${label} reference`}
            mono
            value={refDraft}
            onChange={(e) => emitRef(e.target.value)}
            onBlur={onBlur}
            placeholder="intent.decision.value"
            list={suggestions.length > 0 ? listId : undefined}
            invalid={invalid || (refParse !== null && !refParse.ok)}
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
          />
          {suggestions.length > 0 ? (
            <datalist id={listId}>
              {suggestions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          ) : null}
          <FieldHint>
            {refParse && !refParse.ok
              ? refParse.message
              : `${showModeHint ? `${MODE_HINT.ref} ` : ""}node.port[.path], $vars.name, $scope.item or $run.id`}
          </FieldHint>
        </>
      ) : null}
      {mode === "template" ? (
        // templates are often prompts over several lines: a growing, wrapping editor that
        // completes and checks the compiler's references (`start.message`, `$vars.x`)
        <TemplateEditor
          aria-label={`${label} template`}
          refs={refs}
          variables={varNames}
          inContainer={inContainer}
          value={templateDraft}
          onChange={emitTemplate}
          disabled={disabled}
          invalid={invalid}
          minRows={2}
          maxRows={14}
        />
      ) : null}
      {mode === "expr" ? (
        <>
          <Input
            aria-label={`${label} expression`}
            mono
            value={exprDraft}
            onChange={(e) => emitExpr(e.target.value)}
            onBlur={onBlur}
            placeholder="intent.decision.confidence >= 0.8"
            invalid={invalid || (exprParse !== null && !exprParse.ok)}
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
          />
          <FieldHint>{exprParse && !exprParse.ok ? exprParse.message : MODE_HINT.expr}</FieldHint>
        </>
      ) : null}
      {mode === "fields" ? (
        <FieldsEditor
          label={label}
          fields={fieldsDraft}
          scope={scope}
          disabled={disabled}
          nested={{ templateRefs: refs, variables: varNames, inContainer }}
          onChange={emitFields}
        />
      ) : null}
      {mode === "items" ? (
        <ItemsEditor
          label={label}
          items={itemsDraft}
          scope={scope}
          disabled={disabled}
          nested={{ templateRefs: refs, variables: varNames, inContainer }}
          onChange={emitItems}
        />
      ) : null}
      {showModeHint && (mode === "literal" || mode === "template") ? (
        <FieldHint>{MODE_HINT[mode]}</FieldHint>
      ) : null}
      {mode === "fields" || mode === "items" ? <FieldHint>{MODE_HINT[mode]}</FieldHint> : null}
    </div>
  );
}

interface NestedEditorProps {
  label: string;
  scope?: ExpressionScope;
  disabled?: boolean;
  /** What nested fields complete and check in Template mode (the parent's). */
  nested: Pick<BindingFieldProps, "templateRefs" | "variables" | "inContainer">;
}

/** Fields mode: a name and a nested `BindingField` per field; names are renamed on blur. */
function FieldsEditor({
  label,
  fields,
  scope,
  disabled,
  nested,
  onChange,
}: NestedEditorProps & {
  fields: Record<string, unknown>;
  onChange: (fields: Record<string, unknown>) => void;
}) {
  const entries = Object.entries(fields);
  const [renameError, setRenameError] = useState<{ name: string; message: string } | null>(null);

  const rename = (from: string, to: string) => {
    const name = to.trim();
    if (name === from) {
      setRenameError(null);
      return false;
    }
    if (name === "") {
      setRenameError({ name: from, message: "A field needs a name." });
      return false;
    }
    if (name in fields) {
      setRenameError({ name: from, message: `There is already a field called "${name}".` });
      return false;
    }
    setRenameError(null);
    // keep the field's position
    onChange(Object.fromEntries(entries.map(([k, v]) => [k === from ? name : k, v])));
    return true;
  };

  return (
    <div className="flex flex-col gap-2" role="group" aria-label={`${label} fields`}>
      {entries.length === 0 ? (
        <p className="text-xs text-ink-3">No fields yet. Add one to build the object.</p>
      ) : null}
      {entries.map(([name, binding]) => (
        <div
          key={name}
          className="flex flex-col gap-1.5 rounded-sm border border-border bg-surface-2 p-2"
        >
          <div className="flex items-center gap-1.5">
            <Input
              aria-label={`${label}: name of field ${name}`}
              mono
              size="sm"
              defaultValue={name}
              disabled={disabled}
              invalid={renameError?.name === name}
              autoComplete="off"
              spellCheck={false}
              onBlur={(e) => {
                if (!rename(name, e.target.value)) e.target.value = name;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
            />
            <IconButton
              label={`Remove field ${name}`}
              size="sm"
              disabled={disabled}
              onClick={() => onChange(Object.fromEntries(entries.filter(([k]) => k !== name)))}
            >
              <X />
            </IconButton>
          </div>
          {renameError?.name === name ? (
            <p className="text-2xs text-danger-text" role="alert">
              {renameError.message}
            </p>
          ) : null}
          <BindingField
            label={`${label}.${name}`}
            value={binding}
            scope={scope}
            disabled={disabled}
            structured
            {...nested}
            onChange={(v) => onChange({ ...fields, [name]: v })}
          />
        </div>
      ))}
      <Button
        size="sm"
        variant="ghost"
        className="self-start"
        leadingIcon={<Plus />}
        disabled={disabled}
        onClick={() =>
          onChange({ ...fields, [uniqueFieldName(fields)]: { kind: "literal", value: null } })
        }
      >
        Add field
      </Button>
    </div>
  );
}

/** List mode: a nested `BindingField` per item, in order. */
function ItemsEditor({
  label,
  items,
  scope,
  disabled,
  nested,
  onChange,
}: NestedEditorProps & { items: unknown[]; onChange: (items: unknown[]) => void }) {
  return (
    <div className="flex flex-col gap-2" role="group" aria-label={`${label} items`}>
      {items.length === 0 ? <p className="text-xs text-ink-3">The list is empty.</p> : null}
      {items.map((binding, i) => (
        <div
          // items have no identity beyond their position
          key={i}
          className="flex flex-col gap-1.5 rounded-sm border border-border bg-surface-2 p-2"
        >
          <div className="flex items-center justify-between gap-1.5">
            <span className="font-mono text-2xs text-ink-3">Item {i + 1}</span>
            <IconButton
              label={`Remove item ${i + 1}`}
              size="sm"
              disabled={disabled}
              onClick={() => onChange(items.filter((_, j) => j !== i))}
            >
              <X />
            </IconButton>
          </div>
          <BindingField
            label={`${label}[${i + 1}]`}
            value={binding}
            scope={scope}
            disabled={disabled}
            structured
            {...nested}
            onChange={(v) => onChange(items.map((b, j) => (j === i ? v : b)))}
          />
        </div>
      ))}
      <Button
        size="sm"
        variant="ghost"
        className="self-start"
        leadingIcon={<Plus />}
        disabled={disabled}
        onClick={() => onChange([...items, { kind: "literal", value: null }])}
      >
        Add item
      </Button>
    </div>
  );
}
