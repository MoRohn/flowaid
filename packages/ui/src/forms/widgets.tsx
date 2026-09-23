/**
 * SchemaForm widget registry. A widget renders one leaf field; SchemaForm
 * picks it from `x-ui.widget` (or the forms-only `x-ui-ext.widget`), then from
 * `x-ui.optionsProvider` (async combobox), the `$ref` definition name
 * (`ref:RetryPolicy`), `format` (`cron`, `uri`, `date-time`, `multiline`) and
 * finally the JSON type. Other packages extend the set with
 * `registerWidget(name, Component)`.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ComponentType } from "react";
import { Eye, EyeOff } from "lucide-react";
import type {
  ConfidenceThresholds,
  CredentialView,
  ExpressionScope,
  JsonSchema,
  ModelView,
} from "@/types";
import type { FieldHints, SchemaValues } from "./schema";
import {
  IconButton,
  Input,
  NumberInput,
  RadioGroup,
  RadioItem,
  Select,
  SelectItem,
  Slider,
  Switch,
  Textarea,
} from "@/primitives";
import { BindingField } from "./BindingField";
import { CodeEditor, type CodeLanguage } from "./CodeEditor";
import { Combobox, type OptionItem } from "./Combobox";
import { CredentialPicker } from "./CredentialPicker";
import { CriteriaEditor, type DecisionCriteria } from "./CriteriaEditor";
import { CronEditor } from "./CronEditor";
import { JsonSchemaEditor } from "./JsonSchemaEditor";
import { LevelsList } from "./LevelsList";
import { TemplateEditor, type TemplateRef } from "./TemplateEditor";
import { ExpressionInput, ExpressionTextarea } from "./ExpressionInput";
import { KeyValueEditor, type KeyValueRow } from "./KeyValueEditor";
import { ModelPicker } from "./ModelPicker";
import { QuestionsEditor, type BatchQuestions } from "./QuestionsEditor";
import { RetryPolicyEditor, type RetryPolicy, DEFAULT_RETRY_POLICY } from "./RetryPolicyEditor";
import { ThresholdField, DEFAULT_THRESHOLDS } from "./ThresholdField";
import { enumKey, enumOptions, inputModeFor, isRecord, primaryType } from "./schema";
import { EMPTY_SCOPE } from "./expressionExtensions";

export interface SchemaWidgetProps {
  /** Dotted path of the field in the form values. */
  name: string;
  /** Resolved schema for the field. */
  schema: JsonSchema;
  hints: FieldHints;
  label: string;
  value: unknown;
  onChange: (value: unknown) => void;
  onBlur: () => void;
  disabled?: boolean;
  invalid?: boolean;
  required?: boolean;
  placeholder?: string;
  /** Accessible name when the visible label is omitted (array items) or the control is not labelable. */
  "aria-label"?: string;
}

export type SchemaWidget = ComponentType<SchemaWidgetProps>;

/**
 * Loads the options of a manifest option provider (`x-ui.optionsProvider`):
 * the app calls `POST /v1/nodes/:type/options/:name` with `{ config, search }`
 * and resolves the `OptionItem[]`.
 */
export type LoadOptions = (
  nodeType: string,
  name: string,
  config: SchemaValues,
  search: string,
) => Promise<OptionItem[]>;

/** Environment the widgets read: expression scope, credentials, models, node flags, option loading. */
export interface SchemaFormEnvironment {
  scope: ExpressionScope;
  credentials: CredentialView[];
  onCreateCredential?: (credentialType?: string) => void;
  models: ModelView[];
  /** The node performs an irreversible action (retry widgets refuse retries). */
  irreversible: boolean;
  /** Historic decision confidences shown by the threshold widget. */
  confidenceSamples?: number[];
  /** Node type id of the manifest the form edits (`flowaid.tools.mcp`), passed to `loadOptions`. */
  nodeType?: string;
  /** Option-provider callback for `x-ui.optionsProvider` fields. */
  loadOptions?: LoadOptions;
  /** Current form values (the node config), sent with option requests. */
  getValues: () => SchemaValues;
  /** Upstream references for `template` fields (FlowExpr `node.port`); without it they use `scope`. */
  templateRefs?: readonly TemplateRef[];
  /** Workflow variable names (`$vars.*`). */
  variables?: readonly string[];
  /** The node sits inside a loop or foreach body (`$scope.*` is available). */
  inContainer?: boolean;
}

export const DEFAULT_ENVIRONMENT: SchemaFormEnvironment = {
  scope: EMPTY_SCOPE,
  credentials: [],
  models: [],
  irreversible: false,
  getValues: () => ({}),
};

export const SchemaFormEnvironmentContext =
  createContext<SchemaFormEnvironment>(DEFAULT_ENVIRONMENT);

export function useSchemaFormEnvironment(): SchemaFormEnvironment {
  return useContext(SchemaFormEnvironmentContext);
}

const registry = new Map<string, SchemaWidget>();

/** Registers (or replaces) a widget by name: an `x-ui` / `x-ui-ext` widget name, a `format` widget, or `ref:<DefName>` for `$ref` fields. */
export function registerWidget(name: string, component: SchemaWidget): void {
  registry.set(name, component);
}

export function getWidget(name: string): SchemaWidget | undefined {
  return registry.get(name);
}

export function listWidgets(): string[] {
  return [...registry.keys()];
}

/** Widgets that take the full row (both columns in the wide layout). */
export const BLOCK_WIDGETS = new Set<string>([
  "textarea",
  "template-multiline",
  "code",
  "json",
  "keyvalue",
  "criteria",
  "schema",
  "questions",
  "threshold",
  "retry-policy",
  "ref:RetryPolicy",
  "expression-multiline",
  "binding",
]);

// ---------------------------------------------------------------------------
// Built-in widgets
// ---------------------------------------------------------------------------

function asString(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export function TextWidget({
  schema,
  hints,
  value,
  onChange,
  onBlur,
  placeholder,
  disabled,
  "aria-label": ariaLabel,
}: SchemaWidgetProps) {
  const mono =
    hints.widget === "code" ||
    schema.format === "uri" ||
    schema.format === "url" ||
    schema.pattern !== undefined;
  return (
    <Input
      aria-label={ariaLabel}
      value={asString(value)}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      placeholder={placeholder}
      inputMode={inputModeFor(schema)}
      type={schema.format === "email" ? "email" : "text"}
      mono={mono}
      disabled={disabled}
      maxLength={schema.maxLength}
      autoComplete="off"
      spellCheck={!mono}
    />
  );
}

export function TextareaWidget({
  schema,
  value,
  onChange,
  onBlur,
  placeholder,
  disabled,
  "aria-label": ariaLabel,
}: SchemaWidgetProps) {
  return (
    <Textarea
      aria-label={ariaLabel}
      value={asString(value)}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      placeholder={placeholder}
      autoGrow
      minRows={3}
      maxRows={12}
      maxLength={schema.maxLength}
      disabled={disabled}
    />
  );
}

export function SecretWidget({
  value,
  onChange,
  onBlur,
  placeholder,
  disabled,
  "aria-label": ariaLabel,
}: SchemaWidgetProps) {
  const [revealed, setRevealed] = useState(false);
  return (
    <Input
      aria-label={ariaLabel}
      type={revealed ? "text" : "password"}
      mono
      value={asString(value)}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      placeholder={placeholder}
      disabled={disabled}
      autoComplete="new-password"
      spellCheck={false}
      trailing={
        <IconButton
          label={revealed ? "Hide value" : "Reveal value"}
          size="xs"
          variant="ghost"
          onClick={() => setRevealed((r) => !r)}
          disabled={disabled}
        >
          {revealed ? <EyeOff strokeWidth={1.75} /> : <Eye strokeWidth={1.75} />}
        </IconButton>
      }
    />
  );
}

/** Bounds and step of a numeric field: the schema keywords, then the `x-ui` `min` / `max` / `step` hints. */
function numberProps(schema: JsonSchema, hints: FieldHints) {
  const min =
    schema.minimum ??
    (schema.exclusiveMinimum !== undefined
      ? schema.exclusiveMinimum + (schema.multipleOf ?? 1)
      : hints.min);
  const max =
    schema.maximum ??
    (schema.exclusiveMaximum !== undefined
      ? schema.exclusiveMaximum - (schema.multipleOf ?? 1)
      : hints.max);
  const step = schema.multipleOf ?? hints.step ?? (schema.type === "integer" ? 1 : undefined);
  return { min, max, step };
}

export function NumberWidget({
  schema,
  hints,
  value,
  onChange,
  onBlur,
  placeholder,
  disabled,
  "aria-label": ariaLabel,
}: SchemaWidgetProps) {
  const { min, max, step } = numberProps(schema, hints);
  const isInteger = schema.type === "integer";
  return (
    <NumberInput
      aria-label={ariaLabel}
      value={typeof value === "number" ? value : null}
      onValueChange={(n) => onChange(n === null ? undefined : n)}
      onBlur={onBlur}
      min={min}
      max={max}
      step={step ?? (isInteger ? 1 : 0.1)}
      precision={isInteger ? 0 : undefined}
      placeholder={placeholder}
      disabled={disabled}
    />
  );
}

export function SliderWidget({
  schema,
  hints,
  value,
  onChange,
  onBlur,
  disabled,
  label,
  "aria-label": ariaLabel,
}: SchemaWidgetProps) {
  const { min = 0, max = 1, step } = numberProps(schema, hints);
  const stepValue = step ?? (max - min > 10 ? 1 : 0.01);
  const current =
    typeof value === "number" ? value : typeof schema.default === "number" ? schema.default : min;
  return (
    <Slider
      min={min}
      max={max}
      step={stepValue}
      value={[current]}
      onValueChange={([v]) => {
        if (v !== undefined) onChange(v);
      }}
      onBlur={onBlur}
      showValue
      thumbLabels={[ariaLabel ?? label]}
      formatValue={(v) => (Number.isInteger(stepValue) ? String(v) : v.toFixed(2))}
      disabled={disabled}
    />
  );
}

export function SwitchWidget({
  value,
  onChange,
  onBlur,
  disabled,
  "aria-label": ariaLabel,
}: SchemaWidgetProps) {
  return (
    <Switch
      aria-label={ariaLabel}
      checked={value === true}
      onCheckedChange={(c) => onChange(c)}
      onBlur={onBlur}
      disabled={disabled}
    />
  );
}

function enumValueFor(schema: JsonSchema, text: string): unknown {
  const values = schema.enum ?? (schema.const !== undefined ? [schema.const] : []);
  return values.find((v) => enumKey(v) === text) ?? text;
}

export function SelectWidget({
  schema,
  value,
  onChange,
  placeholder,
  disabled,
  "aria-label": ariaLabel,
}: SchemaWidgetProps) {
  const options = enumOptions(schema);
  return (
    <Select
      aria-label={ariaLabel}
      value={value === undefined || value === null ? undefined : enumKey(value)}
      onValueChange={(v) => onChange(enumValueFor(schema, v))}
      placeholder={placeholder ?? "Choose…"}
      disabled={disabled}
      mono={options.every((o) => /^[A-Z0-9_-]+$/.test(o.value))}
    >
      {options.map((o) => (
        <SelectItem key={o.value} value={o.value}>
          {o.label}
        </SelectItem>
      ))}
    </Select>
  );
}

export function RadioWidget({
  schema,
  value,
  onChange,
  disabled,
  label,
  "aria-label": ariaLabel,
}: SchemaWidgetProps) {
  const options = enumOptions(schema);
  return (
    <RadioGroup
      aria-label={ariaLabel ?? label}
      value={value === undefined || value === null ? undefined : enumKey(value)}
      onValueChange={(v) => onChange(enumValueFor(schema, v))}
      disabled={disabled}
      orientation={options.length <= 2 ? "horizontal" : "vertical"}
    >
      {options.map((o) => (
        <RadioItem key={o.value} value={o.value} label={o.label} />
      ))}
    </RadioGroup>
  );
}

export function ExpressionWidget({
  schema,
  value,
  onChange,
  placeholder,
  disabled,
  label,
  "aria-label": ariaLabel,
}: SchemaWidgetProps) {
  const env = useSchemaFormEnvironment();
  const multiline = schema.format === "multiline" || schema.format === "prompt";
  const name = ariaLabel ?? label;
  if (multiline) {
    return (
      <ExpressionTextarea
        aria-label={name}
        scope={env.scope}
        value={asString(value)}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
      />
    );
  }
  return (
    <ExpressionInput
      aria-label={name}
      scope={env.scope}
      value={asString(value)}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
    />
  );
}

function codeLanguage(hints: FieldHints, fallback: CodeLanguage): CodeLanguage {
  return hints.language ?? fallback;
}

export function CodeWidget({
  hints,
  value,
  onChange,
  placeholder,
  disabled,
  "aria-label": ariaLabel,
}: SchemaWidgetProps) {
  return (
    <CodeEditor
      aria-label={ariaLabel}
      language={codeLanguage(hints, "javascript")}
      value={asString(value)}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
    />
  );
}

/**
 * JSON editor. For string fields the text is the value; for object/array
 * fields the parsed value is emitted while the text is valid JSON, and the
 * raw text otherwise (which the field rule reports as "must be valid JSON").
 */
export function JsonWidget({
  schema,
  value,
  onChange,
  placeholder,
  disabled,
  "aria-label": ariaLabel,
}: SchemaWidgetProps) {
  const isText = schema.type === "string";
  const [text, setText] = useState(() =>
    typeof value === "string" ? value : value === undefined ? "" : JSON.stringify(value, null, 2),
  );
  const serialised = useMemo(
    () =>
      typeof value === "string" ? value : value === undefined ? "" : JSON.stringify(value, null, 2),
    [value],
  );
  // External reset: adopt the new value when it no longer matches what we emitted.
  const [lastEmitted, setLastEmitted] = useState<unknown>(value);
  if (value !== lastEmitted) {
    setLastEmitted(value);
    if (serialised !== text) setText(serialised);
  }
  const handleChange = (next: string) => {
    setText(next);
    if (isText) {
      setLastEmitted(next);
      onChange(next);
      return;
    }
    if (next.trim() === "") {
      setLastEmitted(undefined);
      onChange(undefined);
      return;
    }
    try {
      const parsed: unknown = JSON.parse(next);
      setLastEmitted(parsed);
      onChange(parsed);
    } catch {
      setLastEmitted(next);
      onChange(next);
    }
  };
  return (
    <CodeEditor
      aria-label={ariaLabel}
      language="json"
      value={text}
      onChange={handleChange}
      placeholder={placeholder ?? "{}"}
      disabled={disabled}
      minRows={4}
    />
  );
}

/**
 * `x-ui.widget: "schema"`: a JSON Schema, edited as JSON. A schema is always an object, so any
 * other JSON value (or text that does not parse) is flagged instead of being accepted.
 */
export function SchemaJsonWidget({
  value,
  onChange,
  disabled,
  label,
  "aria-label": ariaLabel,
}: SchemaWidgetProps) {
  return (
    <JsonSchemaEditor
      aria-label={ariaLabel ?? label ?? "Schema"}
      value={isRecord(value) ? value : undefined}
      onChange={onChange}
      disabled={disabled}
    />
  );
}

export function LevelsWidget({
  value,
  onChange,
  disabled,
  label,
  "aria-label": ariaLabel,
}: SchemaWidgetProps) {
  const levels = Array.isArray(value)
    ? value.map((l) => (typeof l === "string" ? l : ""))
    : ["", ""];
  return (
    <LevelsList
      aria-label={ariaLabel ?? label ?? "Levels"}
      value={levels}
      onChange={onChange}
      disabled={disabled}
    />
  );
}

function isQuestions(value: unknown): value is BatchQuestions {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (q) =>
        isRecord(q) &&
        (q.kind === "boolean" || q.kind === "choice" || q.kind === "score") &&
        typeof q.instructions === "string",
    )
  );
}

/** `x-ui.widget: "questions"`: the question set of a decision batch. */
export function QuestionsWidget({
  value,
  onChange,
  disabled,
  label,
  "aria-label": ariaLabel,
}: SchemaWidgetProps) {
  return (
    <QuestionsEditor
      aria-label={ariaLabel ?? label}
      value={isQuestions(value) ? value : {}}
      onChange={onChange}
      disabled={disabled}
    />
  );
}

export function CredentialWidget({
  hints,
  value,
  onChange,
  disabled,
  "aria-label": ariaLabel,
}: SchemaWidgetProps) {
  const env = useSchemaFormEnvironment();
  return (
    <CredentialPicker
      aria-label={ariaLabel}
      credentials={env.credentials}
      credentialType={hints.credentialType}
      value={typeof value === "string" ? value : null}
      onValueChange={onChange}
      onCreate={env.onCreateCredential}
      disabled={disabled}
    />
  );
}

/** The model id a model field holds: a plain id, or the `model` of a `ModelRef { provider, model }`. */
function modelIdOf(value: unknown, models: readonly ModelView[]): string | null {
  if (typeof value === "string") return value;
  if (!isRecord(value) || typeof value.model !== "string") return null;
  const { provider, model } = value;
  const match = models.find(
    (m) =>
      m.id === model &&
      (typeof provider !== "string" || m.provider.toLowerCase() === provider.toLowerCase()),
  );
  return match?.id ?? model;
}

/**
 * Model picker. A string field stores the model id; an object field (the
 * manifest `ModelRefSchema`, `{ provider, model }`) stores the ref.
 */
export function ModelWidget({
  schema,
  hints,
  value,
  onChange,
  disabled,
  invalid,
  "aria-label": ariaLabel,
}: SchemaWidgetProps) {
  const env = useSchemaFormEnvironment();
  const asRef = primaryType(schema) === "object";
  return (
    <ModelPicker
      aria-label={ariaLabel}
      models={env.models}
      kind={hints.modelKind}
      value={modelIdOf(value, env.models)}
      onValueChange={(id, model) => onChange(asRef ? { provider: model.provider, model: id } : id)}
      invalid={invalid}
      disabled={disabled}
    />
  );
}

function rowsFromRecord(value: unknown): KeyValueRow[] {
  if (!isRecord(value)) return [];
  return Object.entries(value).map(([key, v]) => ({ key, value: asString(v) }));
}

function recordFromRows(rows: KeyValueRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) if (r.key.trim() !== "") out[r.key.trim()] = r.value;
  return out;
}

/** Key/value map editor. Rows with empty keys stay local until named. */
export function KeyValueWidget({
  value,
  onChange,
  disabled,
  label,
  "aria-label": ariaLabel,
}: SchemaWidgetProps) {
  const [rows, setRows] = useState<KeyValueRow[]>(() => rowsFromRecord(value));
  const [lastEmitted, setLastEmitted] = useState<unknown>(value);
  if (value !== lastEmitted) {
    setLastEmitted(value);
    const external = rowsFromRecord(value);
    const externalRecord = JSON.stringify(recordFromRows(external));
    if (externalRecord !== JSON.stringify(recordFromRows(rows))) setRows(external);
  }
  return (
    <KeyValueEditor
      aria-label={ariaLabel ?? label}
      value={rows}
      onChange={(next) => {
        setRows(next);
        const record = recordFromRows(next);
        setLastEmitted(record);
        onChange(record);
      }}
      disabled={disabled}
      keyPlaceholder={label.toLowerCase().includes("header") ? "Content-Type" : "KEY"}
      valuePlaceholder={label.toLowerCase().includes("header") ? "application/json" : "value"}
    />
  );
}

function isThresholds(value: unknown): value is ConfidenceThresholds {
  return isRecord(value) && typeof value.review === "number" && typeof value.auto === "number";
}

export function ThresholdWidget({
  value,
  onChange,
  disabled,
  label,
  "aria-label": ariaLabel,
}: SchemaWidgetProps) {
  const env = useSchemaFormEnvironment();
  return (
    <ThresholdField
      label={ariaLabel ?? label}
      value={isThresholds(value) ? value : DEFAULT_THRESHOLDS}
      onChange={onChange}
      samples={env.confidenceSamples}
      disabled={disabled}
    />
  );
}

function isCriteria(value: unknown): value is DecisionCriteria {
  if (!isRecord(value)) return false;
  if (value.kind === "choice") return Array.isArray(value.options);
  if (value.kind === "score") return Array.isArray(value.levels);
  return value.kind === "boolean";
}

function lockedKind(schema: JsonSchema): DecisionCriteria["kind"] | undefined {
  const k = schema.properties?.kind?.const;
  return k === "choice" || k === "score" || k === "boolean" ? k : undefined;
}

/** Manifest criteria shapes (fixtures/manifests): boolean `{ true, false }` descriptions, or a choice `options` map. */
type ManifestCriteriaShape = "boolean-pair" | "choice-map" | null;

function manifestCriteriaShape(schema: JsonSchema): ManifestCriteriaShape {
  const props = schema.properties;
  if (props && "true" in props && "false" in props) return "boolean-pair";
  if (primaryType(schema) === "object" && !props && isRecord(schema.additionalProperties))
    return "choice-map";
  return null;
}

function criteriaFromManifest(
  shape: ManifestCriteriaShape,
  value: unknown,
): DecisionCriteria | undefined {
  if (shape === "boolean-pair") {
    const pair = isRecord(value) ? value : {};
    return {
      kind: "boolean",
      trueCriteria: typeof pair.true === "string" ? pair.true : "",
      falseCriteria: typeof pair.false === "string" ? pair.false : "",
    };
  }
  if (shape === "choice-map") {
    const map = isRecord(value) ? value : {};
    return {
      kind: "choice",
      options: Object.entries(map).map(([key, description]) => ({
        key,
        description: typeof description === "string" ? description : "",
      })),
    };
  }
  return isCriteria(value) ? value : undefined;
}

function criteriaToManifest(shape: ManifestCriteriaShape, criteria: DecisionCriteria): unknown {
  if (shape === "boolean-pair" && criteria.kind === "boolean") {
    const t = criteria.trueCriteria ?? "";
    const f = criteria.falseCriteria ?? "";
    // The manifest takes both descriptions or none.
    return t === "" && f === "" ? undefined : { true: t, false: f };
  }
  if (shape === "choice-map" && criteria.kind === "choice") {
    const out: Record<string, string> = {};
    for (const option of criteria.options)
      if (option.key !== "") out[option.key] = option.description;
    return out;
  }
  return criteria;
}

/**
 * Decision criteria editor. Reads and writes the manifest shapes (boolean
 * `{ true, false }`, choice `options` map) as well as the editor's own
 * `DecisionCriteria` for app-defined schemas.
 */
export function CriteriaWidget({
  schema,
  value,
  onChange,
  disabled,
  invalid,
  label,
  "aria-label": ariaLabel,
}: SchemaWidgetProps) {
  const shape = manifestCriteriaShape(schema);
  const kind =
    shape === "boolean-pair" ? "boolean" : shape === "choice-map" ? "choice" : lockedKind(schema);
  return (
    <CriteriaEditor
      aria-label={ariaLabel ?? label}
      value={criteriaFromManifest(shape, value)}
      onChange={(next) => onChange(criteriaToManifest(shape, next))}
      kind={kind}
      disabled={disabled}
      invalid={invalid}
    />
  );
}

function isRetryPolicy(value: unknown): value is RetryPolicy {
  return (
    isRecord(value) &&
    typeof value.maxAttempts === "number" &&
    typeof value.initialDelayMs === "number"
  );
}

export function RetryPolicyWidget({
  value,
  onChange,
  disabled,
  label,
  "aria-label": ariaLabel,
}: SchemaWidgetProps) {
  const env = useSchemaFormEnvironment();
  return (
    <RetryPolicyEditor
      aria-label={ariaLabel ?? label}
      value={isRetryPolicy(value) ? value : DEFAULT_RETRY_POLICY}
      onChange={onChange}
      irreversible={env.irreversible}
      disabled={disabled}
    />
  );
}

// ---------------------------------------------------------------------------
// x-ui widgets added with RFC-0012
// ---------------------------------------------------------------------------

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "unknown error";
}

/** Delay before a typed search reaches the option provider. */
export const OPTIONS_SEARCH_DEBOUNCE_MS = 250;

/**
 * `combobox` and `x-ui.optionsProvider` fields. With a provider and a
 * `loadOptions` environment callback the options load on mount, on refresh
 * and (debounced) as the person searches; loading and error states show in
 * place. Without a provider the options come from the schema `enum`.
 */
export function ComboboxWidget({
  schema,
  hints,
  value,
  onChange,
  onBlur,
  placeholder,
  disabled,
  invalid,
  "aria-label": ariaLabel,
}: SchemaWidgetProps) {
  const env = useSchemaFormEnvironment();
  const provider = hints.optionsProvider;
  const { nodeType, loadOptions, getValues } = env;
  const remote = provider !== undefined && nodeType !== undefined && loadOptions !== undefined;
  const staticOptions = useMemo<OptionItem[]>(() => enumOptions(schema), [schema]);
  const [search, setSearch] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    options: OptionItem[];
    error: string | null;
  } | null>(null);
  const requestKey = `${attempt}\u0000${search}`;

  useEffect(() => {
    if (!remote) return;
    let cancelled = false;
    const run = () => {
      loadOptions(nodeType, provider, getValues(), search).then(
        (options) => {
          if (!cancelled) setResult({ key: requestKey, options, error: null });
        },
        (error: unknown) => {
          if (!cancelled)
            setResult((prev) => ({
              key: requestKey,
              options: prev?.options ?? [],
              error: errorMessage(error),
            }));
        },
      );
    };
    const timer = search === "" ? null : window.setTimeout(run, OPTIONS_SEARCH_DEBOUNCE_MS);
    if (timer === null) run();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [remote, loadOptions, nodeType, provider, getValues, search, requestKey]);

  const loading = remote && result?.key !== requestKey;
  const options = remote ? (result?.options ?? []) : staticOptions;
  return (
    <Combobox
      aria-label={ariaLabel}
      options={options}
      value={value === undefined || value === null ? null : enumKey(value)}
      onValueChange={(next) => onChange(next)}
      onBlur={onBlur}
      loading={loading}
      error={remote && !loading ? (result?.error ?? null) : null}
      onRefresh={remote ? () => setAttempt((n) => n + 1) : undefined}
      onSearchChange={remote ? setSearch : undefined}
      placeholder={placeholder ?? "Choose…"}
      disabled={disabled}
      invalid={invalid}
    />
  );
}

/** True when a `template` field is edited as a multi-line prompt rather than a single line (URLs, names). */
export function isMultilineTemplate(schema: JsonSchema): boolean {
  if (schema.format === "multiline" || schema.format === "prompt") return true;
  return schema.maxLength !== undefined && schema.maxLength > 1000;
}

/**
 * `template` fields: text with `{{ expr | filter }}` holes, edited with the
 * expression editor (chips, reference completion over the scope). P1-07's
 * `TemplateEditor` replaces this registration.
 */
export function TemplateWidget({
  schema,
  value,
  onChange,
  placeholder,
  disabled,
  invalid,
  label,
  "aria-label": ariaLabel,
}: SchemaWidgetProps) {
  const env = useSchemaFormEnvironment();
  // CodeMirror's content element is not labelable by <label for>, so it carries the name itself.
  const name = ariaLabel ?? label;
  if (isMultilineTemplate(schema)) {
    return (
      <TemplateEditor
        aria-label={name}
        scope={env.scope}
        {...(env.templateRefs ? { refs: env.templateRefs } : {})}
        variables={env.variables ?? []}
        inContainer={env.inContainer ?? false}
        value={asString(value)}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        invalid={invalid}
      />
    );
  }
  return (
    <ExpressionInput
      aria-label={name}
      scope={env.scope}
      value={asString(value)}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      invalid={invalid}
    />
  );
}

/** Five (or six, with seconds) whitespace-separated cron fields. */
export function looksLikeCron(text: string): boolean {
  const fields = text.trim().split(/\s+/);
  return fields.length === 5 || fields.length === 6;
}

/** `format: 'cron'` / `x-ui.widget: 'cron'`: CronEditor, previewing runs in the config's `timezone`. */
export function CronWidget({
  value,
  onChange,
  onBlur,
  disabled,
  invalid,
  "aria-label": ariaLabel,
}: SchemaWidgetProps) {
  const env = useSchemaFormEnvironment();
  const tz = env.getValues().timezone;
  return (
    <CronEditor
      aria-label={ariaLabel}
      value={asString(value)}
      onChange={onChange}
      onBlur={onBlur}
      disabled={disabled}
      invalid={invalid}
      timezone={typeof tz === "string" && tz !== "" ? tz : "UTC"}
    />
  );
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** ISO timestamp → the `datetime-local` input's local "YYYY-MM-DDTHH:mm" text. */
export function toLocalInput(value: unknown): string {
  if (typeof value !== "string" || value === "") return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** `format: 'date-time'`: a local date-time input storing an ISO 8601 UTC timestamp. */
export function DateTimeWidget({
  value,
  onChange,
  onBlur,
  disabled,
  "aria-label": ariaLabel,
}: SchemaWidgetProps) {
  return (
    <Input
      aria-label={ariaLabel}
      type="datetime-local"
      mono
      value={toLocalInput(value)}
      onChange={(e) => {
        const text = e.target.value;
        if (text === "") {
          onChange(undefined);
          return;
        }
        const date = new Date(text);
        onChange(Number.isNaN(date.getTime()) ? text : date.toISOString());
      }}
      onBlur={onBlur}
      disabled={disabled}
    />
  );
}

/** `format: 'uri'`: a mono URL input (templates allowed; the field rule checks full URLs). */
export function UriWidget(props: SchemaWidgetProps) {
  return <TextWidget {...props} />;
}

/** `x-ui.widget: 'binding'`: the value is always a `Binding` (literals stored as `{ kind: 'literal', value }`). */
export function BindingWidget({
  value,
  onChange,
  onBlur,
  label,
  disabled,
  invalid,
  "aria-label": ariaLabel,
}: SchemaWidgetProps) {
  const env = useSchemaFormEnvironment();
  return (
    <BindingField
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      label={ariaLabel ?? label}
      alwaysBinding
      scope={env.scope}
      disabled={disabled}
      invalid={invalid}
    />
  );
}

registerWidget("text", TextWidget);
registerWidget("textarea", TextareaWidget);
registerWidget("secret", SecretWidget);
registerWidget("number", NumberWidget);
registerWidget("slider", SliderWidget);
registerWidget("switch", SwitchWidget);
registerWidget("select", SelectWidget);
registerWidget("radio", RadioWidget);
registerWidget("expression", ExpressionWidget);
registerWidget("code", CodeWidget);
registerWidget("json", JsonWidget);
registerWidget("credential", CredentialWidget);
registerWidget("model", ModelWidget);
registerWidget("keyvalue", KeyValueWidget);
registerWidget("threshold", ThresholdWidget);
registerWidget("criteria", CriteriaWidget);
registerWidget("schema", SchemaJsonWidget);
registerWidget("questions", QuestionsWidget);
registerWidget("levels", LevelsWidget);
registerWidget("ref:RetryPolicy", RetryPolicyWidget);
registerWidget("retry-policy", RetryPolicyWidget);
registerWidget("combobox", ComboboxWidget);
registerWidget("template", TemplateWidget);
registerWidget("cron", CronWidget);
registerWidget("date-time", DateTimeWidget);
registerWidget("uri", UriWidget);
registerWidget("binding", BindingWidget);
