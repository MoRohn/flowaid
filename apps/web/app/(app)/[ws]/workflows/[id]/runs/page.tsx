"use client";
import { Suspense, use } from "react";
import { WorkflowFrame } from "~/admin/WorkflowFrame";
import { WORKFLOW_RUNS } from "~/guide/capabilities/workflow";
import { PageIntro } from "~/guide/PageIntro";
import { RunsList } from "~/runs/RunsList";

export default function WorkflowRunsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <WorkflowFrame id={id} tab="runs">
      {() => (
        <>
          <PageIntro guide={WORKFLOW_RUNS} defaultCollapsed className="mb-4" />
          <Suspense>
            <RunsList workflowId={id} />
          </Suspense>
        </>
      )}
    </WorkflowFrame>
  );
}
