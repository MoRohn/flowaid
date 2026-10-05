"use client";
/**
 * The runs list (all runs, or one workflow's): FilterBar state in the URL, server-side filters
 * where the API has them (search, created range, statuses, one origin, environment or workflow),
 * the rest applied to the loaded runs, cursor pagination, and a 3 s refresh while any listed run is
 * still active. While older runs exist the count says "loaded", and a sort other than newest
 * first says it orders the loaded runs.
 */
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Play } from "lucide-react";
import { Button, EmptyState, toast } from "@flowaid/ui/primitives";
import {
  FilterBar,
  RunsTable,
  applyRunFilters,
  normalizeFilters,
  parseFilters,
  resolveDateRange,
  serializeFilters,
  type DateRangeValue,
  type RunFilterFacet,
  type RunFilters,
} from "@flowaid/ui/data";
import { get, post, qs } from "~/api/client";
import type { Page, Run } from "~/api/types";
import { useSession } from "~/session";
import { ErrorPanel, errorMessage } from "~/shell/states";
import { toEnvironmentViews } from "~/views";
import { useWorkflowNames } from "./api";
import { RunActionDialog, type RunAction, type RunActionRequest } from "./RunActionDialog";
import { SavedViewsMenu } from "./SavedViewsMenu";
import { isActiveRun, toRunRow } from "./views";

const PAGE = 50;
/** The table's sorting (TanStack `SortingState`). */
type Sorting = { id: string; desc: boolean }[];

/**
 * API query for the filters the server can apply (they cover every run, not one page); the rest
 * narrow the loaded runs. `range` stays a value here, so a "last 24 hours" key does not change
 * every second: {@link rangeParams} turns it into `from`/`to` when a page is fetched.
 */
export function serverRunQuery(f: RunFilters, workflowId?: string) {
  const n = normalizeFilters(f);
  const one = <T,>(xs: readonly T[] | undefined) => (xs?.length === 1 ? xs[0] : undefined);
  return {
    workflowId: workflowId ?? one(n.workflow),
    environmentId: one(n.environment),
    status: n.status?.length ? n.status.join(",") : undefined,
    origin: one(n.origin),
    q: n.search,
    range: n.range,
  };
}

/** `from`/`to` for a created range: a preset runs up to now, so it leaves `to` open. */
export function rangeParams(range: DateRangeValue | undefined, now = new Date()) {
  if (!range) return {};
  const { from, to } = resolveDateRange(range, now);
  return range.preset === "custom"
    ? { from: from.toISOString(), to: to.toISOString() }
    : { from: from.toISOString() };
}

/**
 * How often the list refreshes: every 3 s while a listed run moves, every 15 s while runs only wait
 * (for a person or a timer, possibly for days), not at all once every listed run has ended.
 */
export function listRefreshMs(runs: readonly Pick<Run, "status">[]): number | false {
  const active = runs.filter((r) => isActiveRun(r.status));
  if (active.length === 0) return false;
  return active.some((r) => r.status !== "waiting" && r.status !== "waiting_for_human")
    ? 3000
    : 15_000;
}

/** The filters the server already applied are not applied again to the loaded runs. */
export function clientRunFilters(f: RunFilters, workflowId?: string): RunFilters {
  const { search: _search, range: _range, ...rest } = f;
  return workflowId ? { ...rest, workflow: [] } : rest;
}

export function RunsList({ workflowId }: { workflowId?: string }) {
  const s = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const qc = useQueryClient();
  const filters = useMemo(() => parseFilters(params.toString()), [params]);
  const server = serverRunQuery(filters, workflowId);

  const runs = useInfiniteQuery({
    queryKey: ["runs", s.ws, server],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const { range, ...query } = server;
      return get<Page<Run>>(
        `/v1/runs${qs({ ...query, ...rangeParams(range), include: "decisions,version", limit: PAGE, cursor: pageParam })}`,
        { signal },
      );
    },
    getNextPageParam: (last) => last.next_cursor,
    refetchInterval: (q) => listRefreshMs(q.state.data?.pages.flatMap((p) => p.items) ?? []),
  });
  const names = useWorkflowNames(s.ws);
  const items = useMemo(() => runs.data?.pages.flatMap((p) => p.items) ?? [], [runs.data]);
  const rows = useMemo(() => {
    const views = items.map((r) =>
      toRunRow(r, {
        workflowNames: names.data ?? new Map(),
        environments: s.environments,
      }),
    );
    return applyRunFilters(views, clientRunFilters(filters, workflowId));
  }, [items, names.data, s.environments, filters, workflowId]);
  const [sorting, setSorting] = useState<Sorting>([{ id: "createdAt", desc: true }]);
  const more = Boolean(runs.hasNextPage);
  const newestFirst = sorting.length === 0 || (sorting[0]?.id === "createdAt" && sorting[0].desc);

  const setFilters = (f: RunFilters) => {
    const q = serializeFilters(f);
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  };

  // a row's Replay re-executes (and may pay for) every step and Cancel can't be undone: both ask
  const [pending, setPending] = useState<{ runId: string; action: RunAction } | null>(null);
  const submitAction = async ({ path, body }: RunActionRequest) => {
    try {
      const r = await post<{ run_id: string }>(path, body ?? {});
      if (path.endsWith("/cancel")) {
        toast.success("Cancel requested");
        void qc.invalidateQueries({ queryKey: ["runs", s.ws] });
      } else router.push(`/${s.ws}/runs/${r.run_id}`);
    } catch (e) {
      toast.error(errorMessage(e));
      throw e;
    }
  };

  const facets: RunFilterFacet[] = workflowId
    ? ["status", "environment", "origin", "range"]
    : ["status", "workflow", "environment", "origin", "range"];
  const workflowOptions = [...(names.data ?? new Map<string, string>())]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));

  if (runs.isError) return <ErrorPanel error={runs.error} onRetry={() => void runs.refetch()} />;

  const filtered = serializeFilters(filters) !== "";
  return (
    <div className="flex flex-col gap-3">
      <RunsTable
        runs={rows}
        partial={more}
        loading={runs.isPending}
        defaultSorting={sorting}
        onSortingChange={setSorting}
        {...(more && !newestFirst
          ? {
              footer: (
                <span className="truncate text-xs text-ink-3">
                  Sorted within the loaded runs; load older runs to include them.
                </span>
              ),
            }
          : {})}
        onOpen={(r) => router.push(`/${s.ws}/runs/${r.id}`)}
        rowHref={(r) => `/${s.ws}/runs/${r.id}`}
        {...(workflowId ? { defaultColumnVisibility: { workflowName: false } } : {})}
        {...(s.can("runs:cancel")
          ? { onCancel: (r) => setPending({ runId: r.id, action: { kind: "cancel" } }) }
          : {})}
        {...(s.can("runs:replay")
          ? { onReplay: (r) => setPending({ runId: r.id, action: { kind: "replay" } }) }
          : {})}
        toolbar={
          <FilterBar
            value={filters}
            onChange={setFilters}
            environments={toEnvironmentViews(s.environments)}
            facets={facets}
            options={{ workflow: workflowOptions }}
            searchPlaceholder="Search runs"
          />
        }
        toolbarEnd={
          <SavedViewsMenu
            ws={s.ws}
            query={serializeFilters(filters)}
            onApply={(q) => router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false })}
          />
        }
        emptyState={
          <EmptyState
            size="sm"
            icon={<Play strokeWidth={1.5} />}
            title={
              filtered
                ? more
                  ? "No loaded runs match these filters"
                  : "No runs match these filters"
                : "No runs yet"
            }
            description={
              filtered
                ? more
                  ? "Older runs are not loaded yet: load them below, or clear a filter."
                  : "Clear a filter or widen the time range."
                : "Runs appear here when a workflow runs from the builder, the API, a webhook or a schedule."
            }
            {...(filtered
              ? {
                  primaryAction: (
                    <Button variant="secondary" onClick={() => setFilters({})}>
                      Clear filters
                    </Button>
                  ),
                }
              : {})}
          />
        }
        aria-label="Runs"
      />
      {pending ? (
        <RunActionDialog
          runId={pending.runId}
          action={pending.action}
          onOpenChange={(open) => {
            if (!open) setPending(null);
          }}
          onSubmit={submitAction}
        />
      ) : null}
      {runs.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            variant="secondary"
            loading={runs.isFetchingNextPage}
            onClick={() => void runs.fetchNextPage()}
          >
            Load older runs
          </Button>
        </div>
      ) : null}
    </div>
  );
}
