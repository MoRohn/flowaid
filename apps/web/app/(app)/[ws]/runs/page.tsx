"use client";
import { Suspense } from "react";
import { PageHeader } from "@flowaid/ui/shell";
import { useSession } from "~/session";
import { AppFrame, PageBody } from "~/shell/AppFrame";
import { RunsList } from "~/runs/RunsList";

export default function RunsPage() {
  const s = useSession();
  return (
    <AppFrame crumbs={[{ label: s.workspaceName }, { label: "Runs" }]}>
      <PageBody wide>
        <PageHeader
          title="Runs"
          description="Every run in this workspace, newest first. Active runs refresh live."
        />
        <div className="mt-4">
          <Suspense>
            <RunsList />
          </Suspense>
        </div>
      </PageBody>
    </AppFrame>
  );
}
