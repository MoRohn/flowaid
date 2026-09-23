import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  columnResizingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  createColumnHelper,
  createPaginatedRowModel,
  createSortedRowModel,
  metaHelper,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
  useTable,
  type Cell,
  type ColumnHelper,
  type ColumnVisibilityState,
  type Header,
  type PaginationState,
  type Row,
  type RowData,
  type RowSelectionState,
  type SortingState,
  type TableOptions,
  type Updater,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Inbox, Rows2, Rows3, Settings2, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useLatestRef } from "@/lib/useLatestRef";
import {
  Button,
  Checkbox,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  ProgressBar,
  Skeleton,
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
} from "@/primitives";
import { Pagination } from "./Pagination";
import { SortableHeader } from "./SortableHeader";

// ---------------------------------------------------------------------------
// Column typing
// ---------------------------------------------------------------------------

/** Per-column presentation hints, set through `meta` on a column def. */
export interface DataTableColumnMeta {
  /** Right-aligned, mono, tabular numerals. */
  numeric?: boolean;
  align?: "start" | "center" | "end";
  /** Mono face without right alignment (ids, kinds). */
  mono?: boolean;
  /** Label in the column menu when the header is not a plain string. */
  title?: string;
  /** Let the column absorb spare width. One column per table should grow. */
  grow?: boolean;
  /** Extra classes for body cells. */
  className?: string;
  /** Extra classes for the header cell. */
  headerClassName?: string;
  /** Hide the column from the visibility menu (always shown). */
  locked?: boolean;
}

/** The feature set every DataTable registers. Column helpers must use it. */
export const dataTableFeatures = tableFeatures({
  rowSortingFeature,
  rowSelectionFeature,
  columnVisibilityFeature,
  columnSizingFeature,
  columnResizingFeature,
  rowPaginationFeature,
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    basic: sortFn_basic,
    datetime: sortFn_datetime,
    text: sortFn_text,
  },
  columnMeta: metaHelper<DataTableColumnMeta>(),
});

export type DataTableFeatures = typeof dataTableFeatures;
export type DataTableRow<TData extends RowData> = Row<DataTableFeatures, TData>;
export type DataTableCell<TData extends RowData> = Cell<DataTableFeatures, TData, unknown>;
export type DataTableHeader<TData extends RowData> = Header<DataTableFeatures, TData, unknown>;
export type DataTableColumns<TData extends RowData> = TableOptions<
  DataTableFeatures,
  TData
>["columns"];

/**
 * Typed column helper bound to the DataTable feature set. Always wrap the
 * result in `helper.columns([...])` so each accessor keeps its value type.
 */
export function createDataTableColumns<TData extends RowData>(): ColumnHelper<
  DataTableFeatures,
  TData
> {
  return createColumnHelper<DataTableFeatures, TData>();
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type DataTableDensity = "compact" | "regular";

export const DATA_TABLE_ROW_HEIGHT: Record<DataTableDensity, number> = {
  compact: 28,
  regular: 36,
};

export interface DataTableErrorState {
  title?: string;
  message: string;
  onRetry?: () => void;
}

export interface DataTableSelection<TData extends RowData> {
  rows: TData[];
  count: number;
  clear: () => void;
}

export interface DataTablePaginationOptions {
  pageSize?: number;
  pageSizeOptions?: number[];
  /** Controlled page index. */
  pageIndex?: number;
  onPageIndexChange?: (pageIndex: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  /** Total row count when rows are paged on the server. */
  total?: number;
}

export interface DataTableProps<TData extends RowData> {
  columns: DataTableColumns<TData>;
  data: ReadonlyArray<TData>;
  /** Stable row id. Defaults to `row.id` when present, else the index. */
  getRowId?: (row: TData, index: number) => string;

  loading?: boolean;
  /** Skeleton rows shown while loading with no data. */
  skeletonRows?: number;
  error?: DataTableErrorState | null;
  /** Rendered in the body when there are no rows. */
  emptyState?: ReactNode;

  density?: DataTableDensity;
  defaultDensity?: DataTableDensity;
  onDensityChange?: (density: DataTableDensity) => void;
  /** Show the compact/regular toggle in the toolbar. */
  showDensityToggle?: boolean;
  /** Show the column visibility menu in the toolbar. */
  showColumnMenu?: boolean;

  sorting?: SortingState;
  defaultSorting?: SortingState;
  onSortingChange?: (sorting: SortingState) => void;

  /** Adds the checkbox column and enables selection. */
  selectable?: boolean;
  rowSelection?: RowSelectionState;
  defaultRowSelection?: RowSelectionState;
  onRowSelectionChange?: (selection: RowSelectionState) => void;
  /** Rendered in place of the toolbar while rows are selected. */
  selectionToolbar?: (selection: DataTableSelection<TData>) => ReactNode;
  /** Per-row selectability. */
  canSelectRow?: (row: TData) => boolean;

  columnVisibility?: ColumnVisibilityState;
  defaultColumnVisibility?: ColumnVisibilityState;
  onColumnVisibilityChange?: (visibility: ColumnVisibilityState) => void;

  onRowClick?: (row: TData, event: MouseEvent<HTMLTableRowElement>) => void;
  /** Enter on a focused row (and double-click). */
  onRowActivate?: (row: TData) => void;
  /** Highlights the row (the one open in an inspector, for example). */
  isRowActive?: (row: TData) => boolean;
  rowClassName?: (row: TData) => string | undefined;

  stickyHeader?: boolean;
  /** Keep the first data column visible while scrolling horizontally. */
  stickyFirstColumn?: boolean;
  /** Drag column edges to resize. */
  resizable?: boolean;

  pagination?: boolean | DataTablePaginationOptions;
  /** Virtualise the body: always, never, or automatically past 100 rows. */
  virtualize?: boolean | "auto";
  /** Max height of the scroll container. Required for virtualisation (defaults to 560). */
  maxHeight?: number | string;

  /** Left side of the toolbar (a FilterBar, a search). */
  toolbar?: ReactNode;
  /** Right side of the toolbar, before the built-in controls. */
  toolbarEnd?: ReactNode;
  /** Extra footer content on the left, after the count. */
  footer?: ReactNode;
  hideFooter?: boolean;
  /** Noun used in the footer count, e.g. ["run", "runs"]. */
  itemLabel?: [singular: string, plural: string];

  "aria-label"?: string;
  className?: string;
  tableClassName?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const DATA_TABLE_SELECT_COLUMN = "__select";
const SELECT_WIDTH = 36;
const int = new Intl.NumberFormat("en-US");

function resolveUpdater<T>(updater: Updater<T>, prev: T): T {
  return typeof updater === "function" ? (updater as (old: T) => T)(prev) : updater;
}

function defaultRowId(row: RowData, index: number): string {
  if (!Array.isArray(row) && "id" in row) {
    const id: unknown = row.id;
    if (typeof id === "string" || typeof id === "number") return String(id);
  }
  return String(index);
}

/** Controlled/uncontrolled slice that accepts TanStack updaters. */
function useSlice<T>(
  value: T | undefined,
  defaultValue: T,
  onChange?: (next: T) => void,
): [T, (updater: Updater<T>) => void] {
  const [internal, setInternal] = useState<T>(defaultValue);
  const controlled = value !== undefined;
  const current = controlled ? value : internal;
  const ref = useLatestRef(current);
  const onChangeRef = useLatestRef(onChange);
  const set = useCallback(
    (updater: Updater<T>) => {
      const next = resolveUpdater(updater, ref.current);
      if (Object.is(next, ref.current)) return;
      ref.current = next;
      if (!controlled) setInternal(next);
      onChangeRef.current?.(next);
    },
    [controlled, ref, onChangeRef],
  );
  return [current, set];
}

function columnLabel<TData extends RowData>(header: DataTableHeader<TData>): string {
  const def = header.column.columnDef;
  if (def.meta?.title) return def.meta.title;
  if (typeof def.header === "string") return def.header;
  return header.column.id;
}

function cellAlignClass(meta: DataTableColumnMeta | undefined): string {
  if (!meta) return "";
  if (meta.numeric) return "justify-end text-right font-mono text-xs tabular";
  return cn(
    meta.align === "end" && "justify-end text-right",
    meta.align === "center" && "justify-center text-center",
    meta.mono && "font-mono text-xs tabular",
  );
}

function headerAlign(meta: DataTableColumnMeta | undefined): "start" | "center" | "end" {
  if (!meta) return "start";
  if (meta.numeric) return "end";
  return meta.align ?? "start";
}

/**
 * Columns are flex items: they shrink down to `minSize` when the container is
 * narrower than the sum of sizes, and the `grow` column absorbs spare width.
 * Header and body cells share these rules so they stay aligned.
 */
function widthStyle(
  size: number,
  meta: DataTableColumnMeta | undefined,
  minSize?: number,
): CSSProperties {
  return {
    width: size,
    minWidth: Math.min(size, minSize ?? size),
    flex: meta?.grow ? `1 1 ${size}px` : `0 1 ${size}px`,
  };
}

const EMPTY_SORTING: SortingState = [];
const EMPTY_SELECTION: RowSelectionState = {};
const EMPTY_VISIBILITY: ColumnVisibilityState = {};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * The library's table. Sorting (shift for multi), sticky header, column
 * menu, density, row selection with a toolbar slot, keyboard row focus
 * (arrows, Enter, Space), skeleton/empty/error states, resizable columns,
 * an optional sticky first column, pagination and a virtualised body past
 * 100 rows. Purely presentational: data in, callbacks out.
 */
export function DataTable<TData extends RowData>(props: DataTableProps<TData>) {
  const {
    columns,
    data,
    getRowId,
    loading = false,
    skeletonRows = 8,
    error = null,
    emptyState,
    density: densityProp,
    defaultDensity = "regular",
    onDensityChange,
    showDensityToggle = true,
    showColumnMenu = true,
    sorting: sortingProp,
    defaultSorting = EMPTY_SORTING,
    onSortingChange,
    selectable = false,
    rowSelection: rowSelectionProp,
    defaultRowSelection = EMPTY_SELECTION,
    onRowSelectionChange,
    selectionToolbar,
    canSelectRow,
    columnVisibility: columnVisibilityProp,
    defaultColumnVisibility = EMPTY_VISIBILITY,
    onColumnVisibilityChange,
    onRowClick,
    onRowActivate,
    isRowActive,
    rowClassName,
    stickyHeader = true,
    stickyFirstColumn = false,
    resizable = true,
    pagination = false,
    virtualize = "auto",
    maxHeight,
    toolbar,
    toolbarEnd,
    footer,
    hideFooter = false,
    itemLabel = ["row", "rows"],
    "aria-label": ariaLabel,
    className,
    tableClassName,
  } = props;

  const [density, setDensityState] = useSlice<DataTableDensity>(
    densityProp,
    defaultDensity,
    onDensityChange,
  );
  const [sorting, setSorting] = useSlice<SortingState>(
    sortingProp,
    defaultSorting,
    onSortingChange,
  );
  const [rowSelection, setRowSelection] = useSlice<RowSelectionState>(
    rowSelectionProp,
    defaultRowSelection,
    onRowSelectionChange,
  );
  const [columnVisibility, setColumnVisibility] = useSlice<ColumnVisibilityState>(
    columnVisibilityProp,
    defaultColumnVisibility,
    onColumnVisibilityChange,
  );

  const paginationOptions: DataTablePaginationOptions | null =
    pagination === false ? null : pagination === true ? {} : pagination;
  const [paginationState, setPaginationState] = useSlice<PaginationState>(
    paginationOptions?.pageIndex !== undefined
      ? { pageIndex: paginationOptions.pageIndex, pageSize: paginationOptions.pageSize ?? 50 }
      : undefined,
    { pageIndex: 0, pageSize: paginationOptions?.pageSize ?? 50 },
    (next) => {
      paginationOptions?.onPageIndexChange?.(next.pageIndex);
      paginationOptions?.onPageSizeChange?.(next.pageSize);
    },
  );

  const rowHeight = DATA_TABLE_ROW_HEIGHT[density];

  // Selection column, prepended when selectable.
  const lastSelectedRef = useRef<string | null>(null);
  const allColumns = useMemo<DataTableColumns<TData>>(() => {
    if (!selectable) return columns;
    const helper = createColumnHelper<DataTableFeatures, TData>();
    const select = helper.display({
      id: DATA_TABLE_SELECT_COLUMN,
      size: SELECT_WIDTH,
      minSize: SELECT_WIDTH,
      maxSize: SELECT_WIDTH,
      enableSorting: false,
      enableHiding: false,
      enableResizing: false,
      meta: { locked: true, align: "center" },
      header: ({ table }) => {
        const all = table.getIsAllRowsSelected();
        const some = table.getIsSomeRowsSelected();
        return (
          <Checkbox
            size="sm"
            aria-label="Select all rows"
            checked={all ? true : some ? "indeterminate" : false}
            onCheckedChange={(v) => table.toggleAllRowsSelected(v === true)}
          />
        );
      },
      cell: ({ row, table }) => (
        <Checkbox
          size="sm"
          aria-label={`Select row ${row.getDisplayIndex() + 1}`}
          checked={row.getIsSelected()}
          disabled={!row.getCanSelect()}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            const rows = table.getRowModel().rows;
            const last = lastSelectedRef.current;
            if (e.shiftKey && last !== null && last !== row.id) {
              const a = rows.findIndex((r) => r.id === last);
              const b = rows.findIndex((r) => r.id === row.id);
              if (a >= 0 && b >= 0) {
                const [lo, hi] = a < b ? [a, b] : [b, a];
                const next: RowSelectionState = { ...table.atoms.rowSelection.get() };
                for (let i = lo; i <= hi; i++) {
                  const r = rows[i];
                  if (r && r.getCanSelect()) next[r.id] = true;
                }
                table.setRowSelection(next);
                return;
              }
            }
            lastSelectedRef.current = row.id;
            row.toggleSelected();
          }}
        />
      ),
    });
    return [select, ...columns];
  }, [columns, selectable]);

  const table = useTable<DataTableFeatures, TData>({
    features: dataTableFeatures,
    columns: allColumns,
    data,
    getRowId: getRowId ?? defaultRowId,
    enableSorting: true,
    enableMultiSort: true,
    enableSortingRemoval: true,
    enableRowSelection: selectable
      ? canSelectRow
        ? (row) => canSelectRow(row.original)
        : true
      : false,
    enableColumnResizing: resizable,
    columnResizeMode: "onChange",
    manualPagination: paginationOptions?.total !== undefined,
    rowCount: paginationOptions?.total,
    state: {
      sorting,
      rowSelection,
      columnVisibility,
      pagination: paginationState,
    },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPaginationState,
  });

  const rowModel = paginationOptions ? table.getPaginatedRowModel() : table.getSortedRowModel();
  const rows = rowModel.rows;
  const totalRows = paginationOptions?.total ?? table.getPrePaginatedRowModel().rows.length;
  const selectedIds = table.getSelectedRowIds();
  const selectedCount = selectedIds.length;
  const headers = table.getFlatHeaders().filter((h) => h.column.getIsVisible());
  // Below this width the table scrolls horizontally instead of squeezing columns.
  const minTableWidth = headers.reduce(
    (sum, h) => sum + Math.min(h.getSize(), h.column.columnDef.minSize ?? h.getSize()),
    0,
  );

  // Virtualisation
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const isVirtual = virtualize === true || (virtualize === "auto" && rows.length > 100);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 8,
    enabled: isVirtual,
    getItemKey: (index) => rows[index]?.id ?? index,
  });
  const virtualItems = isVirtual ? virtualizer.getVirtualItems() : null;

  // Keyboard row focus (roving tabindex).
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);
  const pendingFocus = useRef<string | null>(null);
  const bodyRef = useRef<HTMLTableSectionElement | null>(null);

  const focusRowAt = useCallback(
    (index: number) => {
      const row = rows[index];
      if (!row) return;
      if (isVirtual) virtualizer.scrollToIndex(index, { align: "auto" });
      pendingFocus.current = row.id;
      setFocusedRowId(row.id);
    },
    [rows, isVirtual, virtualizer],
  );

  useEffect(() => {
    const id = pendingFocus.current;
    if (id === null) return;
    const el = bodyRef.current?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`);
    if (el) {
      pendingFocus.current = null;
      el.focus({ preventScroll: isVirtual });
    }
  });

  // Row navigation is handled on the grid (the interactive element); it only acts when a
  // body row itself is focused, so header controls keep their own keys.
  const onGridKeyDown = (e: KeyboardEvent<HTMLTableElement>) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const tr = target.closest<HTMLElement>("[data-row-id]");
    if (!tr || tr !== target) return; // only when the row itself is focused
    const id = tr.dataset.rowId ?? "";
    const index = rows.findIndex((r) => r.id === id);
    if (index < 0) return;
    const row = rows[index];
    if (!row) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        focusRowAt(Math.min(rows.length - 1, index + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        focusRowAt(Math.max(0, index - 1));
        break;
      case "Home":
        e.preventDefault();
        focusRowAt(0);
        break;
      case "End":
        e.preventDefault();
        focusRowAt(rows.length - 1);
        break;
      case "PageDown":
        e.preventDefault();
        focusRowAt(Math.min(rows.length - 1, index + 10));
        break;
      case "PageUp":
        e.preventDefault();
        focusRowAt(Math.max(0, index - 10));
        break;
      case "Enter":
        if (onRowActivate) {
          e.preventDefault();
          onRowActivate(row.original);
        }
        break;
      case " ":
        if (selectable && row.getCanSelect()) {
          e.preventDefault();
          lastSelectedRef.current = row.id;
          row.toggleSelected();
        }
        break;
      case "Escape":
        if (selectedCount > 0) {
          e.preventDefault();
          table.resetRowSelection(true);
        }
        break;
      default:
        break;
    }
  };

  const selection: DataTableSelection<TData> = {
    rows: table.getSelectedRowModel().rows.map((r) => r.original),
    count: selectedCount,
    clear: () => table.resetRowSelection(true),
  };

  const hasToolbar = Boolean(toolbar || toolbarEnd || showColumnMenu || showDensityToggle);
  const showSelectionBar = selectedCount > 0 && Boolean(selectionToolbar);
  const showSkeleton = loading && data.length === 0 && !error;
  const showEmpty = !loading && !error && rows.length === 0;
  const hideableColumns = table
    .getAllLeafColumns()
    .filter((c) => c.getCanHide() && !c.columnDef.meta?.locked);
  const stickyOffsets = useMemo(() => {
    // Left offsets for the sticky selection column + first data column.
    const map = new Map<string, number>();
    if (!stickyFirstColumn) return map;
    let left = 0;
    let dataSeen = false;
    for (const h of headers) {
      if (h.column.id === DATA_TABLE_SELECT_COLUMN) {
        map.set(h.column.id, left);
        left += h.getSize();
      } else if (!dataSeen) {
        map.set(h.column.id, left);
        dataSeen = true;
      }
    }
    return map;
  }, [headers, stickyFirstColumn]);

  // Keyframes come from primitives.css; --dur-fast collapses to 0 under reduced motion.
  const enterClass = "animate-[fa-fade-in_var(--dur-fast)_var(--ease-out)_both]";

  const cellBase = cn(
    "flex min-w-0 items-center gap-2 overflow-hidden border-b border-border px-3 text-xs text-ink",
  );
  const stickyCellClass =
    "sticky z-[1] bg-surface shadow-[1px_0_0_var(--border)] group-data-[selected]/row:bg-surface";

  const renderHeaderCell = (header: DataTableHeader<TData>) => {
    const column = header.column;
    const meta = column.columnDef.meta;
    const sorted = column.getIsSorted();
    const canSort = column.getCanSort();
    const stickyLeft = stickyOffsets.get(column.id);
    const isResizing = column.getIsResizing();
    return (
      <th
        key={header.id}
        role="columnheader"
        scope="col"
        aria-sort={
          sorted === "asc"
            ? "ascending"
            : sorted === "desc"
              ? "descending"
              : canSort
                ? "none"
                : undefined
        }
        data-column={column.id}
        style={{
          ...widthStyle(header.getSize(), meta, column.columnDef.minSize),
          ...(stickyLeft !== undefined ? { left: stickyLeft } : null),
        }}
        className={cn(
          "group/th relative flex h-8 min-w-0 items-center gap-1 border-b border-border bg-surface-2 px-3 text-left text-2xs font-medium text-ink-2",
          meta?.numeric || meta?.align === "end"
            ? "justify-end"
            : meta?.align === "center"
              ? "justify-center"
              : "",
          stickyLeft !== undefined && cn(stickyCellClass, "bg-surface-2"),
          meta?.headerClassName,
        )}
      >
        {header.isPlaceholder ? null : column.id === DATA_TABLE_SELECT_COLUMN ? (
          <table.FlexRender header={header} />
        ) : (
          <SortableHeader
            canSort={canSort}
            sorted={sorted}
            sortIndex={column.getSortIndex()}
            multiCount={sorting.length}
            align={headerAlign(meta)}
            onClick={column.getToggleSortingHandler()}
          >
            <table.FlexRender header={header} />
          </SortableHeader>
        )}
        {resizable && column.getCanResize() ? (
          // A focusable window splitter (WAI-ARIA separator pattern): drag with the pointer,
          // or focus it and use ←/→ (Shift for larger steps); Enter or a double click resets.
          // jsx-a11y classifies every separator as non-interactive, but a focusable one with
          // aria-valuenow is a widget (WAI-ARIA 1.2), so its handlers are legitimate.
          // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- focusable window splitter
          <div
            role="separator"
            tabIndex={0}
            aria-orientation="vertical"
            aria-label={`Resize ${columnLabel(header)} column`}
            aria-valuenow={header.getSize()}
            aria-valuemin={column.columnDef.minSize}
            aria-valuemax={column.columnDef.maxSize}
            onMouseDown={header.getResizeHandler()}
            onTouchStart={header.getResizeHandler()}
            onDoubleClick={() => column.resetSize()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                column.resetSize();
                return;
              }
              if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
              e.preventDefault();
              const step = (e.shiftKey ? 64 : 16) * (e.key === "ArrowLeft" ? -1 : 1);
              const next = column.getSize() + step;
              table.setColumnSizing((prev) => ({ ...prev, [column.id]: next }));
            }}
            className={cn(
              "absolute -right-1 top-0 z-[2] flex h-full w-2 cursor-col-resize touch-none select-none items-center justify-center outline-none",
              "focus-visible:[&>span]:h-full focus-visible:[&>span]:bg-accent focus-visible:[&>span]:opacity-100",
            )}
          >
            <span
              className={cn(
                "h-4 w-px bg-border-strong opacity-0 transition-opacity duration-(--dur-fast) group-hover/th:opacity-100",
                isResizing && "h-full bg-accent opacity-100",
              )}
            />
          </div>
        ) : null}
      </th>
    );
  };

  const renderRow = (row: DataTableRow<TData>, index: number, style?: CSSProperties) => {
    const selected = row.getIsSelected();
    const active = isRowActive?.(row.original) ?? false;
    const focusable = focusedRowId === null ? index === 0 : focusedRowId === row.id;
    const clickable = Boolean(onRowClick || onRowActivate);
    return (
      <tr
        key={row.id}
        role="row"
        data-row-id={row.id}
        data-index={index}
        data-selected={selected || undefined}
        data-active={active || undefined}
        aria-selected={selectable ? selected : undefined}
        tabIndex={focusable ? 0 : -1}
        onFocus={() => setFocusedRowId(row.id)}
        onClick={(e) => {
          setFocusedRowId(row.id);
          onRowClick?.(row.original, e);
        }}
        onDoubleClick={() => onRowActivate?.(row.original)}
        style={{ height: rowHeight, ...style }}
        className={cn(
          "group/row flex w-full outline-none transition-colors duration-(--dur-fast)",
          "hover:bg-surface-2 focus-visible:shadow-[inset_0_0_0_1.5px_var(--accent)]",
          clickable && "cursor-pointer",
          selected && "bg-accent-soft/60 hover:bg-accent-soft/80",
          active && "bg-surface-3",
          rowClassName?.(row.original),
        )}
      >
        {row.getVisibleCells().map((cell) => {
          const meta = cell.column.columnDef.meta;
          const stickyLeft = stickyOffsets.get(cell.column.id);
          return (
            <td
              key={cell.id}
              role="gridcell"
              data-column={cell.column.id}
              style={{
                ...widthStyle(cell.column.getSize(), meta, cell.column.columnDef.minSize),
                ...(stickyLeft !== undefined ? { left: stickyLeft } : null),
              }}
              className={cn(
                cellBase,
                cellAlignClass(meta),
                stickyLeft !== undefined && stickyCellClass,
                selected && stickyLeft !== undefined && "bg-accent-soft",
                meta?.className,
              )}
            >
              <table.FlexRender cell={cell} />
            </td>
          );
        })}
      </tr>
    );
  };

  const renderSkeletonRows = () =>
    Array.from({ length: skeletonRows }, (_, i) => (
      <tr
        key={`skeleton-${i}`}
        role="row"
        aria-hidden="true"
        className="flex w-full"
        style={{ height: rowHeight }}
      >
        {headers.map((h, j) => {
          const meta = h.column.columnDef.meta;
          const widths = [72, 56, 88, 64, 48];
          const w = widths[(i + j) % widths.length] ?? 64;
          return (
            <td
              key={h.id}
              role="gridcell"
              style={widthStyle(h.getSize(), meta, h.column.columnDef.minSize)}
              className={cn(cellBase, cellAlignClass(meta))}
            >
              {h.column.id === DATA_TABLE_SELECT_COLUMN ? (
                <Skeleton width={14} height={14} className="rounded-xs" />
              ) : (
                <Skeleton variant="text" width={`${Math.min(100, w)}%`} style={{ maxWidth: 160 }} />
              )}
            </td>
          );
        })}
      </tr>
    ));

  const scrollStyle: CSSProperties = {
    maxHeight: maxHeight ?? (isVirtual ? 560 : undefined),
  };

  const countText =
    selectedCount > 0
      ? `${int.format(selectedCount)} of ${int.format(totalRows)} selected`
      : `${int.format(totalRows)} ${totalRows === 1 ? itemLabel[0] : itemLabel[1]}`;

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-md border border-border bg-surface shadow-1",
        className,
      )}
      data-density={density}
    >
      {hasToolbar || selectionToolbar ? (
        <div className="relative flex h-10 shrink-0 items-center gap-2 border-b border-border px-2">
          {showSelectionBar ? (
            <div
              key="selection"
              className={cn("flex min-w-0 flex-1 items-center gap-2", enterClass)}
            >
              <span className="flex h-6 items-center gap-1.5 rounded-sm bg-accent-soft px-2 text-xs font-medium text-accent-text">
                <span className="font-mono tabular">{int.format(selectedCount)}</span> selected
                <IconButton
                  size="xs"
                  label="Clear selection"
                  onClick={selection.clear}
                  className="-mr-1 text-accent-text hover:bg-accent-soft-2 hover:text-accent-text"
                >
                  <X strokeWidth={2} />
                </IconButton>
              </span>
              <div className="flex min-w-0 flex-1 items-center gap-1">
                {selectionToolbar?.(selection)}
              </div>
            </div>
          ) : (
            <div
              key="toolbar"
              className={cn(
                "flex min-w-0 flex-1 items-center gap-2",
                selectionToolbar && enterClass,
              )}
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">{toolbar}</div>
              <div className="flex shrink-0 items-center gap-1">
                {toolbarEnd}
                {showDensityToggle ? (
                  <ToggleGroup
                    type="single"
                    size="sm"
                    aria-label="Row density"
                    value={density}
                    onValueChange={(v) => {
                      if (v === "compact" || v === "regular") setDensityState(v);
                    }}
                  >
                    <Tooltip content="Regular rows">
                      <ToggleGroupItem value="regular" aria-label="Regular rows">
                        <Rows2 strokeWidth={1.75} />
                      </ToggleGroupItem>
                    </Tooltip>
                    <Tooltip content="Compact rows">
                      <ToggleGroupItem value="compact" aria-label="Compact rows">
                        <Rows3 strokeWidth={1.75} />
                      </ToggleGroupItem>
                    </Tooltip>
                  </ToggleGroup>
                ) : null}
                {showColumnMenu ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <IconButton size="sm" label="Columns" variant="secondary">
                        <Settings2 strokeWidth={1.75} />
                      </IconButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-48">
                      <DropdownMenuLabel>Columns</DropdownMenuLabel>
                      {hideableColumns.map((c) => (
                        <DropdownMenuCheckboxItem
                          key={c.id}
                          checked={c.getIsVisible()}
                          onCheckedChange={(v) => c.toggleVisibility(v === true)}
                          onSelect={(e) => e.preventDefault()}
                        >
                          {c.columnDef.meta?.title ??
                            (typeof c.columnDef.header === "string" ? c.columnDef.header : c.id)}
                        </DropdownMenuCheckboxItem>
                      ))}
                      <DropdownMenuSeparator />
                      <DropdownMenuCheckboxItem
                        checked={table.getIsAllColumnsVisible()}
                        onCheckedChange={(v) => table.toggleAllColumnsVisible(v === true)}
                        onSelect={(e) => e.preventDefault()}
                      >
                        Show all
                      </DropdownMenuCheckboxItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
            </div>
          )}
        </div>
      ) : null}

      <div className="relative min-w-0">
        {loading && data.length > 0 ? (
          <ProgressBar
            size="sm"
            label="Refreshing"
            className="absolute inset-x-0 top-0 z-[3] h-0.5 rounded-none"
          />
        ) : null}
        <div ref={scrollRef} className="relative overflow-auto" style={scrollStyle}>
          <table
            role="grid"
            aria-label={ariaLabel}
            aria-rowcount={totalRows}
            aria-multiselectable={selectable || undefined}
            aria-busy={loading || undefined}
            onKeyDown={onGridKeyDown}
            className={cn("block w-full border-collapse text-sm", tableClassName)}
            style={{ minWidth: minTableWidth }}
          >
            <thead
              role="rowgroup"
              className={cn("block", stickyHeader && "sticky top-0 z-[2] bg-surface-2")}
            >
              <tr role="row" className="flex w-full">
                {headers.map(renderHeaderCell)}
              </tr>
            </thead>
            <tbody
              ref={bodyRef}
              role="rowgroup"
              className="relative block"
              style={isVirtual ? { height: virtualizer.getTotalSize() } : undefined}
            >
              {showSkeleton
                ? renderSkeletonRows()
                : virtualItems
                  ? virtualItems.map((item) => {
                      const row = rows[item.index];
                      if (!row) return null;
                      return renderRow(row, item.index, {
                        position: "absolute",
                        top: 0,
                        left: 0,
                        transform: `translateY(${item.start}px)`,
                      });
                    })
                  : rows.map((row, i) => renderRow(row, i))}
            </tbody>
          </table>
          {error ? (
            <div role="alert" className="flex flex-col items-center gap-3 px-6 py-10 text-center">
              <span className="flex size-10 items-center justify-center rounded-md border border-border bg-danger-soft text-danger-text shadow-1">
                <TriangleAlert className="size-5" strokeWidth={1.75} />
              </span>
              <div className="flex max-w-sm flex-col gap-1">
                <p className="text-base font-medium tracking-tight text-ink">
                  {error.title ?? "Couldn't load this list"}
                </p>
                <p className="text-sm text-ink-3">{error.message}</p>
              </div>
              {error.onRetry ? (
                <Button variant="secondary" onClick={error.onRetry}>
                  Retry
                </Button>
              ) : null}
            </div>
          ) : showEmpty ? (
            (emptyState ?? (
              <EmptyState
                size="sm"
                icon={<Inbox strokeWidth={1.75} />}
                title={`No ${itemLabel[1]}`}
                description="Nothing matches yet."
              />
            ))
          ) : null}
        </div>
      </div>

      {!hideFooter ? (
        <div className="flex h-9 shrink-0 items-center justify-between gap-3 border-t border-border px-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="truncate font-mono text-xs text-ink-3 tabular" aria-live="polite">
              {countText}
            </span>
            {footer}
          </div>
          {paginationOptions ? (
            <Pagination
              pageIndex={paginationState.pageIndex}
              pageSize={paginationState.pageSize}
              total={totalRows}
              pageSizeOptions={paginationOptions.pageSizeOptions}
              onPageIndexChange={(i) => table.setPageIndex(i)}
              onPageSizeChange={(s) => table.setPageSize(s)}
              disabled={loading && data.length === 0}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
