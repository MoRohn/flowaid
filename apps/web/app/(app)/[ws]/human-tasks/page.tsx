"use client";
/** Human task inbox: Open · Mine · Resolved (UI.md §1). Open tasks refresh every 10 s. */
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo } from "react";
import { CheckSquare } from "lucide-react";
import type { HumanTask, Page } from "~/api/types";
import { Button, EmptyState, toast } from "@flowaid/ui/primitives";
import { ApprovalsTable } from "@flowaid/ui/data";
import { PageHeader } from "@flowaid/ui/shell";
import { get, post, qs } from "~/api/client";
import { useSession } from "~/session";
import { AppFrame, PageBody } from "~/shell/AppFrame";
import { ErrorPanel, errorMessage } from "~/shell/states";
import { useMembers, useWorkflowNames } from "~/runs/api";
import { ResolvedTasksTable } from "~/runs/ResolvedTasksTable";
import { taskToPending } from "~/runs/humanTasks";

const TABS = [
  { id: "open", label: "Open" },
  { id: "mine", label: "Mine" },
  { id: "resolved", label: "Resolved" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function Inbox() {
  const s = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const qc = useQueryClient();
  const tab: TabId = TABS.find((t) => t.id === params.get("tab"))?.id ?? "open";
  const query =
    tab === "resolved"
      ? { status: "responded" }
      : tab === "mine"
        ? { status: "open", assignedToMe: true }
        : { status: "open" };

  const tasks = useInfiniteQuery({
    queryKey: ["human-tasks", s.ws, tab],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      get<Page<HumanTask>>(`/v1/human-tasks${qs({ ...query, limit: 50, cursor: pageParam })}`, {
        signal,
      }),
    getNextPageParam: (p) => p.next_cursor,
    refetchInterval: tab === "resolved" ? false : 10_000,
  });
  const names = useWorkflowNames(s.ws);
  const members = useMembers(s.ws, s.me.principal.workspaceId);
  const items = useMemo(() => tasks.data?.pages.flatMap((p) => p.items) ?? [], [tasks.data]);
  const pending = useMemo(
    () =>
      items.map((t) => taskToPending(t, names.data?.get(t.workflowId) ?? "Workflow", members.data)),
    [items, names.data, members.data],
  );

  const assignToMe = useMutation({
    mutationFn: (id: string) =>
      post(`/v1/human-tasks/${id}/reassign`, { assignees: [s.me.user?.id ?? s.me.principal.id] }),
    onSuccess: () => {
      toast.success("Assigned to you");
      void qc.invalidateQueries({ queryKey: ["human-tasks", s.ws] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const setTab = (id: string) =>
    router.replace(id === "open" ? pathname : `${pathname}?tab=${id}`, { scroll: false });
  const open = (id: string) => router.push(`/${s.ws}/human-tasks/${id}`);

  const empty = (
    <EmptyState
      size="sm"
      icon={<CheckSquare strokeWidth={1.5} />}
      title={
        tab === "resolved"
          ? "Nothing resolved yet"
          : tab === "mine"
            ? "Nothing assigned to you"
            : "Inbox zero"
      }
      description={
        tab === "resolved"
          ? "Answered approvals, reviews and forms appear here."
          : "When a workflow asks a person to approve, review or fill a form, the task waits here."
      }
    />
  );

  return (
    <>
      <PageHeader
        title="Human tasks"
        description="Approvals, reviews, choices and forms that workflows are waiting on."
        tabs={TABS.map((t) => ({ id: t.id, label: t.label }))}
        tab={tab}
        onTabChange={setTab}
      />
      <div className="mt-4 flex flex-col gap-3">
        {tasks.isError ? (
          <ErrorPanel error={tasks.error} onRetry={() => void tasks.refetch()} />
        ) : tab === "resolved" ? (
          <ResolvedTasksTable
            tasks={items}
            workflowNames={names.data ?? new Map()}
            members={members.data ?? []}
            loading={tasks.isPending}
            onOpen={open}
            emptyState={empty}
          />
        ) : (
          <ApprovalsTable
            approvals={pending}
            loading={tasks.isPending}
            onReview={(a) => open(a.id)}
            rowHref={(a) => `/${s.ws}/human-tasks/${a.id}`}
            {...(s.can("runs:approve") && s.me.user
              ? { onAssignToMe: (a) => assignToMe.mutate(a.id) }
              : {})}
            emptyState={empty}
            aria-label="Open human tasks"
          />
        )}
        {tasks.hasNextPage ? (
          <div className="flex justify-center">
            <Button
              variant="secondary"
              loading={tasks.isFetchingNextPage}
              onClick={() => void tasks.fetchNextPage()}
            >
              Load more
            </Button>
          </div>
        ) : null}
      </div>
    </>
  );
}

export default function HumanTasksPage() {
  const s = useSession();
  return (
    <AppFrame crumbs={[{ label: s.workspaceName }, { label: "Human tasks" }]}>
      <PageBody wide>
        <Suspense>
          <Inbox />
        </Suspense>
      </PageBody>
    </AppFrame>
  );
}
