"use client";
import { useQuery } from "@tanstack/react-query";
import { use } from "react";
import type { NodeManifest, ToolDefinition } from "@flowaid/workflow-core";
import { get } from "~/api/client";
import type { WorkflowDetail } from "~/api/types";
import { Builder } from "~/builder/Builder";
import { draftSaved } from "~/builder/useDraftSave";
import { FullPageSpinner } from "~/session";
import { AppFrame, PageBody } from "~/shell/AppFrame";
import { ErrorPanel } from "~/shell/states";

export default function BuilderPage({ params }: { params: Promise<{ ws: string; id: string }> }) {
  const { ws, id } = use(params);
  const workflow = useQuery({
    queryKey: ["workflow", id],
    // an edit sent as the builder closed lands before the draft is read again
    queryFn: () => draftSaved(id).then(() => get<WorkflowDetail>(`/v1/workflows/${id}`)),
    staleTime: Infinity,
    refetchOnMount: "always",
  });
  const nodes = useQuery({
    queryKey: ["catalog", "nodes"],
    queryFn: () => get<NodeManifest[]>("/v1/nodes"),
    staleTime: 10 * 60_000,
  });
  const tools = useQuery({
    queryKey: ["catalog", "tools"],
    queryFn: () => get<ToolDefinition[]>("/v1/tools/catalog"),
    staleTime: 60_000,
  });

  const failed = workflow.error ?? nodes.error ?? tools.error;
  if (failed)
    return (
      <AppFrame crumbs={[{ label: "Workflow" }]}>
        <PageBody>
          <ErrorPanel
            error={failed}
            onRetry={() => void Promise.all([workflow.refetch(), nodes.refetch(), tools.refetch()])}
            back={{ href: `/${ws}/workflows`, label: "All workflows" }}
          />
        </PageBody>
      </AppFrame>
    );
  if (!workflow.data || !nodes.data || !tools.data) return <FullPageSpinner />;
  // keyed by id + revision so a restored draft (versions page) remounts with fresh state
  return (
    <Builder
      key={`${workflow.data.id}:${workflow.data.draftRevision}`}
      workflow={workflow.data}
      manifests={nodes.data}
      tools={tools.data}
    />
  );
}
