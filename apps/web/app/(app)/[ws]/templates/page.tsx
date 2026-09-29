"use client";
import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { LayoutTemplate } from "lucide-react";
import type { NodeCategory } from "@flowaid/ui";
import {
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  FieldRow,
  Input,
  Select,
  SelectItem,
} from "@flowaid/ui/primitives";
import { TemplateGallery, type WorkflowTemplateView } from "@flowaid/ui/builder";
import { PageHeader } from "@flowaid/ui/shell";
import type { NodeManifest } from "@flowaid/workflow-core";
import { get, post } from "~/api/client";
import type { WorkflowDetail } from "~/api/types";
import { templateResourceSlots, templateToView } from "~/admin/logic";
import type { McpServer, TemplateRow } from "~/admin/types";
import { Notice, QueryView, useMutate } from "~/admin/ui";
import { useSession } from "~/session";
import { businessArea, splitBusinessFlows } from "~/templates/business";
import { templateNeeds, type TemplateNeed, type WorkspaceResources } from "~/templates/readiness";
import { AppFrame, PageBody } from "~/shell/AppFrame";
import { HELP } from "~/shell/help";
import { LearnMore } from "~/shell/LearnMore";

function UseTemplateDialog({
  template,
  needs,
  onClose,
}: {
  template: TemplateRow | null;
  needs: TemplateNeed[];
  onClose: () => void;
}) {
  const s = useSession();
  const router = useRouter();
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Record<string, string>>({});
  const slots = template ? templateResourceSlots(template) : [];
  const needsMcp = slots.some((x) => x.kind === "mcpServers");
  const servers = useQuery({
    queryKey: ["mcp-servers", s.ws],
    queryFn: () => get<McpServer[]>("/v1/mcp/servers"),
    enabled: template !== null && needsMcp && s.can("mcp:read"),
  });
  const create = useMutate(
    () =>
      post<WorkflowDetail>("/v1/workflows", {
        name: (name || template?.name || "").trim(),
        templateId: template?.id,
        ...(Object.keys(picked).length ? { resources: picked } : {}),
      }),
    {
      success: (w) => `Created ${w.name}`,
      invalidate: [["workflows", s.ws]],
      onSuccess: (w) => router.push(`/${s.ws}/workflows/${w.id}`),
    },
  );
  return (
    <Dialog
      open={template !== null}
      onOpenChange={(o) => {
        if (!o) {
          setName("");
          setPicked({});
          onClose();
        }
      }}
    >
      <DialogContent size="md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate(undefined);
          }}
        >
          <DialogHeader>
            <DialogTitle>Use “{template?.name}”</DialogTitle>
            <DialogDescription>{template?.description}</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <FieldRow label="Workflow name" htmlFor="tpl-name" required>
              <Input
                id="tpl-name"
                value={name}
                placeholder={template?.name}
                maxLength={200}
                onChange={(e) => setName(e.target.value)}
              />
            </FieldRow>
            {slots.map((slot) =>
              slot.kind === "mcpServers" ? (
                <FieldRow
                  key={slot.key}
                  label={`MCP server: ${slot.key}`}
                  htmlFor={`tpl-res-${slot.key}`}
                  hint={
                    <>
                      {slot.description}
                      {slot.requiredTools.length ? (
                        <span className="mt-1 flex flex-wrap gap-1">
                          {slot.requiredTools.map((t) => (
                            <Badge key={t} tone="outline" mono size="sm">
                              {t}
                            </Badge>
                          ))}
                        </span>
                      ) : null}
                    </>
                  }
                >
                  <Select
                    id={`tpl-res-${slot.key}`}
                    value={picked[slot.key] ?? ""}
                    placeholder={
                      (servers.data ?? []).length ? "Choose a server" : "No MCP servers connected"
                    }
                    onValueChange={(v) => setPicked((p) => ({ ...p, [slot.key]: v }))}
                  >
                    {(servers.data ?? []).map((m) => (
                      <SelectItem key={m.id} value={m.id} meta={`${m.toolCount} tools`}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </Select>
                </FieldRow>
              ) : (
                <Notice key={slot.key} tone="info">
                  Knowledge source “{slot.key}” is chosen in the builder once knowledge sources are
                  enabled.
                </Notice>
              ),
            )}
            {needsMcp && servers.data && servers.data.length === 0 ? (
              <Notice>
                Connect an MCP server under Integrations first, or create the workflow now and pick
                the server in the builder.
              </Notice>
            ) : null}
            {needs.length > 0 ? (
              <div>
                <p className="mb-1.5 text-xs font-medium text-ink">
                  {needs.every((n) => n.ready)
                    ? "Everything it needs is set up"
                    : "What it needs before its runs can succeed"}
                </p>
                <ul className="m-0 flex list-none flex-col gap-1 p-0 text-xs" role="list">
                  {needs.map((n) => (
                    <li key={n.label} className="flex gap-1.5">
                      <span
                        aria-hidden="true"
                        className={n.ready ? "text-ok-text" : "text-warn-text"}
                      >
                        {n.ready ? "✓" : "○"}
                      </span>
                      <span>
                        <span className="text-ink">{n.label}</span>
                        <span className="text-ink-3">
                          {" "}
                          · {n.ready ? "ready" : "to set up"}: {n.detail}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
                {needs.every((n) => n.ready) ? null : (
                  <p className="mt-1.5 text-2xs text-ink-3">
                    You can create the workflow now either way; the builder shows what is still
                    missing.
                  </p>
                )}
              </div>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={create.isPending}>
              Create workflow
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

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
    queryFn: () => get<{ type: string }[]>("/v1/credentials"),
    enabled: s.can("credentials:read"),
  });
  const mcp = useQuery({
    queryKey: ["mcp-servers", s.ws],
    queryFn: () => get<McpServer[]>("/v1/mcp/servers"),
    enabled: s.can("mcp:read"),
  });
  const knowledge = useQuery({
    queryKey: ["knowledge-sources", s.ws],
    queryFn: () => get<unknown[]>("/v1/knowledge/sources"),
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
      <UseTemplateDialog
        template={using ?? linked}
        needs={(using ?? linked) ? needsOf((using ?? linked) as TemplateRow) : []}
        onClose={closeDialog}
      />
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
