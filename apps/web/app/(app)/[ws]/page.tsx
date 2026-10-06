"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo } from "react";
import { Dashboard } from "~/dashboard/Dashboard";
import { parseDashboardFilters, serializeDashboardFilters } from "~/dashboard/logic";
import { GettingStarted } from "~/onboarding/GettingStarted";
import { FullPageSpinner, useSession } from "~/session";
import { AppFrame, PageBody } from "~/shell/AppFrame";

/**
 * The workspace home: the getting-started checklist and the metrics overview when
 * `features.dashboard`, otherwise its workflows. The Overview's range, workflow and environment
 * live in the URL (`?range=7d&workflow=…&env=…`), so they survive a reload.
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
        <Suspense>
          <Overview />
        </Suspense>
      </PageBody>
    </AppFrame>
  );
}

function Overview() {
  const s = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const filters = useMemo(() => parseDashboardFilters(params), [params]);
  return (
    <Dashboard
      ws={s.ws}
      environments={s.environments}
      filters={filters}
      onFiltersChange={(f) => {
        const q = serializeDashboardFilters(f, params);
        router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
      }}
      intro={
        <Suspense>
          <GettingStarted />
        </Suspense>
      }
    />
  );
}
