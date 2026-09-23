import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Controller,
  FormProvider,
  useController,
  useForm,
  useFormContext,
  useFormState,
  useWatch,
  type Control,
  type UseFormReturn,
} from "react-hook-form";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useLatestRef } from "@/lib/useLatestRef";
import type { CredentialView, ExpressionScope, JsonSchema, ModelView } from "@/types";
import {
  Button,
  Collapsible,
  FieldError,
  FieldHint,
  FieldRow,
  IconButton,
  Label,
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
} from "@/primitives";
import { BindingField, bindingProblem } from "./BindingField";
import { ReorderableList } from "./ReorderableList";
import { SecretSlotPicker, type SecretSlotPickerProps } from "./SecretSlotPicker";
import {
  buildRules,
  defaultValueFor,
  devWarn,
  enumKey,
  evaluateShowWhen,
  groupProperties,
  hintsOf,
  isBinding,
  isFieldset,
  isMapSchema,
  labelFor,
  literalOf,
  orderedProperties,
  primaryType,
  resolveSchema,
  variantInfo,
  withDefaults,
  type FieldHints,
  type SchemaValues,
} from "./schema";
import {
  createSchemaValidator,
  labelForPath,
  type SchemaIssue,
  type SchemaValidator,
} from "./validation";
import {
  BLOCK_WIDGETS,
  DEFAULT_ENVIRONMENT,
  SchemaFormEnvironmentContext,
  getWidget,
  isMultilineTemplate,
  type LoadOptions,
  type SchemaFormEnvironment,
  type SchemaWidget,
} from "./widgets";

export type SchemaFormLayout = "stacked" | "wide";

export interface SchemaFormProps {
  schema: JsonSchema;
  /** Controlled snapshot. When its identity changes the form resets to it. */
  values?: SchemaValues;
  defaultValues?: SchemaValues;
  /** Fired after every change with the current values and whether they pass validation (field rules and the schema). */
  onChange?: (values: SchemaValues, isValid: boolean) => void;
  /** Fired on submit (Enter in a field or a submit button) when validation passes. */
  onSubmit?: (values: SchemaValues) => void;
  /** stacked: label above control (320px inspector). wide: two columns where fields allow. */
  layout?: SchemaFormLayout;
  disabled?: boolean;
  /** Expression scope for `template`, `expression` and bindable fields. */
  scope?: ExpressionScope;
  credentials?: CredentialView[];
  onCreateCredential?: (credentialType?: string) => void;
  models?: ModelView[];
  /** The node performs an irreversible action: retry policies are shown as never retried. */
  irreversible?: boolean;
  /** Historic decision confidences for the threshold widget's ticks. */
  confidenceSamples?: number[];
  /** Node type id of the manifest being edited, sent to `loadOptions`. */
  nodeType?: string;
  /** Loads `x-ui.optionsProvider` options (`POST /v1/nodes/:type/options/:name`). */
  loadOptions?: LoadOptions;
  /** Credential slots of the node (`NodeManifest.credentials`), rendered above the fields as `SecretSlotPicker`s. */
  secretSlots?: SecretSlotPickerProps;
  /** Per-form widget overrides, keyed like the registry. */
  widgets?: Record<string, SchemaWidget>;
  id?: string;
  className?: string;
  /** Footer content (actions). Rendered inside the <form>, so submit buttons work. */
  children?: ReactNode;
  /** Announce the form to assistive tech. */
  "aria-label"?: string;
}

export interface SchemaFormHandle {
  submit: () => void;
  reset: (values?: SchemaValues) => void;
  getValues: () => SchemaValues;
  form: UseFormReturn<SchemaValues>;
}

// ---------------------------------------------------------------------------
// Mounted-field registry: which paths render their own schema issues
// ---------------------------------------------------------------------------

interface FieldRegistry {
  add: (path: string, subtree: boolean) => () => void;
  /** True when a mounted field shows issues at `path` (its own path, or inside a leaf widget's subtree). */
  owns: (path: string) => boolean;
  subscribe: (listener: () => void) => () => void;
  version: () => number;
}

function createFieldRegistry(): FieldRegistry {
  const exact = new Map<string, number>();
  const subtrees = new Map<string, number>();
  const listeners = new Set<() => void>();
  let version = 0;
  const bump = () => {
    version += 1;
    for (const l of listeners) l();
  };
  const inc = (map: Map<string, number>, key: string, by: number) => {
    const next = (map.get(key) ?? 0) + by;
    if (next <= 0) map.delete(key);
    else map.set(key, next);
  };
  return {
    add(path, subtree) {
      const map = subtree ? subtrees : exact;
      inc(map, path, 1);
      bump();
      return () => {
        inc(map, path, -1);
        bump();
      };
    },
    owns(path) {
      if (exact.has(path) || subtrees.has(path)) return true;
      for (const prefix of subtrees.keys()) if (path.startsWith(`${prefix}.`)) return true;
      return false;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    version: () => version,
  };
}

interface SchemaFormContextValue {
  root: JsonSchema;
  layout: SchemaFormLayout;
  disabled: boolean;
  widgets: Record<string, SchemaWidget>;
  validator: SchemaValidator;
  registry: FieldRegistry;
  scope: ExpressionScope;
}

const NOOP_VALIDATOR: SchemaValidator = { validate: () => [] };

const SchemaFormMeta = createContext<SchemaFormContextValue>({
  root: {},
  layout: "stacked",
  disabled: false,
  widgets: {},
  validator: NOOP_VALIDATOR,
  registry: createFieldRegistry(),
  scope: DEFAULT_ENVIRONMENT.scope,
});

function useMeta(): SchemaFormContextValue {
  return useContext(SchemaFormMeta);
}

function useRegisterPath(path: string, subtree: boolean): void {
  const { registry } = useMeta();
  useEffect(() => registry.add(path, subtree), [registry, path, subtree]);
}

/** Issues a field at `name` shows: its own path, plus its subtree for leaf widgets (key/value maps, criteria, JSON). */
function ownIssues(issues: readonly SchemaIssue[], name: string, subtree: boolean): SchemaIssue[] {
  return issues.filter((i) => i.path === name || (subtree && i.path.startsWith(`${name}.`)));
}

function issueText(issue: SchemaIssue, name: string, label: string): string {
  const inner = issue.path === name ? "" : ` (${issue.path.slice(name.length + 1)})`;
  return `${label}${inner} ${issue.message}`;
}

// ---------------------------------------------------------------------------
// Widget resolution: x-ui.widget → optionsProvider → $ref → format → type
// ---------------------------------------------------------------------------

/** Widgets resolved from `format` (string fields only). */
const FORMAT_WIDGETS: Readonly<Record<string, string>> = {
  cron: "cron",
  uri: "uri",
  url: "uri",
  "date-time": "date-time",
  multiline: "textarea",
};

/**
 * Widget name a field resolves to, or null for structural fields (object
 * fieldset, list, discriminated union). Order (UI.md §5): `x-ui.widget` (or
 * the forms-only `x-ui-ext.widget`) → `x-ui.optionsProvider` (async
 * combobox) → `$ref` definition (`ref:<Name>`) → union → enum → `format`
 * (`cron`, `uri`, `date-time`, `multiline`; `x-secret` strings are masked) →
 * JSON type.
 */
export function resolveWidgetName(
  schema: JsonSchema,
  hints: FieldHints,
  ref: string | undefined,
  root: JsonSchema,
): string | null {
  const widget = hints.widget;
  if (widget === "list")
    return primaryType(schema) === "array"
      ? null
      : resolveWidgetName(schema, { ...hints, widget: undefined }, ref, root);
  if (widget === "hidden") return "hidden";
  if (
    hints.optionsProvider !== undefined &&
    (widget === undefined || widget === "select" || widget === "text" || widget === "combobox")
  )
    return "combobox";
  if (widget) {
    if (widget === "expression" && (schema.format === "multiline" || schema.format === "prompt"))
      return "expression-multiline";
    if (widget === "radio" && (schema.enum ?? [schema.const]).length > 4) return "select";
    return widget;
  }
  if (ref && getWidget(`ref:${ref}`)) return `ref:${ref}`;
  if (variantInfo(schema, root)) return null;
  const type = primaryType(schema);
  if (schema.enum || schema.const !== undefined) return "select";
  switch (type) {
    case "string": {
      const byFormat = schema.format !== undefined ? FORMAT_WIDGETS[schema.format] : undefined;
      if (byFormat) return byFormat;
      return schema["x-secret"] === true ? "secret" : "text";
    }
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "switch";
    case "object":
      return isMapSchema(schema) ? "keyvalue" : null;
    case "array":
      return null;
    case "null":
    case undefined:
      return "text";
    default:
      return "text";
  }
}

function isBlock(widgetName: string | null, schema: JsonSchema): boolean {
  if (widgetName === null) return true;
  if (widgetName === "expression-multiline") return true;
  if (widgetName === "template") return isMultilineTemplate(schema);
  return BLOCK_WIDGETS.has(widgetName) || (widgetName === "text" && schema.format === "multiline");
}

function lookupWidget(meta: SchemaFormContextValue, name: string): SchemaWidget | undefined {
  const key = name === "expression-multiline" ? "expression" : name;
  return meta.widgets[key] ?? getWidget(key);
}

// ---------------------------------------------------------------------------
// Field dispatch
// ---------------------------------------------------------------------------

interface FieldProps {
  name: string;
  schema: JsonSchema;
  hints: FieldHints;
  label: string;
  required: boolean;
  /** `$defs` name when declared through `$ref`. */
  defName?: string;
  depth: number;
  /** Omit the visible label (array items). */
  hideLabel?: boolean;
}

function SchemaField(props: FieldProps) {
  const { showWhen } = props.hints;
  if (showWhen) return <ConditionalField {...props} condition={showWhen} />;
  return <ResolvedField {...props} />;
}

/** `x-ui.showWhen`: renders the field only while the condition holds against the current values. */
function ConditionalField({
  condition,
  ...props
}: FieldProps & { condition: NonNullable<FieldHints["showWhen"]> }) {
  const { control } = useFormContext<SchemaValues>();
  const values = useWatch({ control });
  if (!evaluateShowWhen(condition, values)) return null;
  return <ResolvedField {...props} />;
}

function ResolvedField(props: FieldProps) {
  const meta = useMeta();
  const { schema, hints, name } = props;
  let widgetName = resolveWidgetName(schema, hints, props.defName, meta.root);
  if (widgetName === "hidden") return null;
  let Widget = widgetName === null ? undefined : lookupWidget(meta, widgetName);
  if (widgetName !== null && !Widget) {
    const fallback = resolveWidgetName(
      schema,
      { ...hints, widget: undefined, optionsProvider: undefined },
      props.defName,
      meta.root,
    );
    devWarn(
      `unknown widget "${widgetName}" for field "${name}"; rendering the ${fallback ?? "structural"} fallback. Register it with registerWidget("${widgetName}", Component).`,
    );
    widgetName = fallback === "hidden" ? null : fallback;
    Widget = widgetName === null ? undefined : lookupWidget(meta, widgetName);
  }
  const block = isBlock(widgetName, schema);
  const wrapperClass = meta.layout === "wide" && block ? "@md:col-span-2" : undefined;

  if (widgetName === null || !Widget) {
    const variant = variantInfo(schema, meta.root);
    if (variant) return <VariantField {...props} className={wrapperClass} />;
    if (primaryType(schema) === "array") return <ArrayField {...props} className={wrapperClass} />;
    if (primaryType(schema) === "object" || schema.properties)
      return <ObjectField {...props} className={wrapperClass} />;
    const text = getWidget("text");
    return text ? (
      <LeafField {...props} widget={text} widgetName="text" className={wrapperClass} />
    ) : null;
  }
  return <LeafField {...props} widget={Widget} widgetName={widgetName} className={wrapperClass} />;
}

// ---------------------------------------------------------------------------
// Leaf
// ---------------------------------------------------------------------------

interface LeafFieldProps extends FieldProps {
  widget: SchemaWidget;
  widgetName: string;
  className?: string;
}

function LeafField({
  name,
  schema,
  hints,
  label,
  required,
  widget: Widget,
  widgetName,
  className,
  hideLabel,
}: LeafFieldProps) {
  const meta = useMeta();
  const { control } = useFormContext<SchemaValues>();
  useRegisterPath(name, true);
  const bindable = hints.bindable === true && widgetName !== "binding";
  const isBindingWidget = widgetName === "binding";
  const rules = useMemo(() => buildRules(schema, { required, label }), [schema, required, label]);
  const { validator } = meta;
  const validate = useCallback(
    (value: unknown, formValues: SchemaValues): true | string => {
      if ((bindable || isBindingWidget) && isBinding(value) && value.kind !== "literal") {
        const problem = bindingProblem(value);
        return problem ? `${label}: ${problem}` : true;
      }
      const literal = bindable || isBindingWidget ? literalOf(value) : value;
      const ruled = rules.validate(literal);
      if (ruled !== true) return ruled;
      const issue = ownIssues(validator.validate(formValues), name, true)[0];
      return issue ? issueText(issue, name, label) : true;
    },
    [bindable, isBindingWidget, rules, validator, name, label],
  );
  const isSwitch = widgetName === "switch" && !bindable;
  // The gate editor renders its own label (it names the slider), so the row must not repeat it.
  const selfLabelled = widgetName === "threshold";
  const hint = hints.help ?? schema.description;
  return (
    <Controller
      name={name}
      control={control}
      rules={{ validate }}
      render={({ field, fieldState }) => {
        const error = fieldState.error?.message;
        const renderWidget = (value: unknown, onChange: (value: unknown) => void) => (
          <Widget
            name={name}
            schema={schema}
            hints={hints}
            label={label}
            value={value}
            onChange={onChange}
            onBlur={field.onBlur}
            disabled={meta.disabled}
            invalid={Boolean(error)}
            required={required}
            placeholder={hints.placeholder}
            aria-label={hideLabel ? label : undefined}
          />
        );
        const control = bindable ? (
          <BindingField
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            label={label}
            scope={meta.scope}
            renderLiteral={renderWidget}
            disabled={meta.disabled}
            invalid={Boolean(error)}
          />
        ) : (
          renderWidget(field.value, field.onChange)
        );
        if (isSwitch) {
          return (
            <SwitchRow
              name={name}
              label={hideLabel ? undefined : label}
              hint={hint}
              error={error}
              disabled={meta.disabled}
              className={className}
            >
              {control}
            </SwitchRow>
          );
        }
        return (
          <FieldRow
            label={hideLabel || selfLabelled ? undefined : label}
            hint={hint}
            error={error}
            required={required}
            disabled={meta.disabled}
            className={className}
          >
            {control}
          </FieldRow>
        );
      }}
    />
  );
}

/** Boolean fields: label and hint on the left, the switch on the right, at every width. */
function SwitchRow({
  name,
  label,
  hint,
  error,
  disabled,
  className,
  children,
}: {
  name: string;
  label?: string;
  hint?: string;
  error?: string;
  disabled: boolean;
  className?: string;
  children: ReactNode;
}) {
  const id = `switch-${name.replace(/[^\w-]/g, "_")}`;
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div
      className={cn("flex min-w-0 flex-col gap-1.5", className)}
      data-invalid={error ? "" : undefined}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5 pt-px">
          {label ? (
            <Label htmlFor={id} disabled={disabled}>
              {label}
            </Label>
          ) : null}
          {hint ? <FieldHint id={hintId}>{hint}</FieldHint> : null}
        </div>
        <div className="flex h-5 shrink-0 items-center [&_button]:shrink-0">
          <FieldRow htmlFor={id} className="contents" aria-describedby={hintId}>
            {children}
          </FieldRow>
        </div>
      </div>
      <FieldError>{error}</FieldError>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Object
// ---------------------------------------------------------------------------

interface StructuralProps extends FieldProps {
  className?: string;
}

function FieldGrid({ children, className }: { children: ReactNode; className?: string }) {
  const meta = useMeta();
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-4",
        meta.layout === "wide" && "@md:grid-cols-2 @md:gap-x-5",
        className,
      )}
    >
      {children}
    </div>
  );
}

function PropertyFields({
  name,
  schema,
  depth,
}: {
  name: string;
  schema: JsonSchema;
  depth: number;
}) {
  const meta = useMeta();
  const props = useMemo(() => orderedProperties(schema, meta.root), [schema, meta.root]);
  const groups = useMemo(() => groupProperties(props), [props]);
  const prefix = name ? `${name}.` : "";
  const renderList = (list: typeof props) =>
    list.map((p) => (
      <SchemaField
        key={p.key}
        name={`${prefix}${p.key}`}
        schema={p.schema}
        hints={p.hints}
        label={labelFor(p.key, p.schema)}
        required={p.required}
        defName={p.ref}
        depth={depth + 1}
      />
    ));
  return (
    <div className="flex flex-col gap-5">
      {groups.map((group) => (
        <section key={group.title ?? "__ungrouped"} className="flex flex-col gap-3">
          {group.title ? <h3 className="text-eyebrow">{group.title}</h3> : null}
          {group.fields.length > 0 ? <FieldGrid>{renderList(group.fields)}</FieldGrid> : null}
          {group.collapsed.length > 0 ? (
            <Collapsible
              title="Advanced"
              meta={String(group.collapsed.length)}
              contentClassName="pl-0 pt-2"
            >
              <FieldGrid>{renderList(group.collapsed)}</FieldGrid>
            </Collapsible>
          ) : null}
        </section>
      ))}
    </div>
  );
}

/** Object fieldset (`x-ui.group` sections inside); `x-ui.collapsed` starts it closed. */
function ObjectField({ name, schema, hints, label, depth, className, hideLabel }: StructuralProps) {
  const { control } = useFormContext<SchemaValues>();
  const { fieldState } = useController({ name, control });
  const error =
    typeof fieldState.error?.message === "string" ? fieldState.error.message : undefined;
  const description = hints.help ?? schema.description;
  if (hideLabel) {
    return (
      <div className={cn("flex flex-col gap-3", className)}>
        <PropertyFields name={name} schema={schema} depth={depth} />
        {error ? <FieldError>{error}</FieldError> : null}
      </div>
    );
  }
  return (
    <Collapsible
      title={label}
      defaultOpen={hints.collapsed !== true || !isFieldset(schema, hints)}
      className={cn("rounded-sm border border-border bg-surface-2/60 px-2 py-1", className)}
      contentClassName="pl-0 pr-1 pb-2 pt-2"
      data-collapsed-hint={hints.collapsed === true ? "" : undefined}
    >
      {description ? <p className="mb-3 text-xs text-ink-3">{description}</p> : null}
      <PropertyFields name={name} schema={schema} depth={depth} />
      {error ? <FieldError className="mt-2">{error}</FieldError> : null}
    </Collapsible>
  );
}

// ---------------------------------------------------------------------------
// Variant (discriminated union) → segmented control
// ---------------------------------------------------------------------------

function VariantField({ name, schema, hints, label, required, depth, className }: StructuralProps) {
  const meta = useMeta();
  const { control, setValue } = useFormContext<SchemaValues>();
  const info = useMemo(() => variantInfo(schema, meta.root), [schema, meta.root]);
  const current = useWatch({ control, name: info ? `${name}.${info.discriminator}` : name });
  useRegisterPath(info ? `${name}.${info.discriminator}` : name, false);
  if (!info) return null;
  const selected = info.variants.find((v) => v.value === enumKey(current)) ?? info.variants[0];
  const rest: JsonSchema | null = selected
    ? {
        ...selected.schema,
        properties: Object.fromEntries(
          Object.entries(selected.schema.properties ?? {}).filter(
            ([k]) => k !== info.discriminator,
          ),
        ),
      }
    : null;
  const hasRest = rest ? Object.keys(rest.properties ?? {}).length > 0 : false;
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <FieldRow
        label={label}
        hint={selected?.schema.description ?? hints.help ?? schema.description}
        required={required}
        disabled={meta.disabled}
      >
        <ToggleGroup
          type="single"
          value={selected?.value ?? ""}
          disabled={meta.disabled}
          aria-label={label}
          className="h-auto flex-wrap"
          onValueChange={(v) => {
            const next = info.variants.find((x) => x.value === v);
            if (!next || next.value === selected?.value) return;
            setValue(name, defaultValueFor(next.schema, meta.root), {
              shouldDirty: true,
              shouldValidate: true,
            });
          }}
        >
          {info.variants.map((v) => (
            <Tooltip key={v.value} content={v.schema.description}>
              <ToggleGroupItem value={v.value}>{v.label}</ToggleGroupItem>
            </Tooltip>
          ))}
        </ToggleGroup>
      </FieldRow>
      {rest && hasRest ? (
        <div className="border-l-2 border-border pl-3">
          <PropertyFields name={name} schema={rest} depth={depth} />
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Array (repeatable list)
// ---------------------------------------------------------------------------

let keySeq = 0;
function nextKey(): string {
  keySeq += 1;
  return `k${keySeq}`;
}

function singular(label: string): string {
  return label.endsWith("s") && label.length > 1 ? label.slice(0, -1) : label;
}

/** Repeatable list (`array`, `x-ui.widget: 'list'`): add / remove / reorder within `minItems`/`maxItems` (or `x-ui.min`/`max`). */
function ArrayField({
  name,
  schema: rawSchema,
  hints,
  label,
  required,
  depth,
  className,
}: StructuralProps) {
  const meta = useMeta();
  const { control } = useFormContext<SchemaValues>();
  const schema = useMemo<JsonSchema>(
    () => ({
      ...rawSchema,
      minItems: rawSchema.minItems ?? hints.min,
      maxItems: rawSchema.maxItems ?? hints.max,
    }),
    [rawSchema, hints.min, hints.max],
  );
  useRegisterPath(name, false);
  const rules = useMemo(() => buildRules(schema, { required, label }), [schema, required, label]);
  const { validator } = meta;
  const validate = useCallback(
    (value: unknown, formValues: SchemaValues): true | string => {
      const ruled = rules.validate(value);
      if (ruled !== true) return ruled;
      const issue = ownIssues(validator.validate(formValues), name, false)[0];
      return issue ? issueText(issue, name, label) : true;
    },
    [rules, validator, name, label],
  );
  const { field, fieldState } = useController({ name, control, rules: { validate } });
  // The controller's own value only updates on whole-array writes; watch the path so item edits are seen too.
  const watched: unknown = useWatch({ control, name });
  const items: unknown[] = Array.isArray(watched) ? watched : [];
  const itemSchema = useMemo(
    () => resolveSchema(schema.items ?? {}, meta.root),
    [schema.items, meta.root],
  );
  const itemHints = useMemo(() => hintsOf(itemSchema), [itemSchema]);
  const itemWidget = resolveWidgetName(itemSchema, itemHints, undefined, meta.root);
  const itemIsObject = itemWidget === null && primaryType(itemSchema) === "object";
  const [keys, setKeys] = useState<string[]>(() => items.map(() => nextKey()));
  if (keys.length !== items.length) {
    const next = keys.slice(0, items.length);
    while (next.length < items.length) next.push(nextKey());
    setKeys(next);
  }
  const atMax = schema.maxItems !== undefined && items.length >= schema.maxItems;
  const atMin = schema.minItems !== undefined && items.length <= schema.minItems;
  const itemLabel = singular(label);
  const error = fieldState.error?.message;

  const commit = (nextItems: unknown[], nextKeys: string[]) => {
    setKeys(nextKeys);
    field.onChange(nextItems);
  };

  return (
    <FieldRow
      label={label}
      hint={hints.help ?? schema.description}
      error={error}
      required={required}
      disabled={meta.disabled}
      className={className}
    >
      <div className="flex flex-col gap-1.5">
        {items.length === 0 ? (
          <p className="flex h-7 items-center rounded-sm border border-dashed border-border px-2 text-xs text-ink-3">
            No {label.toLowerCase()} yet.
          </p>
        ) : null}
        <ReorderableList
          items={items}
          keyOf={(_item, i) => keys[i] ?? String(i)}
          disabled={meta.disabled}
          label={label}
          onReorder={(next, order) => {
            commit(
              next,
              order.map((i) => keys[i] ?? nextKey()),
            );
          }}
          renderItem={(_item, index, handle) => (
            <div
              className={cn(
                "flex items-start gap-1",
                itemIsObject && "rounded-sm border border-border bg-surface p-2 pr-1",
              )}
            >
              <div className={cn("shrink-0", !itemIsObject && "self-center")}>{handle}</div>
              <div className="min-w-0 flex-1">
                <SchemaField
                  name={`${name}.${index}`}
                  schema={itemSchema}
                  hints={itemHints}
                  label={`${itemLabel} ${index + 1}`}
                  required={true}
                  depth={depth + 1}
                  hideLabel
                />
              </div>
              <IconButton
                label={`Remove ${itemLabel.toLowerCase()} ${index + 1}`}
                size="sm"
                variant="ghost"
                disabled={meta.disabled || atMin}
                className="shrink-0 self-center"
                onClick={() =>
                  commit(
                    items.filter((_, i) => i !== index),
                    keys.filter((_, i) => i !== index),
                  )
                }
              >
                <X strokeWidth={1.75} />
              </IconButton>
            </div>
          )}
        />
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            leadingIcon={<Plus />}
            disabled={meta.disabled || atMax}
            onClick={() =>
              commit(
                [
                  ...items,
                  defaultValueFor(itemSchema, meta.root) ??
                    (primaryType(itemSchema) === "string" ? "" : undefined),
                ],
                [...keys, nextKey()],
              )
            }
          >
            Add {itemLabel.toLowerCase()}
          </Button>
          {schema.maxItems !== undefined || schema.minItems !== undefined ? (
            <span className="ml-auto font-mono text-2xs text-ink-3 tabular">
              {schema.maxItems !== undefined
                ? `${items.length} / ${schema.maxItems}`
                : `${items.length} (min ${schema.minItems ?? 0})`}
            </span>
          ) : null}
        </div>
      </div>
    </FieldRow>
  );
}

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------

/** Schema issues no mounted field shows (root-level keywords, collapsed or hidden-widget fields, discriminators). */
function useUnclaimedIssues(values: SchemaValues): SchemaIssue[] {
  const { validator, registry } = useMeta();
  const version = useSyncExternalStore(registry.subscribe, registry.version, registry.version);
  return useMemo(() => {
    void version;
    return validator.validate(values).filter((issue) => !registry.owns(issue.path));
  }, [validator, registry, values, version]);
}

function ChangeBridge({
  control,
  onChange,
}: {
  control: Control<SchemaValues>;
  onChange?: (values: SchemaValues, isValid: boolean) => void;
}) {
  const values = useWatch({ control });
  const { isValid } = useFormState({ control });
  const unclaimed = useUnclaimedIssues(values);
  const onChangeRef = useLatestRef(onChange);
  const first = useRef(true);
  const valid = isValid && unclaimed.length === 0;
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    onChangeRef.current?.(values, valid);
  }, [values, valid, onChangeRef]);
  return null;
}

/** Lists the schema issues no field shows, once the person has edited or submitted the form. */
function SchemaIssueSummary({ control }: { control: Control<SchemaValues> }) {
  const meta = useMeta();
  const values = useWatch({ control });
  const { isDirty, submitCount } = useFormState({ control });
  const unclaimed = useUnclaimedIssues(values);
  if (unclaimed.length === 0 || (!isDirty && submitCount === 0)) return null;
  return (
    <div
      role="alert"
      className="flex flex-col gap-1 rounded-sm border border-danger/40 bg-danger/5 px-2.5 py-2 text-xs text-danger-text"
    >
      {unclaimed.map((issue) => (
        <p key={`${issue.path}-${issue.keyword}`}>
          {labelForPath(issue.path, meta.root)} {issue.message}
        </p>
      ))}
    </div>
  );
}

/**
 * Renders a JSON Schema (a manifest `configSchema` or an app-defined schema,
 * `$ref`/`$defs` aware) as a react-hook-form form. Widgets come from
 * `x-ui` hints (RFC-0012; `x-flowaid` is read for one release) in the order
 * `x-ui.widget → format → type`; `x-ui.showWhen` hides fields, `collapsed`
 * closes fieldsets (and moves leaves under "Advanced"), `optionsProvider`
 * loads options through `loadOptions`, `bindable` wraps the widget in a
 * `BindingField`, discriminated `oneOf` renders a segmented control and
 * arrays a repeatable list. Values are validated by the field rules and by
 * ajv against the whole schema; `onChange` reports overall validity.
 * `secretSlots` renders the node's credential slots above the fields.
 */
export const SchemaForm = forwardRef<SchemaFormHandle, SchemaFormProps>(function SchemaForm(
  {
    schema,
    values,
    defaultValues,
    onChange,
    onSubmit,
    layout = "stacked",
    disabled = false,
    scope,
    credentials,
    onCreateCredential,
    models,
    irreversible = false,
    confidenceSamples,
    nodeType,
    loadOptions,
    secretSlots,
    widgets,
    id,
    className,
    children,
    "aria-label": ariaLabel,
  },
  ref,
) {
  const initial = useMemo(
    () => withDefaults(schema, values ?? defaultValues),
    [schema, values, defaultValues],
  );
  const form = useForm<SchemaValues>({
    defaultValues: initial,
    mode: "onChange",
    reValidateMode: "onChange",
  });
  const { reset, getValues } = form;
  const validator = useMemo(() => createSchemaValidator(schema), [schema]);
  const [registry] = useState(createFieldRegistry);

  const firstValues = useRef(true);
  useEffect(() => {
    if (firstValues.current) {
      firstValues.current = false;
      return;
    }
    reset(withDefaults(schema, values));
  }, [values, schema, reset]);

  const onSubmitRef = useLatestRef(onSubmit);
  const runSubmit = useCallback(
    (event?: FormEvent<HTMLFormElement>) =>
      form.handleSubmit((v) => {
        const blocking = validator.validate(v).filter((issue) => !registry.owns(issue.path));
        if (blocking.length > 0) return;
        onSubmitRef.current?.(v);
      })(event),
    [form, validator, registry, onSubmitRef],
  );

  useImperativeHandle(
    ref,
    () => ({
      submit: () => {
        void runSubmit();
      },
      reset: (next) => reset(withDefaults(schema, next ?? values ?? defaultValues)),
      getValues: () => form.getValues(),
      form,
    }),
    [form, reset, schema, values, defaultValues, runSubmit],
  );

  const env = useMemo<SchemaFormEnvironment>(
    () => ({
      scope: scope ?? DEFAULT_ENVIRONMENT.scope,
      credentials: credentials ?? DEFAULT_ENVIRONMENT.credentials,
      onCreateCredential,
      models: models ?? DEFAULT_ENVIRONMENT.models,
      irreversible,
      confidenceSamples,
      nodeType,
      loadOptions,
      getValues,
    }),
    [
      scope,
      credentials,
      onCreateCredential,
      models,
      irreversible,
      confidenceSamples,
      nodeType,
      loadOptions,
      getValues,
    ],
  );
  const meta = useMemo<SchemaFormContextValue>(
    () => ({
      root: schema,
      layout,
      disabled,
      widgets: widgets ?? {},
      validator,
      registry,
      scope: env.scope,
    }),
    [schema, layout, disabled, widgets, validator, registry, env.scope],
  );
  const rootSchema = useMemo(() => resolveSchema(schema, schema), [schema]);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    e.stopPropagation();
    void runSubmit(e);
  };

  return (
    <FormProvider {...form}>
      <SchemaFormEnvironmentContext.Provider value={env}>
        <SchemaFormMeta.Provider value={meta}>
          <form
            id={id}
            onSubmit={submit}
            noValidate
            aria-label={ariaLabel}
            className={cn("@container flex min-w-0 flex-col gap-4", className)}
          >
            <ChangeBridge control={form.control} onChange={onChange} />
            {secretSlots ? <SecretSlotPicker disabled={disabled} {...secretSlots} /> : null}
            <PropertyFields name="" schema={rootSchema} depth={0} />
            <SchemaIssueSummary control={form.control} />
            {children}
          </form>
        </SchemaFormMeta.Provider>
      </SchemaFormEnvironmentContext.Provider>
    </FormProvider>
  );
});
