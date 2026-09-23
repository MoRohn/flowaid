import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { ChevronRight, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { CopyButton, IconButton, SearchInput, Tooltip } from "@/primitives";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export type JsonPathSegment = string | number;

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Builds a JSONPath-style string: `$.nodes[2].output["first name"]`. */
export function buildJsonPath(segments: readonly JsonPathSegment[], root = "$"): string {
  let out = root;
  for (const seg of segments) {
    if (typeof seg === "number") out += `[${seg}]`;
    else if (IDENT_RE.test(seg)) out += `.${seg}`;
    else out += `[${JSON.stringify(seg)}]`;
  }
  return out;
}

type JsonKind = "object" | "array" | "string" | "number" | "boolean" | "null" | "undefined";

function kindOf(value: unknown): JsonKind {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  const t = typeof value;
  if (t === "object") return "object";
  if (t === "string") return "string";
  if (t === "number" || t === "bigint") return "number";
  if (t === "boolean") return "boolean";
  return "undefined";
}

function isContainer(kind: JsonKind): boolean {
  return kind === "object" || kind === "array";
}

function childEntries(value: unknown, kind: JsonKind): Array<[JsonPathSegment, unknown]> {
  if (kind === "array" && Array.isArray(value)) return value.map((v, i) => [i, v]);
  if (kind === "object" && typeof value === "object" && value !== null) {
    return Object.entries(value as Record<string, unknown>);
  }
  return [];
}

function stringifyValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "bigint") return value.toString();
  if (value === undefined) return "undefined";
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return Object.prototype.toString.call(value);
  }
}

function primitiveText(value: unknown, kind: JsonKind): string {
  switch (kind) {
    case "string":
      return typeof value === "string" ? value : "";
    case "number":
      return typeof value === "bigint" ? `${value.toString()}n` : String(value);
    case "boolean":
      return value ? "true" : "false";
    case "null":
      return "null";
    case "undefined":
      return "undefined";
    case "object":
    case "array":
      return "";
  }
}

// ---------------------------------------------------------------------------
// Flattening
// ---------------------------------------------------------------------------

interface FlatRow {
  path: string;
  segments: JsonPathSegment[];
  key: JsonPathSegment | null;
  value: unknown;
  kind: JsonKind;
  depth: number;
  expandable: boolean;
  expanded: boolean;
  childCount: number;
  /** Index of this row's parent in the flat list, or -1. */
  parentIndex: number;
  isLast: boolean;
}

type ExpansionBase = "depth" | "all" | "none";

interface ExpansionState {
  base: ExpansionBase;
  overrides: ReadonlyMap<string, boolean>;
}

function searchMatches(
  value: unknown,
  query: string,
  root: string,
): { matched: Set<string>; ancestors: Set<string> } {
  const matched = new Set<string>();
  const ancestors = new Set<string>();
  if (query.length === 0) return { matched, ancestors };
  const q = query.toLowerCase();
  const stack: Array<{ value: unknown; segments: JsonPathSegment[]; key: JsonPathSegment | null }> =
    [{ value, segments: [], key: null }];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur) break;
    const kind = kindOf(cur.value);
    const path = buildJsonPath(cur.segments, root);
    let hit = false;
    if (cur.key !== null && String(cur.key).toLowerCase().includes(q)) hit = true;
    if (!isContainer(kind) && primitiveText(cur.value, kind).toLowerCase().includes(q)) hit = true;
    if (hit) {
      matched.add(path);
      for (let i = cur.segments.length - 1; i >= 0; i--) {
        ancestors.add(buildJsonPath(cur.segments.slice(0, i), root));
      }
    }
    if (isContainer(kind)) {
      const entries = childEntries(cur.value, kind);
      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];
        if (!entry) continue;
        stack.push({ value: entry[1], segments: [...cur.segments, entry[0]], key: entry[0] });
      }
    }
  }
  return { matched, ancestors };
}

function flatten(
  rootValue: unknown,
  expansion: ExpansionState,
  expandDepth: number,
  searchAncestors: ReadonlySet<string>,
  root: string,
): FlatRow[] {
  const rows: FlatRow[] = [];
  const isExpanded = (path: string, depth: number): boolean => {
    const o = expansion.overrides.get(path);
    if (o !== undefined) return o;
    if (searchAncestors.has(path)) return true;
    switch (expansion.base) {
      case "all":
        return true;
      case "none":
        return false;
      case "depth":
        return depth < expandDepth;
    }
  };
  const visit = (
    value: unknown,
    segments: JsonPathSegment[],
    key: JsonPathSegment | null,
    depth: number,
    parentIndex: number,
    isLast: boolean,
  ) => {
    const kind = kindOf(value);
    const entries = childEntries(value, kind);
    const expandable = isContainer(kind) && entries.length > 0;
    const path = buildJsonPath(segments, root);
    const expanded = expandable && isExpanded(path, depth);
    const index = rows.length;
    rows.push({
      path,
      segments,
      key,
      value,
      kind,
      depth,
      expandable,
      expanded,
      childCount: entries.length,
      parentIndex,
      isLast,
    });
    if (expanded) {
      entries.forEach((entry, i) => {
        visit(
          entry[1],
          [...segments, entry[0]],
          entry[0],
          depth + 1,
          index,
          i === entries.length - 1,
        );
      });
    }
  };
  visit(rootValue, [], null, 0, -1, true);
  return rows;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function Highlight({ text, query }: { text: string; query: string }): ReactNode {
  if (query.length === 0) return text;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const parts: ReactNode[] = [];
  let from = 0;
  let idx = lower.indexOf(q, from);
  let k = 0;
  while (idx !== -1) {
    if (idx > from) parts.push(text.slice(from, idx));
    parts.push(
      <mark key={k++} className="rounded-xs bg-accent-soft-2 text-inherit">
        {text.slice(idx, idx + q.length)}
      </mark>,
    );
    from = idx + q.length;
    idx = lower.indexOf(q, from);
  }
  if (from < text.length) parts.push(text.slice(from));
  return parts;
}

const KIND_CLASS: Record<JsonKind, string> = {
  string: "text-cat-data",
  number: "text-accent-text",
  boolean: "text-cat-human",
  null: "text-ink-3",
  undefined: "text-ink-3",
  object: "text-ink-3",
  array: "text-ink-3",
};

interface RowProps {
  row: FlatRow;
  index: number;
  active: boolean;
  matched: boolean;
  query: string;
  maxStringLength: number;
  showAll: boolean;
  onToggle: (path: string, expanded: boolean) => void;
  onShowAll: (path: string) => void;
  onActivate: (index: number) => void;
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>, index: number) => void;
  registerRef: (index: number, el: HTMLDivElement | null) => void;
}

const JsonRow = memo(function JsonRow({
  row,
  index,
  active,
  matched,
  query,
  maxStringLength,
  showAll,
  onToggle,
  onShowAll,
  onActivate,
  onKeyDown,
  registerRef,
}: RowProps) {
  const { kind, value, expandable, expanded, key, childCount } = row;
  const keyLabel = key === null ? null : String(key);
  const isIndex = typeof key === "number";

  let valueNode: ReactNode;
  if (isContainer(kind)) {
    const open = kind === "array" ? "[" : "{";
    const close = kind === "array" ? "]" : "}";
    if (childCount === 0) {
      valueNode = <span className="text-ink-3">{`${open}${close}`}</span>;
    } else if (expanded) {
      valueNode = <span className="text-ink-3">{open}</span>;
    } else {
      valueNode = (
        <span className="text-ink-3">
          {open}
          <span className="mx-0.5 text-ink-3">…</span>
          {close}
          <span className="ml-1.5 text-2xs text-ink-3">
            {childCount}{" "}
            {kind === "array"
              ? childCount === 1
                ? "item"
                : "items"
              : childCount === 1
                ? "key"
                : "keys"}
          </span>
        </span>
      );
    }
  } else if (kind === "string") {
    const text = typeof value === "string" ? value : "";
    const long = text.length > maxStringLength && !showAll;
    const shown = long ? text.slice(0, maxStringLength) : text;
    valueNode = (
      <span className={cn("whitespace-pre-wrap break-all", KIND_CLASS.string)}>
        &quot;
        <Highlight text={shown} query={query} />
        {long ? "…" : null}&quot;
        {long ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onShowAll(row.path);
            }}
            className="ml-1.5 rounded-xs font-sans text-2xs font-medium text-accent-text hover:underline"
          >
            show all ({text.length.toLocaleString()} chars)
          </button>
        ) : null}
      </span>
    );
  } else {
    valueNode = (
      <span className={KIND_CLASS[kind]}>
        <Highlight text={primitiveText(value, kind)} query={query} />
      </span>
    );
  }

  const copyText = () => stringifyValue(value);

  return (
    <div
      ref={(el) => registerRef(index, el)}
      role="treeitem"
      aria-level={row.depth + 1}
      aria-expanded={expandable ? expanded : undefined}
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      data-path={row.path}
      data-matched={matched || undefined}
      onClick={() => {
        onActivate(index);
        if (expandable) onToggle(row.path, !expanded);
      }}
      onKeyDown={(e) => onKeyDown(e, index)}
      className={cn(
        "group/row relative flex min-h-[22px] items-start gap-1 rounded-xs pr-1 font-mono text-xs leading-[22px] outline-none",
        "hover:bg-surface-3/70 focus-visible:bg-surface-3/70",
        expandable && "cursor-pointer",
        matched && "bg-accent-soft/50",
      )}
      style={{ paddingLeft: row.depth * 14 + 4 }}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex size-4 shrink-0 items-center justify-center self-start text-ink-3 transition-transform duration-(--dur-fast) ease-(--ease-out)",
          !expandable && "invisible",
          expanded && "rotate-90",
        )}
        style={{ marginTop: 3 }}
      >
        <ChevronRight className="size-3.5" strokeWidth={1.75} />
      </span>
      <span className="min-w-0 flex-1 break-words">
        {keyLabel !== null ? (
          <>
            <span className={isIndex ? "text-ink-3" : "text-ink-2"}>
              <Highlight text={keyLabel} query={query} />
            </span>
            <span className="text-ink-3">: </span>
          </>
        ) : null}
        {valueNode}
      </span>
      <span
        className={cn(
          "sticky right-0 flex shrink-0 items-center gap-px self-start opacity-0 transition-opacity duration-(--dur-fast)",
          "group-hover/row:opacity-100 group-focus-within/row:opacity-100 group-focus-visible/row:opacity-100",
        )}
        style={{ marginTop: 1 }}
        role="presentation"
        onClick={(e) => e.stopPropagation()}
      >
        <Tooltip content={<span className="font-mono">{row.path}</span>} side="left">
          <CopyButton
            value={row.path}
            label="Copy path"
            size="xs"
            tooltip={false}
            tabIndex={-1}
            className="text-ink-3 hover:text-ink"
          />
        </Tooltip>
        <CopyButton
          value={copyText}
          label="Copy value"
          size="xs"
          tooltipSide="left"
          tabIndex={-1}
          className="text-ink-3 hover:text-ink"
        />
      </span>
    </div>
  );
});

export interface JsonViewProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  value: unknown;
  /** Levels expanded by default; deeper containers start collapsed. Default 2. */
  expandDepth?: number;
  /** Show the expand/collapse/search toolbar. Default true. */
  toolbar?: boolean;
  /** Controlled search text; omit for the built-in search field. */
  search?: string;
  onSearchChange?: (query: string) => void;
  /** Strings longer than this are truncated with a "show all" control. Default 400. */
  maxStringLength?: number;
  /** Root path label used for copied paths. Default "$". */
  rootLabel?: string;
  /** Called with the flat row count on every re-layout (for tests and status bars). */
  onRowsChange?: (visibleRows: number) => void;
}

/**
 * Collapsible tree for arbitrary JSON. Keys read in ink-2, strings in the
 * data hue, numbers in the accent, booleans in the human hue and nulls muted.
 * Containers show their size when collapsed; search auto-expands the path to
 * each match; hovering a row reveals "copy value" and "copy path" (a mono
 * JSONPath such as `$.nodes[2].output.confidence`). Arrow keys move and
 * expand/collapse; Enter toggles; Home/End jump.
 */
export const JsonView = forwardRef<HTMLDivElement, JsonViewProps>(function JsonView(
  {
    value,
    expandDepth = 2,
    toolbar = true,
    search,
    onSearchChange,
    maxStringLength = 400,
    rootLabel = "$",
    onRowsChange,
    className,
    ...rest
  },
  ref,
) {
  const [internalSearch, setInternalSearch] = useState("");
  const query = search ?? internalSearch;
  const setQuery = useCallback(
    (q: string) => {
      if (search === undefined) setInternalSearch(q);
      onSearchChange?.(q);
    },
    [search, onSearchChange],
  );

  const [expansion, setExpansion] = useState<ExpansionState>({
    base: "depth",
    overrides: new Map(),
  });
  const [shownAll, setShownAll] = useState<ReadonlySet<string>>(() => new Set());
  const [activeIndex, setActiveIndex] = useState(0);

  const { matched, ancestors } = useMemo(
    () => searchMatches(value, query.trim(), rootLabel),
    [value, query, rootLabel],
  );
  const rows = useMemo(
    () => flatten(value, expansion, expandDepth, ancestors, rootLabel),
    [value, expansion, expandDepth, ancestors, rootLabel],
  );

  useEffect(() => {
    onRowsChange?.(rows.length);
  }, [rows.length, onRowsChange]);

  const rowRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const registerRef = useCallback((index: number, el: HTMLDivElement | null) => {
    if (el) rowRefs.current.set(index, el);
    else rowRefs.current.delete(index);
  }, []);
  const pendingFocus = useRef<number | null>(null);
  useEffect(() => {
    if (pendingFocus.current === null) return;
    const el = rowRefs.current.get(pendingFocus.current);
    pendingFocus.current = null;
    el?.focus();
  });

  const focusRow = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(rows.length - 1, index));
      setActiveIndex(clamped);
      pendingFocus.current = clamped;
      rowRefs.current.get(clamped)?.focus();
    },
    [rows.length],
  );

  const setPathExpanded = useCallback((path: string, expanded: boolean) => {
    setExpansion((prev) => {
      const overrides = new Map(prev.overrides);
      overrides.set(path, expanded);
      return { base: prev.base, overrides };
    });
  }, []);

  const expandAll = useCallback(() => setExpansion({ base: "all", overrides: new Map() }), []);
  const collapseAll = useCallback(() => {
    setExpansion({ base: "none", overrides: new Map([[rootLabel, true]]) });
    setActiveIndex(0);
  }, [rootLabel]);

  const showAll = useCallback((path: string) => {
    setShownAll((prev) => new Set(prev).add(path));
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>, index: number) => {
      const row = rows[index];
      if (!row) return;
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          focusRow(index + 1);
          break;
        case "ArrowUp":
          e.preventDefault();
          focusRow(index - 1);
          break;
        case "ArrowRight":
          e.preventDefault();
          if (row.expandable && !row.expanded) setPathExpanded(row.path, true);
          else if (row.expandable && row.expanded) focusRow(index + 1);
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (row.expandable && row.expanded) setPathExpanded(row.path, false);
          else if (row.parentIndex >= 0) focusRow(row.parentIndex);
          break;
        case "Enter":
        case " ":
          if (row.expandable) {
            e.preventDefault();
            setPathExpanded(row.path, !row.expanded);
          }
          break;
        case "Home":
          e.preventDefault();
          focusRow(0);
          break;
        case "End":
          e.preventDefault();
          focusRow(rows.length - 1);
          break;
        case "*":
          e.preventDefault();
          expandAll();
          break;
        default:
          break;
      }
    },
    [rows, focusRow, setPathExpanded, expandAll],
  );

  const safeActive = Math.min(activeIndex, Math.max(0, rows.length - 1));
  const trimmed = query.trim();
  const matchCount = matched.size;

  return (
    <div
      ref={ref}
      className={cn("flex min-w-0 flex-col gap-1.5", className)}
      data-root={rootLabel}
      {...rest}
    >
      {toolbar ? (
        <div className="flex items-center gap-1">
          <SearchInput
            size="sm"
            value={query}
            onValueChange={setQuery}
            placeholder="Search keys and values"
            aria-label="Search JSON"
            hint={undefined}
            className="min-w-0 flex-1"
          />
          {trimmed.length > 0 ? (
            <span
              className={cn(
                "shrink-0 font-mono text-2xs tabular",
                matchCount > 0 ? "text-ink-3" : "text-danger-text",
              )}
              aria-live="polite"
            >
              {matchCount} {matchCount === 1 ? "match" : "matches"}
            </span>
          ) : null}
          <IconButton label="Expand all" size="sm" onClick={expandAll}>
            <ChevronsUpDown strokeWidth={1.75} />
          </IconButton>
          <IconButton label="Collapse all" size="sm" onClick={collapseAll}>
            <ChevronsDownUp strokeWidth={1.75} />
          </IconButton>
        </div>
      ) : null}
      <div
        role="tree"
        aria-label="JSON"
        className="min-w-0 overflow-x-auto rounded-sm border border-border bg-surface-2 py-1"
      >
        {rows.map((row, i) => (
          <JsonRow
            key={row.path}
            row={row}
            index={i}
            active={i === safeActive}
            matched={matched.has(row.path)}
            query={trimmed}
            maxStringLength={maxStringLength}
            showAll={shownAll.has(row.path)}
            onToggle={setPathExpanded}
            onShowAll={showAll}
            onActivate={setActiveIndex}
            onKeyDown={handleKeyDown}
            registerRef={registerRef}
          />
        ))}
      </div>
    </div>
  );
});
