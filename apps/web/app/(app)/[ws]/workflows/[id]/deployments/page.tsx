"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, use, useMemo, useState } from "react";
import { ArrowUpRight, CalendarClock, Lock, Rocket, Undo2, Webhook } from "lucide-react";
import {
  Badge,
  Button,
  ConfirmDialog,
  CopyButton,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldRow,
  Select,
  SelectItem,
} from "@flowaid/ui/primitives";
import { KeyValueEditor } from "@flowaid/ui/forms";
import { RelativeTime } from "@flowaid/ui/data";
import { WorkflowDiffSummary } from "@flowaid/ui/inspector";
import type { WorkflowDiff } from "@flowaid/ui";
import { get, post, put } from "~/api/client";
import type {
  Deployment,
  Environment,
  VersionDetail,
  VersionSummary,
  WorkflowDetail,
} from "~/api/types";
import { WorkflowFrame } from "~/admin/WorkflowFrame";
import { missingRequiredSecrets, rowsToVariables, variablesToRows } from "~/admin/logic";
import type { DeployResult, Schedule, Webhook as WebhookRow } from "~/admin/types";
import { Notice, Section, useMembers, useMutate } from "~/admin/ui";
import { useSession } from "~/session";

type Target = { env: Environment; versionId: string };

function DeployDialog({
  workflow,
  target,
  versions,
  current,
  onClose,
  onDeployed,
}: {
  workflow: WorkflowDetail;
  target: Target | null;
  versions: VersionSummary[];
  current: Deployment | undefined;
  onClose: () => void;
  onDeployed: (r: DeployResult, env: Environment) => void;
}) {
  const s = useSession();
  const qc = useQueryClient();
  const [versionId, setVersionId] = useState(target?.versionId ?? "");
  const [rows, setRows] = useState(() => variablesToRows(current?.variableOverrides ?? {}));
  const env = target?.env;
  const version = useQuery({
    queryKey: ["version", s.ws, versionId],
    queryFn: () => get<VersionDetail>(`/v1/workflow-versions/${versionId}`),
    enabled: Boolean(versionId),
  });
  const bound = useQuery({
    queryKey: ["secret-bindings", s.ws, workflow.id, env?.id],
    queryFn: () =>
      get<Record<string, string>>(`/v1/workflows/${workflow.id}/secrets/${env?.id ?? ""}`),
    enabled: Boolean(env) && s.can("secrets:bind"),
  });
  const diff = useQuery({
    queryKey: ["version-diff", s.ws, current?.versionId, versionId],
    queryFn: () =>
      get<WorkflowDiff>(`/v1/workflow-versions/${versionId}/diff/${current?.versionId ?? ""}`),
    enabled: Boolean(versionId && current && current.versionId !== versionId),
  });
  const missing =
    version.data && bound.data
      ? missingRequiredSecrets(version.data.definition.secrets ?? [], bound.data)
      : [];
  const vars = rowsToVariables(rows);
  const deploy = useMutate(
    () =>
      put<Deployment & DeployResult>(`/v1/workflows/${workflow.id}/deployments/${env?.id ?? ""}`, {
        versionId,
        variableOverrides: vars.value,
      }),
    {
      success: (d) => `v${d.version ?? "?"} is live in ${env?.name ?? ""}`,
      onSuccess: (d) => {
        void qc.invalidateQueries({ queryKey: ["deployments", s.ws, workflow.id] });
        void qc.invalidateQueries({ queryKey: ["triggers", s.ws, workflow.id] });
        if (env) onDeployed(d, env);
        onClose();
      },
      errorTitle: "Deploy refused",
    },
  );
  const same = current?.versionId === versionId;
  return (
    <Dialog open={target !== null} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Deploy to {env?.name}
            {env?.protected ? (
              <Badge tone="warn" icon={<Lock strokeWidth={1.75} />}>
                Protected
              </Badge>
            ) : null}
          </DialogTitle>
          <DialogDescription>
            Triggers (webhooks, schedules, MCP tools) switch to the new version atomically. Running
            runs finish on the version they started with.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex max-h-[70vh] flex-col gap-4 overflow-auto">
          <FieldRow label="Version" htmlFor="dep-version" required>
            <Select id="dep-version" value={versionId} onValueChange={setVersionId} mono>
              {versions.map((v) => (
                <SelectItem
                  key={v.id}
                  value={v.id}
                  meta={v.id === current?.versionId ? "current" : undefined}
                  description={v.notes ?? v.label ?? undefined}
                >
                  v{v.version}
                </SelectItem>
              ))}
            </Select>
          </FieldRow>
          {missing.length > 0 ? (
            <Notice tone="danger">
              Required secrets are not bound in {env?.name}:{" "}
              <span className="font-mono">{missing.join(", ")}</span>.{" "}
              <Link
                className="underline"
                href={`/${s.ws}/workflows/${workflow.id}/settings?tab=secrets`}
              >
                Bind them
              </Link>{" "}
              before deploying.
            </Notice>
          ) : null}
          {same ? (
            <Notice tone="info">
              This version is already live in {env?.name}; deploying again re-applies variable
              overrides and triggers.
            </Notice>
          ) : null}
          {current && !same ? (
            <div>
              <p className="mb-1.5 text-xs font-medium text-ink">
                Changes from the live v{current.version}
              </p>
              {diff.data ? (
                <WorkflowDiffSummary diff={diff.data} />
              ) : (
                <p className="text-xs text-ink-3">Computing…</p>
              )}
            </div>
          ) : null}
          <FieldRow
            label="Variable overrides"
            hint="Override environment variables for this workflow only"
            error={vars.errors[0]}
          >
            <KeyValueEditor
              value={rows}
              onChange={(r) => setRows(r.map((x) => ({ key: x.key, value: x.value })))}
              keyPlaceholder="NAME"
              valuePlaceholder="value or JSON"
              mono
              addLabel="Add override"
              emptyText="No overrides"
            />
          </FieldRow>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            leadingIcon={<Rocket strokeWidth={1.75} />}
            loading={deploy.isPending}
            disabled={!versionId || missing.length > 0 || vars.errors.length > 0}
            onClick={() => deploy.mutate(undefined)}
          >
            Deploy v{versions.find((v) => v.id === versionId)?.version ?? ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TriggersResult({
  result,
  onClose,
}: {
  result: { r: DeployResult; env: Environment } | null;
  onClose: () => void;
}) {
  const t = result?.r.triggers;
  return (
    <Dialog open={result !== null} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Live in {result?.env.name}</DialogTitle>
          <DialogDescription>The triggers this deployment materialised.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          {t && t.webhooks.length + t.schedules.length + t.mcpExposures.length === 0 ? (
            <p className="text-xs text-ink-3">
              This workflow declares no triggers; start runs through the API.
            </p>
          ) : null}
          {t?.webhooks.map((w) => (
            <div
              key={w.id}
              className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5"
            >
              <Webhook
                strokeWidth={1.75}
                className="size-3.5 shrink-0 text-ink-3"
                aria-hidden="true"
              />
              <code className="min-w-0 flex-1 truncate font-mono text-2xs">{w.url}</code>
              {!w.secretBound ? <Badge tone="warn">No secret</Badge> : null}
              <CopyButton value={w.url} label="Copy URL" size="sm" />
            </div>
          ))}
          {t?.schedules.map((x) => (
            <div
              key={x.id}
              className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs"
            >
              <CalendarClock
                strokeWidth={1.75}
                className="size-3.5 shrink-0 text-ink-3"
                aria-hidden="true"
              />
              <code className="font-mono">{x.cron}</code>
              <span className="text-ink-3">{x.timezone}</span>
              <span className="ml-auto text-ink-3">
                {x.nextRunAt ? (
                  <>
                    next <RelativeTime date={x.nextRunAt} />
                  </>
                ) : (
                  "paused"
                )}
              </span>
            </div>
          ))}
          {t?.mcpExposures.map((x) => (
            <p key={x.id} className="text-xs">
              MCP tool <code className="font-mono">{x.toolName}</code>
            </p>
          ))}
          {(t?.disabled.length ?? 0) > 0 ? (
            <Notice>
              {t?.disabled.length} trigger(s) were disabled because the new version no longer
              declares them.
            </Notice>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Deployments({ workflow }: { workflow: WorkflowDetail }) {
  const s = useSession();
  const qc = useQueryClient();
  const params = useSearchParams();
  const members = useMembers();
  const canDeploy = s.can("workflows:publish");
  const [target, setTarget] = useState<Target | null>(null);
  const [rollback, setRollback] = useState<Deployment | null>(null);
  const [result, setResult] = useState<{ r: DeployResult; env: Environment } | null>(null);
  const versions = useQuery({
    queryKey: ["versions", s.ws, workflow.id],
    queryFn: () => get<VersionSummary[]>(`/v1/workflows/${workflow.id}/versions`),
  });
  const deployments = useQuery({
    queryKey: ["deployments", s.ws, workflow.id],
    queryFn: () => get<Deployment[]>(`/v1/workflows/${workflow.id}/deployments`),
  });
  const hooks = useQuery({
    queryKey: ["triggers", s.ws, workflow.id, "webhooks"],
    queryFn: () => get<WebhookRow[]>(`/v1/webhooks?workflowId=${workflow.id}`),
    enabled: s.can("webhooks:write"),
  });
  const schedules = useQuery({
    queryKey: ["triggers", s.ws, workflow.id, "schedules"],
    queryFn: () => get<Schedule[]>(`/v1/schedules?workflowId=${workflow.id}`),
    enabled: s.can("schedules:write"),
  });
  const published = useMemo(
    () =>
      (versions.data ?? [])
        .filter((v) => v.kind === "published")
        .sort((a, b) => (b.version ?? 0) - (a.version ?? 0)),
    [versions.data],
  );
  const byEnv = new Map((deployments.data ?? []).map((d) => [d.environmentId, d]));
  const wanted = params.get("version");
  const doRollback = useMutate(
    (d: Deployment) =>
      post<Deployment & DeployResult>(
        `/v1/workflows/${workflow.id}/deployments/${d.environmentId}/rollback`,
        {},
      ),
    {
      success: (d) => `Rolled back ${d.environment} to v${d.version ?? "?"}`,
      onSuccess: () => {
        setRollback(null);
        void qc.invalidateQueries({ queryKey: ["deployments", s.ws, workflow.id] });
        void qc.invalidateQueries({ queryKey: ["triggers", s.ws, workflow.id] });
      },
    },
  );
  const versionNo = (vid: string | null) => published.find((v) => v.id === vid)?.version;

  if (published.length === 0)
    return <Notice tone="info">Publish a version in the builder before deploying it.</Notice>;

  return (
    <div className="flex flex-col gap-4">
      {s.environments.map((env) => {
        const d = byEnv.get(env.id);
        const envHooks = (hooks.data ?? []).filter((h) => h.environmentId === env.id);
        const envSchedules = (schedules.data ?? []).filter((x) => x.environmentId === env.id);
        const prev = d?.previousVersionId ? versionNo(d.previousVersionId) : undefined;
        const others = s.environments.filter((e) => e.id !== env.id);
        return (
          <Section
            key={env.id}
            title={
              <span className="flex items-center gap-2">
                <span className="font-mono">{env.name}</span>
                {env.protected ? (
                  <Badge tone="warn" icon={<Lock strokeWidth={1.75} />}>
                    Protected
                  </Badge>
                ) : null}
                {d ? (
                  <Badge tone="ok" dot mono>
                    v{d.version}
                  </Badge>
                ) : (
                  <Badge>Not deployed</Badge>
                )}
              </span>
            }
            description={
              d ? (
                <>
                  Deployed <RelativeTime date={d.deployedAt} />
                  {d.deployedBy ? ` by ${members.get(d.deployedBy) ?? "a member"}` : ""}
                  {Object.keys(d.variableOverrides).length
                    ? ` · ${Object.keys(d.variableOverrides).length} variable override(s)`
                    : ""}
                </>
              ) : (
                "Runs against this environment fail until a version is deployed."
              )
            }
            actions={
              canDeploy ? (
                <>
                  {d && prev !== undefined ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      leadingIcon={<Undo2 strokeWidth={1.75} />}
                      onClick={() => setRollback(d)}
                    >
                      Roll back to v{prev}
                    </Button>
                  ) : null}
                  {d && others.length > 0 ? (
                    <Select
                      size="sm"
                      aria-label={`Promote v${d.version} to`}
                      value=""
                      placeholder={`Promote v${d.version} to…`}
                      className="w-44"
                      onValueChange={(to) => {
                        const e = s.environments.find((x) => x.id === to);
                        if (e) setTarget({ env: e, versionId: d.versionId });
                      }}
                    >
                      {others.map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.name}
                        </SelectItem>
                      ))}
                    </Select>
                  ) : null}
                  <Button
                    size="sm"
                    variant="primary"
                    leadingIcon={<Rocket strokeWidth={1.75} />}
                    onClick={() =>
                      setTarget({
                        env,
                        versionId:
                          wanted && published.some((v) => v.id === wanted)
                            ? wanted
                            : (published[0]?.id ?? ""),
                      })
                    }
                  >
                    Deploy
                  </Button>
                </>
              ) : null
            }
          >
            {envHooks.length + envSchedules.length === 0 ? (
              <p className="text-xs text-ink-3">No webhooks or schedules in this environment.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {envHooks.map((h) => (
                  <div key={h.id} className="flex items-center gap-2 text-xs">
                    <Webhook
                      strokeWidth={1.75}
                      className="size-3.5 shrink-0 text-ink-3"
                      aria-hidden="true"
                    />
                    <code className="min-w-0 flex-1 truncate font-mono text-2xs">{h.url}</code>
                    <Badge tone={h.enabled ? "ok" : "neutral"} dot>
                      {h.enabled ? "Enabled" : "Disabled"}
                    </Badge>
                    {!h.secretBound ? <Badge tone="warn">Unsigned</Badge> : null}
                    <CopyButton value={h.url} label="Copy webhook URL" size="sm" />
                  </div>
                ))}
                {envSchedules.map((x) => (
                  <div key={x.id} className="flex items-center gap-2 text-xs">
                    <CalendarClock
                      strokeWidth={1.75}
                      className="size-3.5 shrink-0 text-ink-3"
                      aria-hidden="true"
                    />
                    <code className="font-mono">{x.cron}</code>
                    <span className="text-ink-3">{x.timezone}</span>
                    <span className="ml-auto text-ink-3">
                      {x.enabled && x.nextRunAt ? (
                        <>
                          next <RelativeTime date={x.nextRunAt} />
                        </>
                      ) : (
                        "paused"
                      )}
                    </span>
                  </div>
                ))}
                <Link
                  className="flex items-center gap-1 self-start text-xs text-accent-text hover:underline"
                  href={`/${s.ws}/workflows/${workflow.id}/settings?tab=triggers`}
                >
                  Manage triggers{" "}
                  <ArrowUpRight strokeWidth={1.75} className="size-3" aria-hidden="true" />
                </Link>
              </div>
            )}
          </Section>
        );
      })}
      {target ? (
        <DeployDialog
          key={`${target.env.id}:${target.versionId}`}
          workflow={workflow}
          target={target}
          versions={published}
          current={byEnv.get(target.env.id)}
          onClose={() => setTarget(null)}
          onDeployed={(r, env) => setResult({ r, env })}
        />
      ) : null}
      <TriggersResult result={result} onClose={() => setResult(null)} />
      <ConfirmDialog
        open={rollback !== null}
        onOpenChange={(o) => (o ? undefined : setRollback(null))}
        title={`Roll ${rollback?.environment ?? ""} back to v${versionNo(rollback?.previousVersionId ?? null) ?? ""}?`}
        description="The previous version goes live again with its triggers. New runs use it immediately."
        confirmLabel="Roll back"
        variant="danger"
        loading={doRollback.isPending}
        onConfirm={() => {
          if (rollback) doRollback.mutate(rollback);
        }}
      />
    </div>
  );
}

export default function DeploymentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <WorkflowFrame id={id} tab="deployments">
      {(w) => (
        <Suspense>
          <Deployments workflow={w} />
        </Suspense>
      )}
    </WorkflowFrame>
  );
}
