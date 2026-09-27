"use client";
/**
 * The frame of a workflow's secondary pages (versions, deployments, settings): the workspace
 * shell, breadcrumbs and a tab strip back to the builder. Loads the workflow once and hands it
 * to the page.
 */
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { PageHeader } from "@flowaid/ui/shell";
import { get } from "~/api/client";
import type { WorkflowDetail } from "~/api/types";
import { useSession } from "~/session";
import { AppFrame, PageBody } from "~/shell/AppFrame";
import { QueryView } from "./ui";

export const WORKFLOW_TABS = [
  { id: "builder", label: "Builder", path: "" },
  { id: "runs", label: "Runs", path: "/runs" },
  { id: "versions", label: "Versions", path: "/versions" },
  { id: "deployments", label: "Deployments", path: "/deployments" },
  { id: "settings", label: "Settings", path: "/settings" },
] as const;
export type WorkflowTab = (typeof WORKFLOW_TABS)[number]["id"];

export function useWorkflow(id: string) {
  const s = useSession();
  return useQuery({
    queryKey: ["workflow", s.ws, id],
    queryFn: () => get<WorkflowDetail>(`/v1/workflows/${id}`),
  });
}

export function WorkflowFrame({
  id,
  tab,
  actions,
  children,
}: {
  id: string;
  tab: WorkflowTab;
  actions?: ReactNode;
  children: (workflow: WorkflowDetail) => ReactNode;
}) {
  const s = useSession();
  const router = useRouter();
  const wf = useWorkflow(id);
  const base = `/${s.ws}/workflows/${id}`;
  const label = WORKFLOW_TABS.find((t) => t.id === tab)?.label ?? "";
  return (
    <AppFrame
      crumbs={[
        { label: s.workspaceName },
        { label: "Workflows", href: `/${s.ws}/workflows` },
        { label: wf.data?.name ?? "…", href: base },
        { label },
      ]}
    >
      <PageBody>
        <PageHeader
          title={wf.data?.name ?? "Workflow"}
          description={wf.data?.description || undefined}
          actions={actions}
          tabs={WORKFLOW_TABS.map((t) => ({ id: t.id, label: t.label }))}
          tab={tab}
          onTabChange={(next) => {
            const t = WORKFLOW_TABS.find((x) => x.id === next);
            if (t) router.push(`${base}${t.path}`);
          }}
        />
        <div className="mt-5">
          <QueryView query={wf}>{(w) => children(w)}</QueryView>
        </div>
      </PageBody>
    </AppFrame>
  );
}
