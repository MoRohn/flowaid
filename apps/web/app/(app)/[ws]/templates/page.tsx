"use client";
import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { LayoutTemplate } from "lucide-react";
import type { NodeCategory } from "@flowaid/ui";
import { EmptyState } from "@flowaid/ui/primitives";
import { TemplateGallery, type WorkflowTemplateView } from "@flowaid/ui/builder";
import { PageHeader } from "@flowaid/ui/shell";
import type { NodeManifest } from "@flowaid/workflow-core";
import { get, getAll } from "~/api/client";
import { templateToView } from "~/admin/logic";
import type { McpServer, TemplateRow } from "~/admin/types";
import { QueryView } from "~/admin/ui";
import { TEMPLATES } from "~/guide/capabilities/templates";
import { PageIntro } from "~/guide/PageIntro";
import type { Check } from "~/guide/Readiness";
import { generationCheck, typesafeCheck, useConnections } from "~/guide/useConnections";
import { useSession } from "~/session";
import { businessArea, splitBusinessFlows } from "~/templates/business";
import { templateNeeds, type WorkspaceResources } from "~/templates/readiness";
import { UseTemplateDialog } from "~/templates/UseTemplateDialog";
import { AppFrame, PageBody } from "~/shell/AppFrame";
import { HELP } from "~/shell/help";
import { LearnMore } from "~/shell/LearnMore";

export default function TemplatesPage() {
  return (
    <Suspense>
      <Templates />
    </Suspense>
  );
}

function Templates() {
  const s = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [using, setUsing] = useState<TemplateRow | null>(null);
  const templates = useQuery({
    queryKey: ["templates", s.ws, "graph"],
    queryFn: () => get<TemplateRow[]>("/v1/templates?include=graph"),
    staleTime: 5 * 60_000,
  });
  // `?use=<id>` (the command menu) opens that template's dialog once the list is in
  const useId = params.get("use");
  const canWrite = s.can("workflows:write");
  const linked =
    useId && canWrite
      ? (templates.data?.find((x) => x.id === useId || x.slug === useId) ?? null)
      : null;
  // someone who has built workflows knows what templates are: the intro starts folded
  const workflows = useQuery({
    queryKey: ["workflow-names", s.ws],
    queryFn: () => get<{ items: unknown[] }>("/v1/workflows?limit=200"),
  });
  const hasWorkflows = (workflows.data?.items.length ?? 0) > 0;
  const closeDialog = () => {
    setUsing(null);
    if (useId) router.replace(pathname, { scroll: false });
  };
  const nodes = useQuery({
    queryKey: ["node-catalog", s.ws],
    queryFn: () => get<NodeManifest[]>("/v1/nodes"),
    staleTime: 10 * 60_000,
  });
  const categoryOf = useMemo(() => {
    const m = new Map<string, NodeCategory>(
      (nodes.data ?? []).map((n) => [n.id, n.metadata.category]),
    );
    return (type: string) => m.get(type);
  }, [nodes.data]);
  const providers = useQuery({
    queryKey: ["providers", s.ws],
    queryFn: () => get<{ id: string; configuredOnServer: boolean }[]>("/v1/providers"),
    staleTime: 60_000,
  });
  const credentials = useQuery({
    queryKey: ["credentials", s.ws],
    queryFn: () => getAll<{ type: string }>("/v1/credentials"),
    enabled: s.can("credentials:read"),
  });
  const mcp = useQuery({
    queryKey: ["mcp-servers", s.ws],
    queryFn: () => getAll<McpServer>("/v1/mcp/servers"),
    enabled: s.can("mcp:read"),
  });
  const knowledge = useQuery({
    queryKey: ["knowledge-sources", s.ws],
    queryFn: () => getAll<unknown>("/v1/knowledge/sources"),
    enabled: s.features.knowledge === true,
  });
  // readiness only once the key state is known: "to set up" must not flash while loading
  const have: WorkspaceResources | null = providers.data
    ? {
        keys: {
          server: Object.fromEntries(providers.data.map((p) => [p.id, p.configuredOnServer])),
          saved: (credentials.data ?? []).map((c) => c.type),
        },
        mcpServers: mcp.data?.length ?? 0,
        knowledgeSources: knowledge.data?.length ?? 0,
      }
    : null;
  const needsOf = (t: TemplateRow) => (have ? templateNeeds(t, have) : []);
  const connections = useConnections();
  const checks: Check[] = [
    typesafeCheck(connections, s.ws, "Decision steps in most templates"),
    generationCheck(connections, s.ws, { need: "Templates that write text or use agents" }),
    mcp.isPending && s.can("mcp:read")
      ? { id: "mcp", label: "MCP servers", state: "checking" }
      : (mcp.data?.length ?? 0) > 0
        ? {
            id: "mcp",
            label: `${mcp.data?.length} MCP server${mcp.data?.length === 1 ? "" : "s"} connected`,
            state: "ok",
          }
        : {
            id: "mcp",
            label: "MCP servers",
            state: "optional",
            detail: "Only templates that call tools on a server need one.",
            fix: (
              <a className="text-accent-text hover:underline" href={`/${s.ws}/integrations`}>
                Connect one under Integrations
              </a>
            ),
          },
    ...(canWrite
      ? []
      : [
          {
            id: "role",
            label: "Your role can browse templates but not create workflows from them",
            state: "info",
          } satisfies Check,
        ]),
  ];
  const views = useMemo(
    () =>
      (templates.data ?? [])
        .map((t) => ({
          view: {
            ...templateToView(t, categoryOf),
            ...(have ? { needs: templateNeeds(t, have) } : {}),
            ...(businessArea(t) ? { useCase: businessArea(t) } : {}),
          },
        }))
        // what can run now comes first
        .map((x, i) => ({ ...x, i, ready: x.view.needs?.every((n) => n.ready) ?? false }))
        .sort((a, b) => Number(b.ready) - Number(a.ready) || a.i - b.i)
        .map((x) => x.view),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `have` is rebuilt from these
    [templates.data, categoryOf, providers.data, credentials.data, mcp.data, knowledge.data],
  );

  return (
    <AppFrame crumbs={[{ label: s.workspaceName }, { label: "Templates" }]}>
      <PageBody>
        <PageHeader
          title="Templates"
          description={
            <>
              Working starting points. Each card says what the template needs (keys, servers,
              documents) and whether this workspace has it; ready ones run as soon as you create
              them. <LearnMore href={HELP.gettingStarted} label="Getting started" />
            </>
          }
        />
        <PageIntro
          guide={TEMPLATES}
          checks={checks}
          defaultCollapsed={(templates.data?.length ?? 0) > 0 && hasWorkflows}
        />
        <div className="mt-4">
          <QueryView query={templates}>
            {(rows) =>
              rows.length === 0 ? (
                <EmptyState
                  icon={<LayoutTemplate strokeWidth={1.5} />}
                  title="No templates"
                  description="This server has no templates installed."
                />
              ) : (
                <TemplateSections
                  rows={rows}
                  views={views}
                  onUse={(v) => {
                    if (canWrite) setUsing(rows.find((t) => t.id === v.id) ?? null);
                  }}
                />
              )
            }
          </QueryView>
        </div>
      </PageBody>
      {(using ?? linked) ? (
        <UseTemplateDialog
          key={(using ?? linked)?.id}
          template={(using ?? linked) as TemplateRow}
          needs={needsOf((using ?? linked) as TemplateRow)}
          onClose={closeDialog}
        />
      ) : null}
    </AppFrame>
  );
}

/**
 * Business flows get their own short list at the top (complete workflows for everyday operations);
 * every other template follows in the searchable gallery.
 */
function TemplateSections({
  rows,
  views,
  onUse,
}: {
  rows: readonly TemplateRow[];
  views: WorkflowTemplateView[];
  onUse: (v: WorkflowTemplateView) => void;
}) {
  const { business } = splitBusinessFlows(rows);
  const ids = new Set(business.map((t) => t.id));
  const featured = views.filter((v) => ids.has(v.id));
  const rest = views.filter((v) => !ids.has(v.id));
  if (featured.length === 0) return <TemplateGallery templates={views} onUse={onUse} />;
  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="business-flows" className="flex flex-col gap-3">
        <div>
          <h2 id="business-flows" className="text-base font-semibold text-ink">
            Business flows
          </h2>
          <p className="max-w-[70ch] text-xs text-ink-2">
            Complete workflows for everyday operations, built end to end: input, decisions, rules,
            people when needed, and the outcome. Create one and it is yours: rename it, change its
            settings (limits, windows, scores) in the workflow panel, and edit any step or wording.
          </p>
        </div>
        <TemplateGallery templates={featured} onUse={onUse} toolbar={false} />
      </section>
      <section aria-labelledby="more-templates" className="flex flex-col gap-3">
        <h2 id="more-templates" className="text-base font-semibold text-ink">
          More templates
        </h2>
        <TemplateGallery templates={rest} onUse={onUse} />
      </section>
    </div>
  );
}
