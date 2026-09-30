"use client";
/**
 * Integrations: MCP servers, OpenAPI toolsets, model providers and node packages. Each tab opens
 * with its own "Start here" (which tab fits which need, what it needs, checked against what the
 * tab loaded).
 */
import { Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@flowaid/ui/shell";
import { get, getAll } from "~/api/client";
import { integrationPageChecks } from "~/admin/integrations/guide";
import { McpTab, useMcpServers } from "~/admin/integrations/McpTab";
import { OpenApiTab } from "~/admin/integrations/OpenApiTab";
import type { PluginRow } from "~/admin/integrations/plugins";
import { PluginsTab } from "~/admin/integrations/PluginsTab";
import { ProvidersTab } from "~/admin/integrations/ProvidersTab";
import type { Tool } from "~/admin/types";
import { useQueryTab } from "~/admin/ui";
import {
  INTEGRATIONS_MCP,
  INTEGRATIONS_OPENAPI,
  INTEGRATIONS_PLUGINS,
  INTEGRATIONS_PROVIDERS,
} from "~/guide/capabilities/integrations";
import { PageIntro } from "~/guide/PageIntro";
import type { Check } from "~/guide/Readiness";
import { generationCheck, typesafeCheck, useConnections } from "~/guide/useConnections";
import { useSession } from "~/session";
import { AppFrame, PageBody } from "~/shell/AppFrame";
import { ErrorPanel } from "~/shell/states";

const TABS = [
  { id: "mcp", label: "MCP servers", feature: "integrations_mcp" },
  { id: "openapi", label: "OpenAPI tools", feature: "integrations_openapi" },
  { id: "providers", label: "Providers & models", feature: "integrations_providers" },
  { id: "plugins", label: "Plugins", feature: "integrations_plugins" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const GUIDE = {
  mcp: INTEGRATIONS_MCP,
  openapi: INTEGRATIONS_OPENAPI,
  providers: INTEGRATIONS_PROVIDERS,
  plugins: INTEGRATIONS_PLUGINS,
};

function Integrations() {
  const s = useSession();
  const tabs = TABS.filter((t) => s.features[t.feature]);
  const [tab, setTab] = useQueryTab<TabId>(tabs.map((t) => t.id));
  // the queries the tabs run themselves, so the checks cost no extra request
  const servers = useMcpServers();
  const toolsets = useQuery({
    queryKey: ["tools", s.ws],
    queryFn: () => getAll<Tool>("/v1/tools"),
    enabled: tab === "openapi",
  });
  const plugins = useQuery({
    queryKey: ["plugins", s.ws],
    queryFn: () => get<PluginRow[]>("/v1/plugins"),
    enabled: tab === "plugins",
  });
  const connections = useConnections();
  const checks: Check[] =
    tab === "providers"
      ? [
          generationCheck(connections, s.ws, { need: "Generate steps and agents" }),
          typesafeCheck(connections, s.ws),
        ]
      : integrationPageChecks(tab, {
          ...(servers.data ? { servers: servers.data } : {}),
          ...(toolsets.data ? { toolsets: toolsets.data } : {}),
          ...(plugins.data ? { plugins: plugins.data } : {}),
          can: (scope) => s.can(scope),
        });
  const filled =
    tab === "mcp"
      ? (servers.data?.length ?? 0) > 0
      : tab === "openapi"
        ? (toolsets.data ?? []).some((t) => t.kind === "openapi")
        : tab === "plugins"
          ? (plugins.data?.length ?? 0) > 0
          : connections.generation.length > 0;
  return (
    <PageBody>
      <PageHeader
        title="Integrations"
        description="Tool servers, imported APIs, model providers and node packages available to workflows."
        tabs={tabs.map((t) => ({ id: t.id, label: t.label }))}
        tab={tab}
        onTabChange={(t) => setTab(t as TabId)}
      />
      {tabs.length ? (
        <PageIntro key={tab} guide={GUIDE[tab]} checks={checks} defaultCollapsed={filled} />
      ) : null}
      <div className="mt-5">
        {tabs.length === 0 ? (
          <ErrorPanel error={new Error("No integrations are enabled on this server.")} />
        ) : tab === "mcp" ? (
          <McpTab />
        ) : tab === "openapi" ? (
          <OpenApiTab />
        ) : tab === "plugins" ? (
          <PluginsTab />
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
