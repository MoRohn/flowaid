"use client";
import { useRouter } from "next/navigation";
import { Suspense, useEffect } from "react";
import { Dashboard } from "~/dashboard/Dashboard";
import { GettingStarted } from "~/onboarding/GettingStarted";
import { FullPageSpinner, useSession } from "~/session";
import { AppFrame, PageBody } from "~/shell/AppFrame";

/**
 * The workspace home: the getting-started checklist and the metrics overview when
 * `features.dashboard`, otherwise its workflows.
 */
export default function WorkspaceHome() {
  const s = useSession();
  const router = useRouter();
  const enabled = s.features.dashboard === true;
  useEffect(() => {
    if (!enabled) router.replace(`/${s.ws}/workflows`);
  }, [enabled, router, s.ws]);
  if (!enabled) return <FullPageSpinner />;
  return (
    <AppFrame crumbs={[{ label: s.workspaceName }, { label: "Overview" }]}>
      <PageBody wide>
        <Dashboard
          ws={s.ws}
          environments={s.environments}
          intro={
            <Suspense>
              <GettingStarted />
            </Suspense>
          }
        />
      </PageBody>
    </AppFrame>
  );
}
