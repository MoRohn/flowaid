"use client";
/** Agents (P6-10): presets the Agent node references, listed with their model, tools and bounds. */
import { useQuery } from "@tanstack/react-query";
import type { ToolDefinition } from "@flowaid/workflow-core";
import { useState } from "react";
import { Bot, Plus } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  EmptyState,
} from "@flowaid/ui/primitives";
import { PageHeader } from "@flowaid/ui/shell";
import { del, get, getAll } from "~/api/client";
import { QueryView, useConfirm, useMutate } from "~/admin/ui";
import { AgentActiveSwitch } from "~/agents/AgentActiveSwitch";
import { AgentDialog } from "~/agents/AgentDialog";
import {
  APPROVAL_LABEL,
  boundsOf,
  modelLabel,
  type AgentPreset,
  type ApprovalMode,
} from "~/agents/logic";
import { AGENTS } from "~/guide/capabilities/agents";
import { PageIntro } from "~/guide/PageIntro";
import type { Check } from "~/guide/Readiness";
import { generationCheck, useConnections } from "~/guide/useConnections";
import { useSession } from "~/session";
import { AppFrame, PageBody } from "~/shell/AppFrame";

export default function AgentsPage() {
  const s = useSession();
  const canWrite = s.can("tools:write");
  const [editing, setEditing] = useState<AgentPreset | null | undefined>(undefined);
  const confirm = useConfirm<AgentPreset>();
  const list = useQuery({
    queryKey: ["agents", s.ws],
    queryFn: () => getAll<AgentPreset>("/v1/agents"),
  });
  const remove = useMutate((id: string) => del(`/v1/agents/${id}`), {
    success: "Agent deleted",
    invalidate: [["agents", s.ws]],
    errorTitle: "Could not delete the agent",
  });
  const connections = useConnections();
  const tools = useQuery({
    queryKey: ["catalog", "tools", s.ws],
    queryFn: () => get<ToolDefinition[]>("/v1/tools/catalog"),
  });
  const checks: Check[] = [
    generationCheck(connections, s.ws, { required: true, need: "Agents" }),
    tools.isPending
      ? { id: "tools", label: "Tools", state: "checking" }
      : tools.data?.length
        ? { id: "tools", label: `${tools.data.length} tools available to agents`, state: "ok" }
        : {
            id: "tools",
            label: "Tools to call",
            state: "optional",
            detail: "Without tools an agent can only write answers.",
            fix: (
              <a className="text-accent-text hover:underline" href={`/${s.ws}/integrations`}>
                Connect tools under Integrations
              </a>
            ),
          },
    ...(canWrite
      ? []
      : [
          {
            id: "role",
            label: "Your role can view agents but not create or change them",
            state: "info",
          } satisfies Check,
        ]),
  ];
  const newButton = canWrite ? (
    <Button
      variant="primary"
      leadingIcon={<Plus strokeWidth={1.75} />}
      onClick={() => setEditing(null)}
    >
      New agent
    </Button>
  ) : null;

  return (
    <AppFrame crumbs={[{ label: s.workspaceName }, { label: "Agents" }]}>
      <PageBody>
        <PageHeader
          title="Agents"
          description="Tool-using agents: a model, instructions, the tools it may call and when a person approves a call. Active agents appear as their own steps in every workflow's Add node."
          actions={newButton}
        />
        <PageIntro guide={AGENTS} checks={checks} defaultCollapsed={(list.data?.length ?? 0) > 0} />
        <div className="mt-4">
          <QueryView query={list}>
            {(agents) =>
              agents.length === 0 ? (
                <EmptyState
                  icon={<Bot strokeWidth={1.5} />}
                  title="No agents yet"
                  description="Create a preset once and reuse it in any workflow's Agent step. The New agent steps suggest a starting point for each setting, including example instructions to edit."
                  primaryAction={newButton}
                />
              ) : (
                <ul className="grid gap-3 md:grid-cols-2" role="list">
                  {agents.map((a) => {
                    const tools = (a.config.tools ?? []) as {
                      name: string;
                      approval: ApprovalMode;
                    }[];
                    return (
                      <li key={a.id}>
                        <Card className={a.active === false ? "opacity-80" : undefined}>
                          <CardHeader>
                            <div className="flex items-start justify-between gap-3">
                              <CardTitle>{a.name}</CardTitle>
                              <AgentActiveSwitch agent={a} disabled={!canWrite} />
                            </div>
                            {a.description ? (
                              <CardDescription>{a.description}</CardDescription>
                            ) : null}
                          </CardHeader>
                          <CardBody className="flex flex-col gap-3">
                            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                              <dt className="text-ink-3">Model</dt>
                              <dd className="font-mono text-ink">{modelLabel(a.config.model)}</dd>
                              <dt className="text-ink-3">Bounds</dt>
                              <dd className="font-mono text-ink">
                                {`${boundsOf(a.config).maxSteps} steps · ${boundsOf(a.config).maxToolCalls} tool calls · $${boundsOf(a.config).maxCostUsd}`}
                              </dd>
                            </dl>
                            <div className="flex flex-wrap gap-1.5">
                              {tools.length === 0 ? (
                                <span className="text-xs text-ink-3">No tools</span>
                              ) : (
                                tools.map((t) => (
                                  <Badge
                                    key={t.name}
                                    tone={t.approval === "never" ? "neutral" : "warn"}
                                  >
                                    <span className="font-mono">{t.name}</span>
                                    <span className="sr-only"> ({APPROVAL_LABEL[t.approval]})</span>
                                    {t.approval !== "never" ? (
                                      <span aria-hidden className="text-ink-3">
                                        {" "}
                                        · approval
                                      </span>
                                    ) : null}
                                  </Badge>
                                ))
                              )}
                            </div>
                            {canWrite ? (
                              <div className="flex gap-2">
                                <Button size="sm" variant="secondary" onClick={() => setEditing(a)}>
                                  Edit
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => confirm.ask(a)}>
                                  Delete
                                </Button>
                              </div>
                            ) : null}
                          </CardBody>
                        </Card>
                      </li>
                    );
                  })}
                </ul>
              )
            }
          </QueryView>
        </div>
      </PageBody>
      {editing !== undefined ? (
        <AgentDialog
          key={editing?.id ?? "new"}
          open
          editing={editing}
          onOpenChange={(o) => {
            if (!o) setEditing(undefined);
          }}
        />
      ) : null}
      <ConfirmDialog
        open={confirm.target !== null}
        onOpenChange={(o) => {
          if (!o) confirm.close();
        }}
        title={`Delete ${confirm.target?.name ?? "the agent"}?`}
        description="Agent nodes that reference it will fail until they point at another preset."
        confirmLabel="Delete agent"
        variant="danger"
        onConfirm={async () => {
          if (confirm.target) await remove.mutateAsync(confirm.target.id);
          confirm.close();
        }}
      />
    </AppFrame>
  );
}
