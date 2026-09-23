import { forwardRef, useMemo, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import { Check, ListFilter, Plus, X } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  ORIGIN_LABEL,
  RUN_ORIGINS,
  RUN_STATUSES,
  STATUS_LABEL,
  isRunOrigin,
  isRunStatus,
  type RunOrigin,
  type RunStatus,
} from "@/lib/categories";
import type { EnvironmentId, EnvironmentView, RunView } from "@/types";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SearchInput,
  StatusChip,
} from "@/primitives";
import {
  DateRangePanel,
  formatDateRangeLabel,
  parseDateRangeValue,
  resolveDateRange,
  serializeDateRangeValue,
  type DateRangeValue,
} from "./DateRangePicker";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Facets a run list can be narrowed by. `range` is the created-at window. */
export type RunFilterFacet =
  "status" | "workflow" | "version" | "environment" | "provider" | "model" | "origin" | "range";

export const RUN_FILTER_FACETS: readonly RunFilterFacet[] = [
  "status",
  "workflow",
  "version",
  "environment",
  "provider",
  "model",
  "origin",
  "range",
];

/** The typed filter object the bar emits. Empty arrays are treated as absent. */
export interface RunFilters {
  search?: string;
  status?: RunStatus[];
  workflow?: string[];
  version?: string[];
  /** Environment ids (environments are workspace data, see `FilterBarProps.environments`). */
  environment?: EnvironmentId[];
  provider?: string[];
  model?: string[];
  origin?: RunOrigin[];
  range?: DateRangeValue;
}

export interface FilterFacetOption {
  value: string;
  label: string;
  /** Mono count at the right edge. */
  count?: number;
  /** Secondary text. */
  hint?: string;
}

/** Choices per facet. Status and origin default to every schema value; environment defaults to the `environments` prop. */
export interface FilterBarOptions {
  status?: FilterFacetOption[];
  workflow?: FilterFacetOption[];
  version?: FilterFacetOption[];
  environment?: FilterFacetOption[];
  provider?: FilterFacetOption[];
  model?: FilterFacetOption[];
  origin?: FilterFacetOption[];
}

export const FACET_LABEL: Record<RunFilterFacet, string> = {
  status: "Status",
  workflow: "Workflow",
  version: "Version",
  environment: "Environment",
  provider: "Provider",
  model: "Model",
  origin: "Origin",
  range: "Created",
};

export const DEFAULT_STATUS_OPTIONS: FilterFacetOption[] = RUN_STATUSES.map((s) => ({
  value: s,
  label: STATUS_LABEL[s],
}));
export const DEFAULT_ORIGIN_OPTIONS: FilterFacetOption[] = RUN_ORIGINS.map((o) => ({
  value: o,
  label: ORIGIN_LABEL[o],
}));

/** Facet options for the workspace's environments. */
export function environmentOptions(environments: readonly EnvironmentView[]): FilterFacetOption[] {
  return environments.map((e) => ({ value: e.id, label: e.name }));
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

type MultiFacet = Exclude<RunFilterFacet, "range">;
const MULTI_FACETS: readonly MultiFacet[] = [
  "status",
  "workflow",
  "version",
  "environment",
  "provider",
  "model",
  "origin",
];

const PARAM_KEY: Record<RunFilterFacet, string> = {
  status: "status",
  workflow: "workflow",
  version: "version",
  environment: "env",
  provider: "provider",
  model: "model",
  origin: "origin",
  range: "range",
};

function values(filters: RunFilters, facet: MultiFacet): string[] {
  return filters[facet] ?? [];
}

/** Drops empty arrays and blank search so equal filters serialise identically. */
export function normalizeFilters(filters: RunFilters): RunFilters {
  const out: RunFilters = {};
  const search = filters.search?.trim();
  if (search) out.search = search;
  if (filters.status?.length) out.status = [...new Set(filters.status)];
  if (filters.workflow?.length) out.workflow = [...new Set(filters.workflow)];
  if (filters.version?.length) out.version = [...new Set(filters.version)];
  if (filters.environment?.length) out.environment = [...new Set(filters.environment)];
  if (filters.provider?.length) out.provider = [...new Set(filters.provider)];
  if (filters.model?.length) out.model = [...new Set(filters.model)];
  if (filters.origin?.length) out.origin = [...new Set(filters.origin)];
  if (filters.range) out.range = filters.range;
  return out;
}

/** Number of active facets (search counts as one). */
export function countActiveFilters(filters: RunFilters): number {
  const f = normalizeFilters(filters);
  let n = f.search ? 1 : 0;
  for (const facet of MULTI_FACETS) if (f[facet]?.length) n++;
  if (f.range) n++;
  return n;
}

/**
 * URL-style query string, e.g. `q=refund&status=failed,timed_out&range=7d`.
 * Keys are emitted in a fixed order so equal filters produce equal strings.
 */
export function serializeFilters(filters: RunFilters): string {
  const f = normalizeFilters(filters);
  const params = new URLSearchParams();
  if (f.search) params.set("q", f.search);
  for (const facet of MULTI_FACETS) {
    const list = f[facet];
    if (list?.length) params.set(PARAM_KEY[facet], list.map(encodeURIComponent).join(","));
  }
  if (f.range) params.set("range", serializeDateRangeValue(f.range));
  return params.toString();
}

/** Inverse of `serializeFilters`. Unknown statuses and origins are dropped; environment ids are workspace data and kept as given. */
export function parseFilters(input: string | URLSearchParams): RunFilters {
  const params =
    input instanceof URLSearchParams ? input : new URLSearchParams(input.replace(/^\?/, ""));
  const list = (key: string): string[] =>
    (params.get(key) ?? "")
      .split(",")
      .map((v) => {
        try {
          return decodeURIComponent(v).trim();
        } catch {
          return "";
        }
      })
      .filter((v) => v.length > 0);
  const out: RunFilters = {};
  const q = params.get("q")?.trim();
  if (q) out.search = q;
  const status = list(PARAM_KEY.status).filter(isRunStatus);
  if (status.length) out.status = status;
  const workflow = list(PARAM_KEY.workflow);
  if (workflow.length) out.workflow = workflow;
  const version = list(PARAM_KEY.version);
  if (version.length) out.version = version;
  const environment = list(PARAM_KEY.environment);
  if (environment.length) out.environment = environment;
  const provider = list(PARAM_KEY.provider);
  if (provider.length) out.provider = provider;
  const model = list(PARAM_KEY.model);
  if (model.length) out.model = model;
  const origin = list(PARAM_KEY.origin).filter(isRunOrigin);
  if (origin.length) out.origin = origin;
  const range = parseDateRangeValue(params.get("range"));
  if (range) out.range = range;
  return out;
}

/** Client-side filtering of runs. Search matches id, workflow name and error text. */
export function applyRunFilters(
  runs: readonly RunView[],
  filters: RunFilters,
  now: Date = new Date(),
): RunView[] {
  const f = normalizeFilters(filters);
  const q = f.search?.toLowerCase();
  const range = f.range ? resolveDateRange(f.range, now) : null;
  const status = f.status ? new Set<string>(f.status) : null;
  const workflow = f.workflow ? new Set(f.workflow) : null;
  const version = f.version ? new Set(f.version) : null;
  const environment = f.environment ? new Set<string>(f.environment) : null;
  const provider = f.provider ? new Set(f.provider) : null;
  const model = f.model ? new Set(f.model) : null;
  const origin = f.origin ? new Set<string>(f.origin) : null;
  return runs.filter((run) => {
    if (status && !status.has(run.status)) return false;
    if (workflow && !workflow.has(run.workflowId)) return false;
    if (version && !version.has(String(run.version))) return false;
    if (environment && (!run.environment || !environment.has(run.environment.id))) return false;
    if (origin && !origin.has(run.origin)) return false;
    if (provider && !run.nodeRuns.some((n) => n.decision && provider.has(n.decision.provider)))
      return false;
    if (model && !run.nodeRuns.some((n) => n.decision && model.has(n.decision.model))) return false;
    if (range) {
      const t = new Date(run.createdAt).getTime();
      if (t < range.from.getTime() || t > range.to.getTime()) return false;
    }
    if (q) {
      const hay = `${run.id} ${run.workflowName} ${run.error?.message ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// Chips
// ---------------------------------------------------------------------------

interface FacetChipProps {
  facet: RunFilterFacet;
  summary: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRemove: () => void;
  children: ReactNode;
  width?: number | "auto";
}

function FacetChip({
  facet,
  summary,
  open,
  onOpenChange,
  onRemove,
  children,
  width = 240,
}: FacetChipProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <span
        data-facet={facet}
        className={cn(
          "inline-flex h-6 max-w-full shrink-0 items-stretch overflow-hidden rounded-sm border border-border bg-surface text-xs shadow-1",
          open && "border-accent",
        )}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex min-w-0 cursor-pointer items-center gap-1 pl-2 pr-1.5 transition-colors duration-(--dur-fast) hover:bg-surface-3"
          >
            <span className="text-ink-3">{FACET_LABEL[facet]}</span>
            <span className="text-ink-3">is</span>
            <span className="min-w-0 truncate font-medium text-ink">{summary}</span>
          </button>
        </PopoverTrigger>
        <button
          type="button"
          aria-label={`Remove ${FACET_LABEL[facet]} filter`}
          onClick={onRemove}
          className="flex w-5 shrink-0 cursor-pointer items-center justify-center border-l border-border text-ink-3 transition-colors duration-(--dur-fast) hover:bg-surface-3 hover:text-ink"
        >
          <X className="size-3" strokeWidth={2} />
        </button>
      </span>
      <PopoverContent bare width={width} align="start" className="max-w-[calc(100vw-16px)]">
        {children}
      </PopoverContent>
    </Popover>
  );
}

interface FacetListProps {
  facet: MultiFacet;
  options: FilterFacetOption[];
  selected: string[];
  onChange: (next: string[]) => void;
}

function FacetList({ facet, options, selected, onChange }: FacetListProps) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const visible = q
    ? options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q))
    : options;
  const set = new Set(selected);
  const toggle = (value: string) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(options.filter((o) => next.has(o.value)).map((o) => o.value));
  };
  return (
    <div className="flex flex-col">
      {options.length > 7 ? (
        <div className="border-b border-border p-1.5">
          <SearchInput
            size="sm"
            placeholder={`Filter ${FACET_LABEL[facet].toLowerCase()}…`}
            value={query}
            onValueChange={setQuery}
            aria-label={`Search ${FACET_LABEL[facet].toLowerCase()}`}
          />
        </div>
      ) : null}
      <ul
        role="listbox"
        aria-multiselectable="true"
        aria-label={FACET_LABEL[facet]}
        className="max-h-72 overflow-auto p-1"
      >
        {visible.length === 0 ? (
          <li className="px-2 py-3 text-center text-xs text-ink-3">No matches</li>
        ) : null}
        {visible.map((o) => {
          const on = set.has(o.value);
          return (
            <li key={o.value}>
              <button
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => toggle(o.value)}
                className={cn(
                  "flex h-7 w-full items-center gap-2 rounded-xs px-2 text-left text-xs text-ink",
                  "transition-colors duration-(--dur-fast) hover:bg-surface-3",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-3.5 shrink-0 items-center justify-center rounded-xs border border-border-strong bg-surface",
                    on && "border-accent bg-accent text-accent-ink",
                  )}
                >
                  {on ? <Check className="size-2.5" strokeWidth={3} /> : null}
                </span>
                {facet === "status" && isRunStatus(o.value) ? (
                  <StatusChip status={o.value} size="sm" />
                ) : (
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate",
                      (facet === "model" || facet === "version") && "font-mono",
                    )}
                  >
                    {o.label}
                  </span>
                )}
                {o.hint ? <span className="truncate text-2xs text-ink-3">{o.hint}</span> : null}
                {o.count !== undefined ? (
                  <span className="ml-auto font-mono text-2xs text-ink-3 tabular">{o.count}</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
      {selected.length > 0 ? (
        <div className="flex items-center justify-between border-t border-border px-2 py-1">
          <span className="font-mono text-2xs text-ink-3 tabular">{selected.length} selected</span>
          <Button variant="ghost" size="sm" onClick={() => onChange([])}>
            Clear
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FilterBar
// ---------------------------------------------------------------------------

export interface FilterBarProps extends Omit<HTMLAttributes<HTMLDivElement>, "onChange"> {
  value: RunFilters;
  onChange: (filters: RunFilters) => void;
  options?: FilterBarOptions;
  /** The workspace's environments (`{ id, name, protected }[]`); the default choices of the environment facet. */
  environments?: readonly EnvironmentView[];
  /** Facets offered in the "Add filter" menu; defaults to all. */
  facets?: readonly RunFilterFacet[];
  searchPlaceholder?: string;
  /** Hide the free-text search. */
  hideSearch?: boolean;
  /** Reference time for relative ranges (tests). */
  now?: Date;
}

/**
 * Facet filter chips ("Status is Failed, Timed out") with an "Add filter"
 * menu, chip removal, clear all and free-text search. Emits a `RunFilters`
 * object; pair with `serializeFilters`/`parseFilters` to sync it to a URL.
 */
export const FilterBar = forwardRef<HTMLDivElement, FilterBarProps>(function FilterBar(
  {
    value,
    onChange,
    options,
    environments,
    facets = RUN_FILTER_FACETS,
    searchPlaceholder = "Search runs",
    hideSearch = false,
    now,
    className,
    ...rest
  },
  ref,
) {
  const [openFacet, setOpenFacet] = useState<RunFilterFacet | null>(null);
  // Facet chosen from the menu; opened once the menu has closed so its focus
  // return does not dismiss the new popover.
  const pendingFacet = useRef<RunFilterFacet | null>(null);
  const filters = useMemo(() => normalizeFilters(value), [value]);

  const optionsFor = (facet: MultiFacet): FilterFacetOption[] => {
    const given = options?.[facet];
    if (given) return given;
    if (facet === "status") return DEFAULT_STATUS_OPTIONS;
    if (facet === "origin") return DEFAULT_ORIGIN_OPTIONS;
    if (facet === "environment") return environments ? environmentOptions(environments) : [];
    return [];
  };

  const labelFor = (facet: MultiFacet, v: string): string =>
    optionsFor(facet).find((o) => o.value === v)?.label ?? v;

  const summaryFor = (facet: MultiFacet): ReactNode => {
    const list = values(filters, facet);
    if (list.length === 0) return <span className="text-ink-3">any</span>;
    const first = list[0];
    if (first === undefined) return null;
    if (list.length === 1) return labelFor(facet, first);
    if (list.length === 2) {
      const second = list[1];
      return `${labelFor(facet, first)}, ${second !== undefined ? labelFor(facet, second) : ""}`;
    }
    return (
      <>
        {labelFor(facet, first)} <span className="text-ink-3">+{list.length - 1}</span>
      </>
    );
  };

  const update = (patch: Partial<RunFilters>) =>
    onChange(normalizeFilters({ ...filters, ...patch }));

  const active: RunFilterFacet[] = facets.filter((f) =>
    f === "range" ? Boolean(filters.range) : values(filters, f).length > 0 || openFacet === f,
  );
  const available = facets.filter((f) => !active.includes(f));
  const count = countActiveFilters(filters);

  return (
    <div
      ref={ref}
      role="group"
      aria-label="Filters"
      className={cn("flex min-w-0 flex-wrap items-center gap-1.5", className)}
      {...rest}
    >
      {!hideSearch ? (
        <SearchInput
          size="sm"
          placeholder={searchPlaceholder}
          value={filters.search ?? ""}
          onValueChange={(v) => update({ search: v })}
          className="w-52 max-w-full"
          aria-label={searchPlaceholder}
        />
      ) : null}

      {active.map((facet) =>
        facet === "range" ? (
          <FacetChip
            key={facet}
            facet={facet}
            summary={formatDateRangeLabel(filters.range)}
            open={openFacet === facet}
            onOpenChange={(o) => setOpenFacet(o ? facet : null)}
            onRemove={() => {
              setOpenFacet(null);
              update({ range: undefined });
            }}
            width="auto"
          >
            <DateRangePanel
              value={filters.range}
              now={now}
              clearable={false}
              onChange={(r) => update({ range: r ?? undefined })}
              onDone={() => setOpenFacet(null)}
            />
          </FacetChip>
        ) : (
          <FacetChip
            key={facet}
            facet={facet}
            summary={summaryFor(facet)}
            open={openFacet === facet}
            onOpenChange={(o) => setOpenFacet(o ? facet : null)}
            onRemove={() => {
              setOpenFacet(null);
              update({ [facet]: undefined });
            }}
          >
            <FacetList
              facet={facet}
              options={optionsFor(facet)}
              selected={values(filters, facet)}
              onChange={(next) => update({ [facet]: next })}
            />
          </FacetChip>
        ),
      )}

      {available.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              leadingIcon={
                count === 0 ? <ListFilter strokeWidth={1.75} /> : <Plus strokeWidth={1.75} />
              }
              className="text-ink-3 hover:text-ink"
            >
              {count === 0 ? "Filter" : "Add filter"}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="min-w-40"
            onCloseAutoFocus={(e) => {
              const facet = pendingFacet.current;
              if (!facet) return;
              pendingFacet.current = null;
              e.preventDefault();
              setOpenFacet(facet);
            }}
          >
            {available.map((facet) => (
              <DropdownMenuItem
                key={facet}
                onSelect={() => {
                  pendingFacet.current = facet;
                }}
              >
                {FACET_LABEL[facet]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      {count > 0 ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setOpenFacet(null);
            onChange({});
          }}
          className="text-ink-3 hover:text-ink"
        >
          Clear all
        </Button>
      ) : null}
    </div>
  );
});
