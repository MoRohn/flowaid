import { forwardRef, useCallback, useMemo, useState, type HTMLAttributes } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import type { JsonSchema } from "@/types";
import { PortTypeLabel } from "./PortTypeLabel";
import { Hint } from "@/primitives";

// ---------------------------------------------------------------------------
// Schema helpers
// ---------------------------------------------------------------------------

/** Resolves a local `#/$defs/name` reference against the root schema. */
export function resolveSchemaRef(schema: JsonSchema, root: JsonSchema): JsonSchema {
  let current = schema;
  for (let hops = 0; hops < 8 && typeof current.$ref === "string"; hops++) {
    const ref = current.$ref;
    const m = /^#\/(?:\$defs|definitions)\/(.+)$/.exec(ref);
    const name = m?.[1];
    const target = name !== undefined ? root.$defs?.[name] : undefined;
    if (!target) break;
    const { $ref: _ref, ...rest } = current;
    current = { ...target, ...rest };
  }
  return current;
}

/** Human type label for a schema: "string", "integer", "string[]", "object", "enum", "one of 3", "string | null". */
export function schemaTypeLabel(schema: JsonSchema, root: JsonSchema = schema): string {
  const s = resolveSchemaRef(schema, root);
  if (s.const !== undefined) return "const";
  if (s.enum) return "enum";
  if (s.oneOf) return `one of ${s.oneOf.length}`;
  if (s.anyOf) return `any of ${s.anyOf.length}`;
  if (s.allOf) return "all of";
  if (Array.isArray(s.type)) return s.type.join(" | ");
  if (s.type === "array") {
    const item = s.items ? schemaTypeLabel(s.items, root) : "any";
    return item.includes(" ") ? `array<${item}>` : `${item}[]`;
  }
  if (s.type) return s.type;
  if (s.properties) return "object";
  return "any";
}

function constraintText(s: JsonSchema): string[] {
  const out: string[] = [];
  if (s.format) out.push(s.format);
  if (s.pattern) out.push(`/${s.pattern}/`);
  if (s.minLength !== undefined || s.maxLength !== undefined) {
    out.push(`len ${s.minLength ?? 0}–${s.maxLength ?? "∞"}`);
  }
  const min = s.minimum ?? s.exclusiveMinimum;
  const max = s.maximum ?? s.exclusiveMaximum;
  if (min !== undefined || max !== undefined) {
    const lo = min === undefined ? "" : `${s.exclusiveMinimum !== undefined ? ">" : "≥"} ${min}`;
    const hi = max === undefined ? "" : `${s.exclusiveMaximum !== undefined ? "<" : "≤"} ${max}`;
    out.push([lo, hi].filter(Boolean).join(", "));
  }
  if (s.multipleOf !== undefined) out.push(`step ${s.multipleOf}`);
  if (s.minItems !== undefined || s.maxItems !== undefined) {
    out.push(`items ${s.minItems ?? 0}–${s.maxItems ?? "∞"}`);
  }
  if (s.default !== undefined) out.push(`default ${JSON.stringify(s.default)}`);
  return out;
}

interface SchemaNode {
  id: string;
  name: string;
  schema: JsonSchema;
  required: boolean;
  depth: number;
  children: SchemaNode[];
  /** "items" for array items, "variant" for oneOf/anyOf members. */
  role?: "items" | "variant";
}

function buildTree(
  schema: JsonSchema,
  root: JsonSchema,
  name: string,
  id: string,
  depth: number,
  required: boolean,
  role?: SchemaNode["role"],
  seen: Set<JsonSchema> = new Set(),
): SchemaNode {
  const s = resolveSchemaRef(schema, root);
  const node: SchemaNode = { id, name, schema: s, required, depth, children: [], role };
  if (seen.has(s) || depth > 12) return node;
  const nextSeen = new Set(seen).add(s);
  const requiredSet = new Set(s.required ?? []);
  if (s.properties) {
    for (const [key, child] of Object.entries(s.properties)) {
      node.children.push(
        buildTree(
          child,
          root,
          key,
          `${id}.${key}`,
          depth + 1,
          requiredSet.has(key),
          undefined,
          nextSeen,
        ),
      );
    }
  }
  if (s.type === "array" && s.items) {
    const items = resolveSchemaRef(s.items, root);
    if (items.properties || items.items || items.oneOf || items.anyOf || items.enum) {
      node.children.push(
        buildTree(items, root, "[]", `${id}[]`, depth + 1, false, "items", nextSeen),
      );
    }
  }
  const variants = s.oneOf ?? s.anyOf;
  if (variants) {
    variants.forEach((v, i) => {
      const resolved = resolveSchemaRef(v, root);
      const label = resolved.title ?? `option ${i + 1}`;
      node.children.push(
        buildTree(resolved, root, label, `${id}|${i}`, depth + 1, false, "variant", nextSeen),
      );
    });
  }
  if (typeof s.additionalProperties === "object") {
    node.children.push(
      buildTree(
        s.additionalProperties,
        root,
        "[key]",
        `${id}.*`,
        depth + 1,
        false,
        undefined,
        nextSeen,
      ),
    );
  }
  return node;
}

function flattenTree(
  node: SchemaNode,
  expanded: (id: string, depth: number) => boolean,
  out: SchemaNode[] = [],
): SchemaNode[] {
  out.push(node);
  if (node.children.length > 0 && expanded(node.id, node.depth)) {
    for (const c of node.children) flattenTree(c, expanded, out);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface SchemaTreeProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  schema: JsonSchema;
  /** Label for the root row. Omit to start at the root's properties. */
  rootName?: string;
  /** Levels expanded by default. Default 3. */
  expandDepth?: number;
  /** Show descriptions under rows. Default true. */
  descriptions?: boolean;
  /** Show format/range/default constraints. Default true. */
  constraints?: boolean;
}

/**
 * Renders a JSON Schema as a readable tree: name, type chip, a required
 * marker, description, constraints and enum values. `$ref`s to `$defs` are
 * resolved; arrays show their item shape and oneOf/anyOf their variants.
 */
export const SchemaTree = forwardRef<HTMLDivElement, SchemaTreeProps>(function SchemaTree(
  {
    schema,
    rootName,
    expandDepth = 3,
    descriptions = true,
    constraints = true,
    className,
    ...rest
  },
  ref,
) {
  const roots = useMemo(() => {
    if (rootName !== undefined) return [buildTree(schema, schema, rootName, "$", 0, false)];
    const root = buildTree(schema, schema, "$", "$", -1, false);
    return root.children.length > 0 ? root.children : [{ ...root, depth: 0, name: "value" }];
  }, [schema, rootName]);

  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const isExpanded = useCallback(
    (id: string, depth: number) => overrides.get(id) ?? depth < expandDepth,
    [overrides, expandDepth],
  );
  const rows = useMemo(() => roots.flatMap((r) => flattenTree(r, isExpanded)), [roots, isExpanded]);
  const toggle = (id: string, depth: number) => {
    setOverrides((prev) => new Map(prev).set(id, !isExpanded(id, depth)));
  };

  return (
    <div
      ref={ref}
      role="tree"
      aria-label="Schema"
      className={cn("flex min-w-0 flex-col", className)}
      {...rest}
    >
      {rows.map((node) => {
        const s = node.schema;
        const hasChildren = node.children.length > 0;
        const open = hasChildren && isExpanded(node.id, node.depth);
        const type = schemaTypeLabel(s, schema);
        const cons = constraints ? constraintText(s) : [];
        return (
          <div
            key={node.id}
            role="treeitem"
            aria-selected={false}
            aria-level={node.depth + 1}
            aria-expanded={hasChildren ? open : undefined}
            data-required={node.required || undefined}
            className="flex min-w-0 flex-col py-0.5"
            style={{ paddingLeft: node.depth * 14 }}
          >
            <div className="flex min-w-0 items-center gap-1">
              {hasChildren ? (
                <button
                  type="button"
                  aria-label={open ? `Collapse ${node.name}` : `Expand ${node.name}`}
                  onClick={() => toggle(node.id, node.depth)}
                  className="flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-xs text-ink-3 hover:bg-surface-3 hover:text-ink"
                >
                  <ChevronRight
                    className={cn(
                      "size-3.5 transition-transform duration-(--dur-fast) ease-(--ease-out)",
                      open && "rotate-90",
                    )}
                    strokeWidth={1.75}
                  />
                </button>
              ) : (
                <span className="size-4 shrink-0" aria-hidden="true" />
              )}
              <span
                className={cn(
                  "truncate font-mono text-xs",
                  node.role === "variant" ? "text-ink-3" : "text-ink",
                )}
              >
                {node.name}
              </span>
              {node.required ? (
                <Hint
                  hint="required"
                  className="-ml-0.5 font-mono text-xs leading-none text-danger-text"
                >
                  <span aria-hidden="true">*</span>
                </Hint>
              ) : null}
              <PortTypeLabel type={type} size="sm" className="ml-1" />
              {s.title && node.role !== "variant" ? (
                <span className="truncate text-2xs text-ink-3">{s.title}</span>
              ) : null}
            </div>
            {(descriptions && s.description) ||
            cons.length > 0 ||
            s.enum ||
            s.const !== undefined ? (
              <div className="flex min-w-0 flex-col gap-0.5 pl-5">
                {descriptions && s.description ? (
                  <p className="text-xs leading-snug text-ink-3">{s.description}</p>
                ) : null}
                {s.enum ? (
                  <div className="flex flex-wrap items-center gap-1 py-0.5">
                    {s.enum.map((v, i) => (
                      <span
                        key={i}
                        className="rounded-xs border border-border bg-surface px-1 font-mono text-2xs leading-4 text-ink-2"
                      >
                        {typeof v === "string" ? v : JSON.stringify(v)}
                      </span>
                    ))}
                  </div>
                ) : null}
                {s.const !== undefined ? (
                  <span className="font-mono text-2xs text-ink-3">= {JSON.stringify(s.const)}</span>
                ) : null}
                {cons.length > 0 ? (
                  <span className="font-mono text-2xs text-ink-3">{cons.join(" · ")}</span>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
});
