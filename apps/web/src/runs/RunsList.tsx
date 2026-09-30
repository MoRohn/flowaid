"use client";
/**
 * The runs list (all runs, or one workflow's): FilterBar state in the URL, server-side filters
 * where the API has them (single status list, origin, environment, workflow), the rest applied
 * client-side, cursor pagination, and a 3 s refresh while any listed run is still active.
 */
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
import { RunActionDialog, type RunActionRequest } from "./RunActionDialog";
import { SavedViewsMenu } from "./SavedViewsMenu";
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
      get<Page<Run>>(
        `/v1/runs${qs({ ...server, include: "decisions", limit: PAGE, cursor: pageParam })}`,
        { signal },
      ),
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
  // replay re-executes (and may pay for) every step, so a row's Replay asks first
  const [replaying, setReplaying] = useState<string | null>(null);
  const replay = async ({ path, body }: RunActionRequest) => {
    try {
      const r = await post<{ run_id: string }>(path, body ?? {});
      router.push(`/${s.ws}/runs/${r.run_id}`);
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
        loading={runs.isPending}
        onOpen={(r) => router.push(`/${s.ws}/runs/${r.id}`)}
        rowHref={(r) => `/${s.ws}/runs/${r.id}`}
        {...(workflowId ? { defaultColumnVisibility: { workflowName: false } } : {})}
        {...(s.can("runs:cancel") ? { onCancel: (r) => cancel.mutate(r.id) } : {})}
        {...(s.can("runs:replay") ? { onReplay: (r) => setReplaying(r.id) } : {})}
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
      {replaying ? (
        <RunActionDialog
          runId={replaying}
          action={{ kind: "replay" }}
          onOpenChange={(open) => {
            if (!open) setReplaying(null);
          }}
          onSubmit={replay}
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
