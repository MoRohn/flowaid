"use client";
import { useQuery } from "@tanstack/react-query";
import { Suspense, use } from "react";
import { PageHeader } from "@flowaid/ui/shell";
import { get } from "~/api/client";
import type { WorkflowSummary } from "~/api/types";
import { useSession } from "~/session";
import { AppFrame, PageBody } from "~/shell/AppFrame";
import { ErrorPanel } from "~/shell/states";
import { RunsList } from "~/runs/RunsList";

export default function WorkflowRunsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const s = useSession();
  const wf = useQuery({
    queryKey: ["workflow", s.ws, id],
    queryFn: () => get<WorkflowSummary>(`/v1/workflows/${id}`),
  });
  const name = wf.data?.name ?? "Workflow";
  return (
    <AppFrame
      crumbs={[
        { label: s.workspaceName },
        { label: "Workflows", href: `/${s.ws}/workflows` },
        { label: name, href: `/${s.ws}/workflows/${id}` },
        { label: "Runs" },
      ]}
    >
      <PageBody wide>
        <PageHeader
          title={`${name} · runs`}
          description="Runs of this workflow on every version and environment."
        />
        <div className="mt-4">
          {wf.isError ? (
            <ErrorPanel error={wf.error} onRetry={() => void wf.refetch()} />
          ) : (
            <Suspense>
              <RunsList workflowId={id} />
            </Suspense>
          )}
        </div>
      </PageBody>
    </AppFrame>
  );
}
