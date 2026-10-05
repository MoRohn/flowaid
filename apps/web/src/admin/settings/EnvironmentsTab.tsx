"use client";
/**
 * Environments: create, edit variables and protection, rename, delete. Renaming and deleting say
 * what they change first (`GET /v1/environments/:id/usage`): webhook URLs carry the name, Run
 * draft uses the one named dev, and a delete removes triggers, bindings, credentials and keys (one
 * with runs on record can't be deleted).
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Lock, Pencil, Plus, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldRow,
  IconButton,
  Input,
  Switch,
} from "@flowaid/ui/primitives";
import { KeyValueEditor } from "@flowaid/ui/forms";
import { del, get, patch, post } from "~/api/client";
import type { Environment } from "~/api/types";
import { useSession } from "~/session";
import { ENVIRONMENT_NAME, VARIABLE_NAME, rowsToVariables, variablesToRows } from "../logic";
import { Notice, Section, useConfirm, useMutate } from "../ui";

/** What depends on an environment (`GET /v1/environments/:id/usage`). */
export interface EnvironmentUsage {
  runs: number;
  evaluationRuns: number;
  deployments: number;
  webhooks: number;
  schedules: number;
  mcpExposures: number;
  secretBindings: number;
  credentials: number;
  apiKeys: number;
}

function useEnvironmentUsage(id: string | null) {
  const s = useSession();
  return useQuery({
    queryKey: ["environment-usage", s.ws, id],
    queryFn: () => get<EnvironmentUsage>(`/v1/environments/${id ?? ""}/usage`),
    enabled: id !== null,
  });
}

const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** Run draft resolves the environment by this name (services/runs.ts). */
const DRAFT_ENVIRONMENT = "dev";

/** What deleting the environment does, one line per thing that depends on it. */
export function deleteConsequences(name: string, u: EnvironmentUsage): string[] {
  const lines: string[] = [];
  if (u.deployments)
    lines.push(`${n(u.deployments, "deployment")} end: those workflows stop running in ${name}.`);
  const is = (count: number) => (count === 1 ? "is" : "are");
  const triggers = [
    u.webhooks ? n(u.webhooks, "webhook") : "",
    u.schedules ? n(u.schedules, "schedule") : "",
    u.mcpExposures ? n(u.mcpExposures, "MCP tool") : "",
  ].filter(Boolean);
  const triggerCount = u.webhooks + u.schedules + u.mcpExposures;
  if (triggers.length)
    lines.push(
      `${triggers.slice(0, -1).join(", ")}${triggers.length > 1 ? " and " : ""}${triggers.at(-1) ?? ""} ${is(triggerCount)} removed${u.webhooks ? "; webhook URLs stop working" : ""}.`,
    );
  if (u.secretBindings)
    lines.push(`${n(u.secretBindings, "secret binding")} ${is(u.secretBindings)} removed.`);
  if (u.credentials)
    lines.push(
      `${n(u.credentials, "credential")} limited to ${name} ${is(u.credentials)} deleted for good.`,
    );
  if (u.apiKeys)
    lines.push(
      `${n(u.apiKeys, "API key or MCP token", "API keys and MCP tokens")} pinned to ${name} ${is(u.apiKeys)} revoked.`,
    );
  if (name === DRAFT_ENVIRONMENT)
    lines.push("Run draft uses dev: draft runs fail until there is a dev environment again.");
  return lines;
}

/** What renaming the environment changes. */
export function renameConsequences(from: string, to: string, webhooks: number): string[] {
  const lines = [
    webhooks
      ? `Webhook URLs carry the environment's name: ${n(webhooks, "webhook")} here keep${webhooks === 1 ? "s" : ""} the …/${from}/… URL until its workflow is next deployed, then move${webhooks === 1 ? "s" : ""} to …/${to}/… and the old URL stops working.`
      : `Webhook URLs carry the environment's name: webhooks deployed here later use …/${to}/….`,
  ];
  if (from === DRAFT_ENVIRONMENT)
    lines.push(
      "Run draft uses the environment named dev: after renaming it, draft runs fail until an environment is called dev again.",
    );
  return lines;
}

function EnvironmentDialog({
  env,
  open,
  onOpenChange,
}: {
  env: Environment | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const s = useSession();
  const qc = useQueryClient();
  const [name, setName] = useState(env?.name ?? "");
  const [isProtected, setProtected] = useState(env?.protected ?? false);
  const [rows, setRows] = useState(variablesToRows(env?.variables ?? {}));
  const vars = rowsToVariables(rows);
  const save = useMutate(
    () => {
      const body = { name: name.trim(), protected: isProtected, variables: vars.value };
      return env
        ? patch<Environment>(`/v1/environments/${env.id}`, body)
        : post<Environment>("/v1/environments", body);
    },
    {
      success: (e) => (env ? `Saved ${e.name}` : `Created ${e.name}`),
      onSuccess: () => {
        onOpenChange(false);
        void qc.invalidateQueries({ queryKey: ["environments", s.ws] });
      },
    },
  );
  const nameOk = ENVIRONMENT_NAME.test(name.trim());
  const renaming = env !== null && nameOk && name.trim() !== env.name;
  const usage = useEnvironmentUsage(renaming && env ? env.id : null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(undefined);
          }}
        >
          <DialogHeader>
            <DialogTitle>{env ? `Edit ${env.name}` : "New environment"}</DialogTitle>
            <DialogDescription>
              Variables are available to workflows as <code className="font-mono">$vars</code>;
              deployments can override them.
              {env
                ? null
                : " A new environment starts empty: each workflow still needs a version deployed, its secrets bound and its triggers added there."}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <FieldRow
              label="Name"
              htmlFor="env-name"
              required
              hint="Lowercase letters, digits and dashes"
              error={name && !nameOk ? "Use lowercase letters, digits and dashes" : undefined}
            >
              <Input
                id="env-name"
                className="font-mono"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="staging"
              />
            </FieldRow>
            {renaming && env ? (
              <Notice>
                {renameConsequences(env.name, name.trim(), usage.data?.webhooks ?? 0).join(" ")}
              </Notice>
            ) : null}
            <FieldRow
              label="Protected"
              htmlFor="env-protected"
              layout="row"
              hint="Only admins can deploy here, and it counts as production. Protect every environment that answers real requests."
            >
              <Switch id="env-protected" checked={isProtected} onCheckedChange={setProtected} />
            </FieldRow>
            <FieldRow
              label="Variables"
              error={vars.errors[0]}
              hint="Values for workflow variables whose source is the environment; nodes read them as $vars.NAME. For example SUPPORT_EMAIL = support@example.com, or MAX_REFUND = 200. Keys and passwords belong in Credentials, not here: variables are shown in plain text."
            >
              <KeyValueEditor
                value={rows}
                onChange={(r) => setRows(r.map((x) => ({ key: x.key, value: x.value })))}
                keyPlaceholder="NAME"
                valuePlaceholder="value or JSON"
                mono
                addLabel="Add variable"
                emptyText="No variables"
                validateRow={(r) =>
                  r.key && !VARIABLE_NAME.test(r.key) ? "Letters, digits and _ only" : undefined
                }
              />
            </FieldRow>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={save.isPending}
              disabled={!nameOk || vars.errors.length > 0}
            >
              {env ? "Save" : "Create environment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EnvironmentsTab() {
  const s = useSession();
  const qc = useQueryClient();
  const canEdit = s.can("admin");
  const [editing, setEditing] = useState<Environment | "new" | null>(null);
  const confirm = useConfirm<Environment>();
  const remove = useMutate((e: Environment) => del(`/v1/environments/${e.id}`), {
    success: (_, e) => `Deleted ${e.name}`,
    onSuccess: () => {
      confirm.close();
      void qc.invalidateQueries({ queryKey: ["environments", s.ws] });
    },
    errorTitle: "Could not delete the environment",
  });
  const usage = useEnvironmentUsage(confirm.target?.id ?? null);
  const runsOnRecord = (usage.data?.runs ?? 0) + (usage.data?.evaluationRuns ?? 0);
  return (
    <Section
      title="Environments"
      description="Stages a workflow moves through (dev, staging, prod). Each has its own deployed version, secret bindings, variables, webhooks and schedules."
      actions={
        canEdit ? (
          <Button
            variant="primary"
            leadingIcon={<Plus strokeWidth={1.75} />}
            onClick={() => setEditing("new")}
          >
            New environment
          </Button>
        ) : null
      }
    >
      <ul
        className="flex flex-col divide-y divide-border rounded-md border border-border"
        role="list"
      >
        {s.environments.map((e) => {
          const n = Object.keys(e.variables ?? {}).length;
          return (
            <li key={e.id} className="flex items-center gap-3 px-3 py-2">
              <span className="font-mono text-sm text-ink">{e.name}</span>
              {e.protected ? (
                <Badge tone="warn" icon={<Lock strokeWidth={1.75} />}>
                  Protected
                </Badge>
              ) : null}
              <span className="flex-1 text-2xs text-ink-3">
                {n} variable{n === 1 ? "" : "s"}
              </span>
              {canEdit ? (
                <>
                  <IconButton
                    size="sm"
                    variant="ghost"
                    label={`Edit ${e.name}`}
                    onClick={() => setEditing(e)}
                  >
                    <Pencil strokeWidth={1.75} />
                  </IconButton>
                  <IconButton
                    size="sm"
                    variant="ghost"
                    label={`Delete ${e.name}`}
                    onClick={() => confirm.ask(e)}
                  >
                    <Trash2 strokeWidth={1.75} />
                  </IconButton>
                </>
              ) : null}
            </li>
          );
        })}
      </ul>
      {editing !== null ? (
        <EnvironmentDialog
          key={editing === "new" ? "new" : editing.id}
          env={editing === "new" ? null : editing}
          open
          onOpenChange={(o) => (o ? undefined : setEditing(null))}
        />
      ) : null}
      <ConfirmDialog
        open={confirm.target !== null}
        onOpenChange={(o) => (o ? undefined : confirm.close())}
        title={`Delete ${confirm.target?.name ?? "environment"}?`}
        description={
          usage.isPending
            ? "Checking what depends on it…"
            : runsOnRecord > 0
              ? undefined
              : "This can't be undone."
        }
        variant="danger"
        confirmLabel="Delete"
        loading={remove.isPending}
        confirmDisabled={!usage.isSuccess || runsOnRecord > 0}
        onConfirm={() => {
          if (confirm.target) remove.mutate(confirm.target);
        }}
      >
        {usage.isError ? (
          <Notice tone="danger">Could not check what depends on it; try again.</Notice>
        ) : usage.data && confirm.target ? (
          runsOnRecord > 0 ? (
            <Notice tone="danger">
              {confirm.target.name} can&apos;t be deleted: {n(runsOnRecord, "run")} on record keep
              {runsOnRecord === 1 ? "s" : ""} their environment. Undeploy its workflows from their
              Deployments tab instead.
            </Notice>
          ) : (
            <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-xs text-ink-2">
              {(deleteConsequences(confirm.target.name, usage.data).length
                ? deleteConsequences(confirm.target.name, usage.data)
                : ["Nothing depends on it."]
              ).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )
        ) : null}
      </ConfirmDialog>
    </Section>
  );
}
