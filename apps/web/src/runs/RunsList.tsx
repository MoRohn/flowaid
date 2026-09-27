"use client";
/**
 * The runs list (all runs, or one workflow's): FilterBar state in the URL, server-side filters
 * where the API has them (single status list, origin, environment, workflow), the rest applied
 * client-side, cursor pagination, and a 3 s refresh while any listed run is still active.
 */
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { Play } from "lucide-react";
import { Button, EmptyState, toast } from "@flowaid/ui/primitives";
import {
  FilterBar,
  RunsTable,
  applyRunFilters,
  normalizeFilters,
  parseFilters,
  serializeFilters,
  type RunFilterFacet,
  type RunFilters,
} from "@flowaid/ui/data";
import { get, post, qs } from "~/api/client";
import type { Page, Run } from "~/api/types";
import { useSession } from "~/session";
import { ErrorPanel, errorMessage } from "~/shell/states";
import { toEnvironmentViews } from "~/views";
import { useVersionNumbers, useWorkflowNames } from "./api";
import { isActiveRun, toRunRow } from "./views";

const PAGE = 50;

/** API query for the filters the server can apply; the rest run client-side. */
export function serverRunQuery(f: RunFilters, workflowId?: string) {
  const n = normalizeFilters(f);
  const one = <T,>(xs: readonly T[] | undefined) => (xs?.length === 1 ? xs[0] : undefined);
  return {
    workflowId: workflowId ?? one(n.workflow),
    environmentId: one(n.environment),
    status: n.status?.length ? n.status.join(",") : undefined,
    origin: one(n.origin),
  };
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
    queryFn: ({ pageParam, signal }) =>
      get<Page<Run>>(`/v1/runs${qs({ ...server, limit: PAGE, cursor: pageParam })}`, { signal }),
    getNextPageParam: (last) => last.next_cursor,
    refetchInterval: (q) =>
      q.state.data?.pages.some((p) => p.items.some((r) => isActiveRun(r.status))) ? 3000 : false,
  });
  const names = useWorkflowNames(s.ws);
  const items = useMemo(() => runs.data?.pages.flatMap((p) => p.items) ?? [], [runs.data]);
  const versions = useVersionNumbers(
    s.ws,
    items.map((r) => r.workflowId),
  );
  const rows = useMemo(() => {
    const views = items.map((r) =>
      toRunRow(r, {
        workflowNames: names.data ?? new Map(),
        versions,
        environments: s.environments,
      }),
    );
    return applyRunFilters(views, workflowId ? { ...filters, workflow: [] } : filters);
  }, [items, names.data, versions, s.environments, filters, workflowId]);

  const setFilters = (f: RunFilters) => {
    const q = serializeFilters(f);
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  };

  const cancel = useMutation({
    mutationFn: (id: string) => post(`/v1/runs/${id}/cancel`, {}),
    onSuccess: () => {
      toast.success("Cancel requested");
      void qc.invalidateQueries({ queryKey: ["runs", s.ws] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const replay = useMutation({
    mutationFn: (id: string) => post<{ run_id: string }>(`/v1/runs/${id}/replay`, {}),
    onSuccess: (r) => router.push(`/${s.ws}/runs/${r.run_id}`),
    onError: (e) => toast.error(errorMessage(e)),
  });

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
        loading={runs.isPending}
        onOpen={(r) => router.push(`/${s.ws}/runs/${r.id}`)}
        {...(s.can("runs:cancel") ? { onCancel: (r) => cancel.mutate(r.id) } : {})}
        {...(s.can("runs:replay") ? { onReplay: (r) => replay.mutate(r.id) } : {})}
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
        emptyState={
          <EmptyState
            size="sm"
            icon={<Play strokeWidth={1.5} />}
            title={filtered ? "No runs match these filters" : "No runs yet"}
            description={
              filtered
                ? "Clear a filter or widen the time range."
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
