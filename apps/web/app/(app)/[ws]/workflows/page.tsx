"use client";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useDeferredValue, useState } from "react";
import { Plus, Workflow } from "lucide-react";
import { Button, EmptyState, SearchInput, Skeleton } from "@flowaid/ui/primitives";
import { WorkflowsBrowser } from "@flowaid/ui/data";
import { PageHeader } from "@flowaid/ui/shell";
import { get, qs } from "~/api/client";
import type { Page, WorkflowWithActivity } from "~/api/types";
import { useSession } from "~/session";
import { AppFrame, PageBody } from "~/shell/AppFrame";
import { ErrorPanel } from "~/shell/states";
import { toEnvironmentViews, toWorkflowListItem } from "~/views";

export default function WorkflowsPage() {
  const s = useSession();
  const router = useRouter();
  const [q, setQ] = useState("");
  const query = useDeferredValue(q.trim());
  const list = useQuery({
    queryKey: ["workflows", s.ws, query],
    queryFn: () =>
      get<Page<WorkflowWithActivity>>(
        `/v1/workflows${qs({ include: "activity", limit: 200, q: query })}`,
      ),
    placeholderData: (prev) => prev,
  });
  const envs = toEnvironmentViews(s.environments);
  const canWrite = s.can("workflows:write");
  const newButton = canWrite ? (
    <Button
      leadingIcon={<Plus strokeWidth={1.75} />}
      onClick={() => router.push(`/${s.ws}/workflows/new`)}
    >
      New workflow
    </Button>
  ) : null;

  return (
    <AppFrame crumbs={[{ label: s.workspaceName }, { label: "Workflows" }]}>
      <PageBody>
        <PageHeader
          title="Workflows"
          description="Typed decision workflows in this workspace."
          actions={newButton}
        />
        <div className="mt-4">
          {list.isPending ? (
            <div className="flex flex-col gap-2" aria-busy="true">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : list.isError ? (
            <ErrorPanel error={list.error} onRetry={() => void list.refetch()} />
          ) : list.data.items.length === 0 && !query ? (
            <EmptyState
              icon={<Workflow strokeWidth={1.5} />}
              title="No workflows yet"
              description="A workflow is a typed graph of decisions, model calls, tools and human steps. Start from a tested template, import a definition, or build one on a blank canvas."
              primaryAction={newButton}
              secondaryAction={
                <Button variant="secondary" onClick={() => router.push(`/${s.ws}/templates`)}>
                  Browse templates
                </Button>
              }
            />
          ) : (
            <WorkflowsBrowser
              workflows={list.data.items.map((w) => toWorkflowListItem(w, s.environments))}
              environments={envs}
              onOpen={(w) => router.push(`/${s.ws}/workflows/${w.id}`)}
              tableProps={{ rowHref: (w) => `/${s.ws}/workflows/${w.id}` }}
              toolbar={
                <SearchInput
                  value={q}
                  onValueChange={setQ}
                  placeholder="Search workflows"
                  aria-label="Search workflows"
                  className="w-64"
                />
              }
            />
          )}
        </div>
      </PageBody>
    </AppFrame>
  );
}
