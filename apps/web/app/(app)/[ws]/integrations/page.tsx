"use client";
import { Suspense } from "react";
import { PageHeader } from "@flowaid/ui/shell";
import { McpTab } from "~/admin/integrations/McpTab";
import { OpenApiTab } from "~/admin/integrations/OpenApiTab";
import { ProvidersTab } from "~/admin/integrations/ProvidersTab";
import { useQueryTab } from "~/admin/ui";
import { useSession } from "~/session";
import { AppFrame, PageBody } from "~/shell/AppFrame";
import { ErrorPanel } from "~/shell/states";

const TABS = [
  { id: "mcp", label: "MCP servers", feature: "integrations_mcp" },
  { id: "openapi", label: "OpenAPI tools", feature: "integrations_openapi" },
  { id: "providers", label: "Providers & models", feature: "integrations_providers" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function Integrations() {
  const s = useSession();
  const tabs = TABS.filter((t) => s.features[t.feature]);
  const [tab, setTab] = useQueryTab<TabId>(tabs.map((t) => t.id));
  return (
    <PageBody>
      <PageHeader
        title="Integrations"
        description="Tool servers, imported APIs and model providers available to workflows."
        tabs={tabs.map((t) => ({ id: t.id, label: t.label }))}
        tab={tab}
        onTabChange={(t) => setTab(t as TabId)}
      />
      <div className="mt-5">
        {tabs.length === 0 ? (
          <ErrorPanel error={new Error("No integrations are enabled on this server.")} />
        ) : tab === "mcp" ? (
          <McpTab />
        ) : tab === "openapi" ? (
          <OpenApiTab />
        ) : (
          <ProvidersTab />
        )}
      </div>
    </PageBody>
  );
}

export default function IntegrationsPage() {
  const s = useSession();
  return (
    <AppFrame crumbs={[{ label: s.workspaceName }, { label: "Integrations" }]}>
      <Suspense>
        <Integrations />
      </Suspense>
    </AppFrame>
  );
}
