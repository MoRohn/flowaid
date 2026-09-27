"use client";
import { Suspense, use } from "react";
import { WorkflowFrame } from "~/admin/WorkflowFrame";
import { RunsList } from "~/runs/RunsList";

export default function WorkflowRunsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <WorkflowFrame id={id} tab="runs">
      {() => (
        <Suspense>
          <RunsList workflowId={id} />
        </Suspense>
      )}
    </WorkflowFrame>
  );
}
