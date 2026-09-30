"use client";
/**
 * Triggers: every live webhook and schedule in the workspace (materialised per environment when a
 * version is deployed) and the workflows served as MCP tools with their tokens. Tabs follow the
 * feature keys `schedules` (webhooks and schedules) and `mcp_exposures`. Each tab opens with its
 * own "Start here", checked against what the tab already loaded.
 */
import { Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@flowaid/ui/shell";
import { getAll } from "~/api/client";
import { ExposuresSection, useWorkflowNames } from "~/admin/integrations/McpTab";
import { AddTriggerButton } from "~/admin/triggers/AddTriggerDialog";
import { triggerPageChecks } from "~/admin/triggers/guide";
import { ScheduleList, useSchedules } from "~/admin/triggers/Schedules";
import { WebhookList, useWebhooks } from "~/admin/triggers/Webhooks";
import type { McpExposure } from "~/admin/types";
import { Section, useQueryTab } from "~/admin/ui";
import { TRIGGERS_MCP, TRIGGERS_SCHEDULES, TRIGGERS_WEBHOOKS } from "~/guide/capabilities/triggers";
import { PageIntro } from "~/guide/PageIntro";
import type { Check } from "~/guide/Readiness";
import { useSession, type Session } from "~/session";
import { AppFrame, PageBody } from "~/shell/AppFrame";
import { HELP } from "~/shell/help";
import { LearnMore } from "~/shell/LearnMore";

const TABS = [
  { id: "webhooks", label: "Webhooks", visible: (s: Session) => s.features.schedules === true },
  { id: "schedules", label: "Schedules", visible: (s: Session) => s.features.schedules === true },
  { id: "mcp", label: "MCP tools", visible: (s: Session) => s.features.mcp_exposures === true },
] as const;
type TabId = (typeof TABS)[number]["id"];

const GUIDE = { webhooks: TRIGGERS_WEBHOOKS, schedules: TRIGGERS_SCHEDULES, mcp: TRIGGERS_MCP };

function Triggers() {
  const s = useSession();
  const params = useSearchParams();
  const tabs = TABS.filter((t) => t.visible(s));
  const [tab, setTab] = useQueryTab<TabId>(tabs.map((t) => t.id));
  const workflows = useWorkflowNames();
  const name = (id: string) => workflows.data?.find((w) => w.id === id)?.name ?? id.slice(0, 8);
  // the same queries the lists run, so the checks cost no extra request
  const webhooks = useWebhooks();
  const schedules = useSchedules();
  const exposures = useQuery({
    queryKey: ["mcp-exposures", s.ws],
    queryFn: () => getAll<McpExposure>("/v1/mcp/exposures"),
    enabled: tab === "mcp",
  });
  const rows =
    tab === "webhooks" ? webhooks.data : tab === "schedules" ? schedules.data : exposures.data;
  const checks = triggerPageChecks(tab, {
    ws: s.ws,
    ...(workflows.data ? { workflows: workflows.data } : {}),
    ...(webhooks.data ? { webhooks: webhooks.data } : {}),
    ...(schedules.data ? { schedules: schedules.data } : {}),
    ...(exposures.data ? { exposures: exposures.data } : {}),
    can: (scope) => s.can(scope),
  }).map(({ fix, ...c }): Check => ({
    ...c,
    ...(fix
      ? {
          fix: (
            <a className="text-accent-text hover:underline" href={fix.href}>
              {fix.label}
            </a>
          ),
        }
      : {}),
  }));
  return (
    <PageBody>
      <PageHeader
        title="Triggers"
        description={
          <>
            How workflows start without you: webhooks, schedules and MCP clients. Declared in each
            workflow, materialised per environment on deploy. <LearnMore href={HELP.triggers} />
          </>
        }
        tabs={tabs.map((t) => ({ id: t.id, label: t.label }))}
        tab={tab}
        onTabChange={(t) => setTab(t as TabId)}
      />
      {tabs.length ? (
        <PageIntro
          key={tab}
          guide={GUIDE[tab]}
          checks={checks}
          defaultCollapsed={(rows?.length ?? 0) > 0}
        />
      ) : null}
      <div className="mt-5">
        {tab === "webhooks" ? (
          <Section
            title="Webhooks"
            description="URLs other services call to start runs. The path and signature scheme belong to the workflow; enabling, secrets and replay protection are per environment."
            actions={<AddTriggerButton kind="webhook" />}
          >
            <WebhookList workflowName={name} highlight={params.get("webhook")} />
          </Section>
        ) : tab === "schedules" ? (
          <Section
            title="Schedules"
            description="Runs on a timetable. Pause them, choose how missed runs are handled, spread load with jitter, or run one now."
            actions={<AddTriggerButton kind="schedule" />}
          >
            <ScheduleList workflowName={name} />
          </Section>
        ) : (
          <ExposuresSection />
        )}
      </div>
    </PageBody>
  );
}

export default function TriggersPage() {
  const s = useSession();
  return (
    <AppFrame crumbs={[{ label: s.workspaceName }, { label: "Triggers" }]}>
      <Suspense>
        <Triggers />
      </Suspense>
    </AppFrame>
  );
}
