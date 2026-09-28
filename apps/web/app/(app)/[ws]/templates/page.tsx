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
import { TemplateGallery } from "@flowaid/ui/builder";
import { PageHeader } from "@flowaid/ui/shell";
import type { NodeManifest } from "@flowaid/workflow-core";
import { get, post } from "~/api/client";
import type { WorkflowDetail } from "~/api/types";
import { templateResourceSlots, templateToView } from "~/admin/logic";
import type { McpServer, TemplateRow } from "~/admin/types";
import { Notice, QueryView, useMutate } from "~/admin/ui";
import { useSession } from "~/session";
import { AppFrame, PageBody } from "~/shell/AppFrame";
import { HELP } from "~/shell/help";
import { LearnMore } from "~/shell/LearnMore";

function UseTemplateDialog({
  template,
  onClose,
}: {
  template: TemplateRow | null;
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
  const secrets = template?.requiredSecrets ?? [];
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
            {secrets.length > 0 ? (
              <div>
                <p className="mb-1.5 text-xs font-medium text-ink">
                  Secrets to bind before deploying
                </p>
                <ul className="flex flex-wrap gap-1.5" role="list">
                  {secrets.map((x) => (
                    <li key={x.name}>
                      <Badge tone={x.required === false ? "outline" : "neutral"} mono>
                        {x.name}
                        {x.credentialType ? (
                          <span className="ml-1 text-ink-3">{x.credentialType}</span>
                        ) : null}
                      </Badge>
                    </li>
                  ))}
                </ul>
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
  const views = useMemo(
    () => (templates.data ?? []).map((t) => templateToView(t, categoryOf)),
    [templates.data, categoryOf],
  );

  return (
    <AppFrame crumbs={[{ label: s.workspaceName }, { label: "Templates" }]}>
      <PageBody>
        <PageHeader
          title="Templates"
          description={
            <>
              Production-shaped starting points. Every template compiles and runs as shipped;
              credentials and servers it needs are listed before you create the workflow.{" "}
              <LearnMore href={HELP.gettingStarted} label="Getting started" />
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
                <TemplateGallery
                  templates={views}
                  onUse={(v) => {
                    if (canWrite) setUsing(rows.find((t) => t.id === v.id) ?? null);
                  }}
                />
              )
            }
          </QueryView>
        </div>
      </PageBody>
      <UseTemplateDialog template={using ?? linked} onClose={closeDialog} />
    </AppFrame>
  );
}
