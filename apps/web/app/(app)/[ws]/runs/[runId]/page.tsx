"use client";
import { use } from "react";
import { useSession } from "~/session";
import { AppFrame } from "~/shell/AppFrame";
import { TraceViewer } from "~/runs/TraceViewer";

export default function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = use(params);
  const s = useSession();
  return (
    <AppFrame
      crumbs={[
        { label: s.workspaceName },
        { label: "Runs", href: `/${s.ws}/runs` },
        { label: runId.slice(0, 8) },
      ]}
    >
      <TraceViewer runId={runId} />
    </AppFrame>
  );
}
