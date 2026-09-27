"use client";
/**
 * Triggers: every live webhook and schedule in the workspace (materialised per environment when a
 * version is deployed) and the workflows served as MCP tools with their tokens. Tabs follow the
 * feature keys `schedules` (webhooks and schedules) and `mcp_exposures`.
 */
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@flowaid/ui/shell";
import { ExposuresSection, useWorkflowNames } from "~/admin/integrations/McpTab";
import { ScheduleList } from "~/admin/triggers/Schedules";
import { WebhookList } from "~/admin/triggers/Webhooks";
import { Section, useQueryTab } from "~/admin/ui";
import { useSession, type Session } from "~/session";
import { AppFrame, PageBody } from "~/shell/AppFrame";

const TABS = [
  { id: "webhooks", label: "Webhooks", visible: (s: Session) => s.features.schedules === true },
  { id: "schedules", label: "Schedules", visible: (s: Session) => s.features.schedules === true },
  { id: "mcp", label: "MCP tools", visible: (s: Session) => s.features.mcp_exposures === true },
] as const;
type TabId = (typeof TABS)[number]["id"];

function Triggers() {
  const s = useSession();
  const params = useSearchParams();
  const tabs = TABS.filter((t) => t.visible(s));
  const [tab, setTab] = useQueryTab<TabId>(tabs.map((t) => t.id));
  const workflows = useWorkflowNames();
  const name = (id: string) => workflows.data?.find((w) => w.id === id)?.name ?? id.slice(0, 8);
  return (
    <PageBody>
      <PageHeader
        title="Triggers"
        description="How workflows start without you: webhooks, schedules and MCP clients. Declared in each workflow, materialised per environment on deploy."
        tabs={tabs.map((t) => ({ id: t.id, label: t.label }))}
        tab={tab}
        onTabChange={(t) => setTab(t as TabId)}
      />
      <div className="mt-5">
        {tab === "webhooks" ? (
          <Section
            title="Webhooks"
            description="Signed HTTP endpoints. The path and signature scheme come from the workflow; the rest is per environment."
          >
            <WebhookList workflowName={name} highlight={params.get("webhook")} />
          </Section>
        ) : tab === "schedules" ? (
          <Section
            title="Schedules"
            description="Cron triggers. Pause them, choose how missed runs are handled, spread load with jitter, or run one now."
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
