/**
 * The `schema` widget: edit a JSON Schema as a field tree or as JSON (UI.md §5, P1-07).
 *
 * - Fields: object properties with name, type, required and description; objects nest and
 *   arrays pick their item type. Renames keep the property order and the `required` list.
 * - JSON: any schema, checked as JSON and against workflow-core's `JsonSchemaSchema`; only a
 *   valid schema is committed.
 * - A schema the field tree cannot show without losing information (combinators, `$ref`,
 *   `enum`, tuple items, …) opens in JSON mode and says why, instead of dropping parts of it.
 */
import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { JsonSchemaSchema, type JsonSchema } from "@flowaid/workflow-core";
import { cn } from "@/lib/cn";
import {
  Button,
  Checkbox,
  IconButton,
  Input,
  inputVariants,
  ToggleGroup,
  ToggleGroupItem,
} from "@/primitives";
import { CodeEditor } from "./CodeEditor";

export const FIELD_TYPES = ["string", "number", "integer", "boolean", "object", "array"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Keys the field tree can represent for each node. */
const TREE_KEYS = new Set([
  "type",
  "description",
  "properties",
  "required",
  "items",
  "additionalProperties",
  "title",
  "format",
  "default",
]);

/** Why the field tree cannot show this schema, or null when it can. */
export function treeUnsupportedReason(schema: unknown, path = "the schema"): string | null {
  if (!isObj(schema)) return `${path} is not an object`;
  for (const key of Object.keys(schema)) {
    if (!TREE_KEYS.has(key)) return `${path} uses "${key}"`;
  }
  const type = schema.type;
  if (
    type !== undefined &&
    (typeof type !== "string" || !(FIELD_TYPES as readonly string[]).includes(type))
  )
    return `${path} has type ${JSON.stringify(type)}`;
  if (type === "object" || schema.properties !== undefined) {
    if (schema.properties !== undefined && !isObj(schema.properties))
      return `${path} has invalid properties`;
    for (const [name, child] of Object.entries(schema.properties ?? {})) {
      const reason = treeUnsupportedReason(child, `"${name}"`);
      if (reason) return reason;
    }
    if (
      schema.additionalProperties !== undefined &&
      typeof schema.additionalProperties !== "boolean"
    )
      return `${path} has a schema for additionalProperties`;
  }
  if (type === "array" && schema.items !== undefined) {
    if (!isObj(schema.items)) return `${path} uses tuple items`;
    return treeUnsupportedReason(schema.items, `the items of ${path}`);
  }
  return null;
}

/** A property path: names, with `[]` stepping into array items. */
type Path = readonly string[];

function childAt(schema: Obj, key: string): Obj {
  if (key === "[]") return isObj(schema.items) ? schema.items : {};
  const props = isObj(schema.properties) ? schema.properties : {};
  return isObj(props[key]) ? props[key] : {};
}

/** Returns a copy of `schema` with the node at `path` replaced by `fn(node)`. */
function updateAt(schema: Obj, path: Path, fn: (node: Obj) => Obj): Obj {
  if (path.length === 0) return fn(schema);
  const [head, ...rest] = path as [string, ...string[]];
  if (head === "[]") return { ...schema, items: updateAt(childAt(schema, head), rest, fn) };
  const props = isObj(schema.properties) ? schema.properties : {};
  return { ...schema, properties: { ...props, [head]: updateAt(childAt(schema, head), rest, fn) } };
}

export function setFieldType(node: Obj, type: FieldType): Obj {
  const {
    properties: _p,
    required: _r,
    additionalProperties: _a,
    items: _i,
    format: _f,
    default: _d,
    ...rest
  } = node;
  if (type === "object")
    return { ...rest, type, properties: isObj(node.properties) ? node.properties : {} };
  if (type === "array")
    return { ...rest, type, items: isObj(node.items) ? node.items : { type: "string" } };
  return { ...rest, type };
}

export function renameProperty(parent: Obj, from: string, to: string): Obj {
  const props = isObj(parent.properties) ? parent.properties : {};
  const next = Object.fromEntries(Object.entries(props).map(([k, v]) => [k === from ? to : k, v]));
  const required = Array.isArray(parent.required)
    ? (parent.required as unknown[]).map((r) => (r === from ? to : r))
    : undefined;
  return { ...parent, properties: next, ...(required ? { required } : {}) };
}

export function removeProperty(parent: Obj, name: string): Obj {
  const props = { ...(isObj(parent.properties) ? parent.properties : {}) };
  delete props[name];
  const required = Array.isArray(parent.required) ? parent.required.filter((r) => r !== name) : [];
  const { required: _r, ...rest } = parent;
  return { ...rest, properties: props, ...(required.length > 0 ? { required } : {}) };
}

export function setRequired(parent: Obj, name: string, on: boolean): Obj {
  const current = Array.isArray(parent.required) ? (parent.required as string[]) : [];
  const required = on ? [...new Set([...current, name])] : current.filter((r) => r !== name);
  const { required: _r, ...rest } = parent;
  return required.length > 0 ? { ...rest, required } : rest;
}

export function addProperty(parent: Obj): Obj {
  const props = isObj(parent.properties) ? parent.properties : {};
  let i = Object.keys(props).length + 1;
  while (`field_${i}` in props) i += 1;
  return {
    ...parent,
    type: "object",
    properties: { ...props, [`field_${i}`]: { type: "string" } },
  };
}

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

interface RowsProps {
  root: Obj;
  path: Path;
  depth: number;
  disabled?: boolean;
  onChange: (schema: Obj) => void;
}

function PropertyRows({ root, path, depth, disabled, onChange }: RowsProps) {
  const parent = path.reduce<Obj>((node, key) => childAt(node, key), root);
  const props = isObj(parent.properties) ? parent.properties : {};
  const required = new Set(Array.isArray(parent.required) ? (parent.required as string[]) : []);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const edit = (fn: (node: Obj) => Obj) => onChange(updateAt(root, path, fn));

  return (
    <ul
      className="flex flex-col gap-1"
      style={{ paddingLeft: depth === 0 ? 0 : 16 }}
      aria-label={depth === 0 ? "Fields" : `Fields of ${path.filter((p) => p !== "[]").join(".")}`}
    >
      {Object.entries(props).map(([name, raw]) => {
        const child = isObj(raw) ? raw : {};
        const type = (typeof child.type === "string" ? child.type : "string") as FieldType;
        const draft = drafts[name] ?? name;
        const duplicate = draft !== name && draft in props;
        const badName = !NAME.test(draft) || duplicate;
        const commitName = () => {
          setDrafts(({ [name]: _gone, ...rest }) => rest);
          if (!badName && draft !== name) edit((node) => renameProperty(node, name, draft));
        };
        const items = type === "array" && isObj(child.items) ? child.items : null;
        const itemType = (
          items && typeof items.type === "string" ? items.type : "string"
        ) as FieldType;
        return (
          <li key={name} className="flex flex-col gap-1">
            <div className="grid grid-cols-[minmax(0,9rem)_6.5rem_auto_minmax(0,1fr)_28px] items-center gap-1.5">
              <Input
                size="sm"
                mono
                aria-label={`Name of ${name}`}
                value={draft}
                invalid={badName ? true : undefined}
                title={
                  duplicate
                    ? "Another field has this name"
                    : badName
                      ? "Letters, digits and _; not starting with a digit"
                      : undefined
                }
                disabled={disabled}
                onChange={(e) => setDrafts((d) => ({ ...d, [name]: e.target.value }))}
                onBlur={commitName}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitName();
                }}
              />
              <select
                aria-label={`Type of ${name}`}
                className={cn(inputVariants({ size: "sm" }), "font-mono")}
                value={type}
                disabled={disabled}
                onChange={(e) =>
                  edit((node) =>
                    updateAt(node, [name], (c) => setFieldType(c, e.target.value as FieldType)),
                  )
                }
              >
                {FIELD_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <Checkbox
                size="sm"
                label="required"
                aria-label={`${name} is required`}
                checked={required.has(name)}
                disabled={disabled}
                onCheckedChange={(on) => edit((node) => setRequired(node, name, on === true))}
              />
              <Input
                size="sm"
                aria-label={`Description of ${name}`}
                placeholder="Description (shown to models and people)"
                value={typeof child.description === "string" ? child.description : ""}
                disabled={disabled}
                onChange={(e) =>
                  edit((node) =>
                    updateAt(node, [name], (c) => {
                      const { description: _d, ...rest } = c;
                      return e.target.value === ""
                        ? rest
                        : { ...rest, description: e.target.value };
                    }),
                  )
                }
              />
              <IconButton
                label={`Remove ${name}`}
                size="sm"
                variant="ghost"
                disabled={disabled}
                onClick={() => edit((node) => removeProperty(node, name))}
              >
                <X strokeWidth={1.75} />
              </IconButton>
            </div>
            {type === "array" ? (
              <div className="flex items-center gap-1.5 pl-4 text-2xs text-ink-3">
                <span>items</span>
                <select
                  aria-label={`Item type of ${name}`}
                  className={cn(inputVariants({ size: "sm" }), "w-28 font-mono")}
                  value={itemType}
                  disabled={disabled}
                  onChange={(e) =>
                    edit((node) =>
                      updateAt(node, [name, "[]"], (c) =>
                        setFieldType(c, e.target.value as FieldType),
                      ),
                    )
                  }
                >
                  {FIELD_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {type === "object" ? (
              <Nested
                root={root}
                path={[...path, name]}
                depth={depth + 1}
                disabled={disabled}
                onChange={onChange}
              />
            ) : null}
            {type === "array" && itemType === "object" ? (
              <Nested
                root={root}
                path={[...path, name, "[]"]}
                depth={depth + 1}
                disabled={disabled}
                onChange={onChange}
              />
            ) : null}
          </li>
        );
      })}
      <li>
        <Button
          size="sm"
          variant="ghost"
          leadingIcon={<Plus />}
          disabled={disabled}
          onClick={() => edit(addProperty)}
        >
          Add field
        </Button>
      </li>
    </ul>
  );
}

function Nested(props: RowsProps) {
  return <PropertyRows {...props} />;
}

export interface JsonSchemaEditorProps {
  value: JsonSchema | undefined;
  onChange: (schema: JsonSchema) => void;
  disabled?: boolean;
  "aria-label"?: string;
}

/** Parses and validates JSON-mode text: the schema, or the problem. */
export function parseSchemaText(
  text: string,
): { ok: true; schema: JsonSchema } | { ok: false; message: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      message: `Not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!isObj(parsed))
    return { ok: false, message: 'A JSON Schema is an object, such as { "type": "string" }.' };
  const checked = JsonSchemaSchema.safeParse(parsed);
  if (!checked.success) {
    const issue = checked.error.issues[0];
    return {
      ok: false,
      message: `Not a valid schema at /${issue?.path.join("/") ?? ""}: ${issue?.message ?? "invalid"}`,
    };
  }
  return { ok: true, schema: checked.data };
}

export function JsonSchemaEditor({
  value,
  onChange,
  disabled,
  "aria-label": ariaLabel = "Schema",
}: JsonSchemaEditorProps) {
  const schema = useMemo<Obj>(
    () => (isObj(value) ? value : { type: "object", properties: {} }),
    [value],
  );
  const unsupported = treeUnsupportedReason(schema);
  const [mode, setMode] = useState<"fields" | "json">(unsupported ? "json" : "fields");
  const [text, setText] = useState(() => JSON.stringify(schema, null, 2));
  const [problem, setProblem] = useState<string | null>(null);
  const effectiveMode = unsupported ? "json" : mode;

  const switchTo = (next: "fields" | "json") => {
    if (next === "json") {
      setText(JSON.stringify(schema, null, 2));
      setProblem(null);
    }
    setMode(next);
  };

  return (
    <div
      className="flex min-w-0 flex-col gap-2"
      data-widget="schema"
      aria-label={ariaLabel}
      role="group"
    >
      <div className="flex items-center gap-2">
        <ToggleGroup
          type="single"
          size="sm"
          value={effectiveMode}
          onValueChange={(v) => {
            if (v === "fields" || v === "json") switchTo(v);
          }}
          aria-label="Editor mode"
        >
          <ToggleGroupItem value="fields" disabled={unsupported !== null || disabled}>
            Fields
          </ToggleGroupItem>
          <ToggleGroupItem value="json" disabled={disabled}>
            JSON
          </ToggleGroupItem>
        </ToggleGroup>
        {unsupported ? (
          <span className="text-2xs text-ink-3">Edited as JSON: {unsupported}.</span>
        ) : null}
      </div>
      {effectiveMode === "fields" ? (
        <PropertyRows
          root={schema}
          path={[]}
          depth={0}
          disabled={disabled}
          onChange={(next) => onChange(next)}
        />
      ) : (
        <div className="flex flex-col gap-1">
          <CodeEditor
            aria-label={`${ariaLabel} JSON`}
            language="json"
            value={text}
            disabled={disabled}
            invalid={problem !== null}
            minRows={6}
            maxRows={24}
            onChange={(next) => {
              setText(next);
              const parsed = parseSchemaText(next);
              setProblem(parsed.ok ? null : parsed.message);
              if (parsed.ok) onChange(parsed.schema);
            }}
          />
          {problem ? (
            <p className="text-xs text-danger-text" role="alert">
              {problem}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
