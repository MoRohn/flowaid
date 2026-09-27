"use client";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, use, useState } from "react";
import {
  Badge,
  Button,
  ConfirmDialog,
  FieldRow,
  Input,
  Select,
  SelectItem,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
} from "@flowaid/ui/primitives";
import { del, get, patch, put } from "~/api/client";
import type { WorkflowDetail } from "~/api/types";
import { WorkflowFrame } from "~/admin/WorkflowFrame";
import { credentialsForSecret, missingRequiredSecrets, parseTags } from "~/admin/logic";
import type { Credential, EvaluationSet } from "~/admin/types";
import { Notice, QueryView, Section, useMutate, useQueryTab } from "~/admin/ui";
import { useSession } from "~/session";
import { ScheduleList } from "~/admin/triggers/Schedules";
import { WebhookList } from "~/admin/triggers/Webhooks";

const TABS = ["general", "secrets", "triggers", "evaluation", "danger"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = {
  general: "General",
  secrets: "Secrets",
  triggers: "Triggers",
  evaluation: "Evaluation",
  danger: "Danger zone",
};
const NONE = "__none";

function General({ w }: { w: WorkflowDetail }) {
  const s = useSession();
  const [name, setName] = useState(w.name);
  const [description, setDescription] = useState(w.description);
  const [tags, setTags] = useState(w.tags.join(", "));
  const canWrite = s.can("workflows:write");
  const save = useMutate(
    () =>
      patch<WorkflowDetail>(`/v1/workflows/${w.id}`, {
        name: name.trim(),
        description,
        tags: parseTags(tags),
      }),
    {
      success: "Saved",
      invalidate: [
        ["workflow", s.ws, w.id],
        ["workflows", s.ws],
      ],
    },
  );
  const dirty =
    name !== w.name ||
    description !== w.description ||
    parseTags(tags).join(",") !== w.tags.join(",");
  return (
    <Section title="General">
      <form
        className="grid max-w-2xl gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined);
        }}
      >
        <FieldRow label="Name" htmlFor="wf-name" required>
          <Input
            id="wf-name"
            value={name}
            maxLength={200}
            disabled={!canWrite}
            onChange={(e) => setName(e.target.value)}
          />
        </FieldRow>
        <FieldRow label="Slug" htmlFor="wf-slug" hint="Used by the CLI and in webhook paths">
          <Input id="wf-slug" value={w.slug} readOnly className="font-mono" />
        </FieldRow>
        <FieldRow label="Description" htmlFor="wf-desc">
          <Textarea
            id="wf-desc"
            rows={3}
            maxLength={4000}
            value={description}
            disabled={!canWrite}
            onChange={(e) => setDescription(e.target.value)}
          />
        </FieldRow>
        <FieldRow label="Tags" htmlFor="wf-tags" hint="Comma separated">
          <Input
            id="wf-tags"
            value={tags}
            disabled={!canWrite}
            onChange={(e) => setTags(e.target.value)}
          />
        </FieldRow>
        {canWrite ? (
          <div>
            <Button
              type="submit"
              variant="primary"
              loading={save.isPending}
              disabled={!dirty || !name.trim()}
            >
              Save
            </Button>
          </div>
        ) : null}
      </form>
    </Section>
  );
}

function EnvSecrets({
  w,
  envId,
  credentials,
}: {
  w: WorkflowDetail;
  envId: string;
  credentials: Credential[];
}) {
  const s = useSession();
  const bound = useQuery({
    queryKey: ["secret-bindings", s.ws, w.id, envId],
    queryFn: () => get<Record<string, string>>(`/v1/workflows/${w.id}/secrets/${envId}`),
  });
  return (
    <EnvSecretsForm
      key={JSON.stringify(bound.data ?? null)}
      w={w}
      envId={envId}
      credentials={credentials}
      bound={bound}
    />
  );
}

function EnvSecretsForm({
  w,
  envId,
  credentials,
  bound,
}: {
  w: WorkflowDetail;
  envId: string;
  credentials: Credential[];
  bound: UseQueryResult<Record<string, string>>;
}) {
  const s = useSession();
  const env = s.environments.find((e) => e.id === envId);
  const declared = w.draft.secrets ?? [];
  const [draft, setDraft] = useState<Record<string, string>>(() => bound.data ?? {});
  const save = useMutate(
    () => put<Record<string, string>>(`/v1/workflows/${w.id}/secrets/${envId}`, draft),
    {
      success: `Bindings saved for ${env?.name ?? "the environment"}`,
      invalidate: [["secret-bindings", s.ws, w.id, envId]],
    },
  );
  const missing = missingRequiredSecrets(declared, draft);
  const dirty = JSON.stringify(bound.data ?? {}) !== JSON.stringify(draft);
  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <span className="font-mono">{env?.name}</span>
          {missing.length ? (
            <Badge tone="danger" dot>
              {missing.length} required unbound
            </Badge>
          ) : (
            <Badge tone="ok" dot>
              Ready to deploy
            </Badge>
          )}
        </span>
      }
      actions={
        <Button
          size="sm"
          variant="primary"
          loading={save.isPending}
          disabled={!dirty}
          onClick={() => save.mutate(undefined)}
        >
          Save bindings
        </Button>
      }
    >
      <QueryView query={bound} rows={2}>
        {() => (
          <div className="flex flex-col gap-3">
            {declared.map((d) => {
              const options = credentialsForSecret(d, credentials, envId, w.id);
              return (
                <div
                  key={d.name}
                  className="grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5">
                      <code className="font-mono text-xs text-ink">{d.name}</code>
                      {d.required === false ? (
                        <Badge tone="outline" size="sm">
                          optional
                        </Badge>
                      ) : null}
                    </p>
                    <p className="truncate text-2xs text-ink-3">
                      {d.credentialType}
                      {d.description ? ` · ${d.description}` : ""}
                    </p>
                  </div>
                  <Select
                    aria-label={`Credential for ${d.name} in ${env?.name ?? ""}`}
                    value={draft[d.name] ?? NONE}
                    invalid={d.required !== false && !draft[d.name]}
                    placeholder="Not bound"
                    onValueChange={(v) =>
                      setDraft((x) => {
                        const next = { ...x };
                        if (v === NONE) delete next[d.name];
                        else next[d.name] = v;
                        return next;
                      })
                    }
                  >
                    <SelectItem value={NONE}>Not bound</SelectItem>
                    {options.map((c) => (
                      <SelectItem
                        key={c.id}
                        value={c.id}
                        meta={c.environmentId ? "env" : "all envs"}
                      >
                        {c.name}
                      </SelectItem>
                    ))}
                  </Select>
                </div>
              );
            })}
          </div>
        )}
      </QueryView>
    </Section>
  );
}

function Secrets({ w }: { w: WorkflowDetail }) {
  const s = useSession();
  const creds = useQuery({
    queryKey: ["credentials", s.ws],
    queryFn: () => get<Credential[]>("/v1/credentials"),
    enabled: s.can("credentials:read"),
  });
  const declared = w.draft.secrets ?? [];
  if (!s.can("secrets:bind"))
    return <Notice tone="info">You need the secrets:bind scope to see and change bindings.</Notice>;
  if (declared.length === 0)
    return (
      <Notice tone="info">
        This workflow declares no secrets. Declare them in the builder (workflow settings → secrets)
        to bind credentials per environment.
      </Notice>
    );
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-ink-3">
        Each declared secret resolves to a credential per environment. Deploys are refused while a
        required secret is unbound.{" "}
        {s.features.credentials ? (
          <Link className="text-accent-text hover:underline" href={`/${s.ws}/credentials`}>
            Manage credentials
          </Link>
        ) : null}
      </p>
      {s.environments.map((e) => (
        <EnvSecrets key={e.id} w={w} envId={e.id} credentials={creds.data ?? []} />
      ))}
    </div>
  );
}

function Triggers({ w }: { w: WorkflowDetail }) {
  const s = useSession();
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-ink-3">
        Triggers are declared in the workflow and materialised per environment on deploy. Here you
        control the environment-specific parts.
        {s.features.schedules ? (
          <>
            {" "}
            <Link className="text-accent-text hover:underline" href={`/${s.ws}/triggers`}>
              All triggers in this workspace
            </Link>
          </>
        ) : null}
      </p>
      <Section title="Webhooks">
        <WebhookList workflowId={w.id} />
      </Section>
      <Section title="Schedules">
        <ScheduleList workflowId={w.id} />
      </Section>
    </div>
  );
}

function Evaluation({ w }: { w: WorkflowDetail }) {
  const s = useSession();
  const sets = useQuery({
    queryKey: ["evaluation-sets", s.ws],
    queryFn: () => get<EvaluationSet[]>("/v1/evaluations/sets"),
  });
  const link = useMutate(
    (setId: string | null) => patch(`/v1/workflows/${w.id}`, { evaluationSetId: setId }),
    {
      success: (_, id) => (id ? "Evaluation set linked" : "Evaluation set unlinked"),
      invalidate: [["workflow", s.ws, w.id]],
    },
  );
  if (!s.features.evaluations)
    return <Notice tone="info">Evaluations are not enabled on this server.</Notice>;
  return (
    <Section
      title="Evaluation set"
      description="The set the publish dialog offers as a gate and the compare view uses for metric deltas."
    >
      <QueryView query={sets} rows={1}>
        {(rows) => {
          const usable = rows.filter((x) => !x.workflowId || x.workflowId === w.id);
          return (
            <div className="flex flex-wrap items-end gap-3">
              <FieldRow label="Linked set" htmlFor="wf-evalset" className="w-80">
                <Select
                  id="wf-evalset"
                  value={w.evaluationSetId ?? NONE}
                  disabled={!s.can("workflows:write")}
                  onValueChange={(v) => link.mutate(v === NONE ? null : v)}
                >
                  <SelectItem value={NONE}>None</SelectItem>
                  {usable.map((x) => (
                    <SelectItem key={x.id} value={x.id} description={x.description || undefined}>
                      {x.name}
                    </SelectItem>
                  ))}
                </Select>
              </FieldRow>
              {w.evaluationSetId ? (
                <Link
                  className="pb-1.5 text-xs text-accent-text hover:underline"
                  href={`/${s.ws}/evaluations/sets/${w.evaluationSetId}`}
                >
                  Open the set
                </Link>
              ) : (
                <Link
                  className="pb-1.5 text-xs text-accent-text hover:underline"
                  href={`/${s.ws}/evaluations`}
                >
                  Create a set
                </Link>
              )}
            </div>
          );
        }}
      </QueryView>
    </Section>
  );
}

function Danger({ w }: { w: WorkflowDetail }) {
  const s = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const [mode, setMode] = useState<"archive" | "purge" | null>(null);
  const [typed, setTyped] = useState("");
  const remove = useMutate(
    (purge: boolean) => del(`/v1/workflows/${w.id}${purge ? "?purge=true" : ""}`),
    {
      success: (_, purge) => (purge ? `Deleted ${w.name}` : `Archived ${w.name}`),
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: ["workflows", s.ws] });
        router.push(`/${s.ws}/workflows`);
      },
    },
  );
  if (!s.can("workflows:delete"))
    return <Notice tone="info">Only admins can archive or delete workflows.</Notice>;
  return (
    <Section title="Danger zone" danger>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-ink">Archive</p>
            <p className="text-xs text-ink-3">
              Hides the workflow and stops its triggers. Runs and versions are kept.
            </p>
          </div>
          <Button onClick={() => setMode("archive")}>Archive workflow</Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-ink">Delete permanently</p>
            <p className="text-xs text-ink-3">
              Removes the workflow, its versions, deployments and run history. This cannot be
              undone.
            </p>
          </div>
          <Button variant="danger" onClick={() => setMode("purge")}>
            Delete workflow
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={mode !== null}
        onOpenChange={(o) => {
          if (!o) {
            setMode(null);
            setTyped("");
          }
        }}
        title={mode === "purge" ? `Delete ${w.name} permanently?` : `Archive ${w.name}?`}
        description={
          mode === "purge"
            ? "Type the workflow's slug to confirm."
            : "You can still find it with the archived filter."
        }
        variant="danger"
        confirmLabel={mode === "purge" ? "Delete permanently" : "Archive"}
        confirmDisabled={mode === "purge" && typed !== w.slug}
        loading={remove.isPending}
        onConfirm={() => remove.mutate(mode === "purge")}
      >
        {mode === "purge" ? (
          <Input
            aria-label="Workflow slug"
            className="font-mono"
            placeholder={w.slug}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
        ) : null}
      </ConfirmDialog>
    </Section>
  );
}

function Settings({ w }: { w: WorkflowDetail }) {
  const [tab, setTab] = useQueryTab<Tab>(TABS);
  return (
    <div className="flex flex-col gap-4">
      <ToggleGroup
        type="single"
        value={tab}
        onValueChange={(v) => v && setTab(v as Tab)}
        aria-label="Settings section"
      >
        {TABS.map((t) => (
          <ToggleGroupItem key={t} value={t}>
            {TAB_LABEL[t]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {tab === "general" ? (
        <General w={w} />
      ) : tab === "secrets" ? (
        <Secrets w={w} />
      ) : tab === "triggers" ? (
        <Triggers w={w} />
      ) : tab === "evaluation" ? (
        <Evaluation w={w} />
      ) : (
        <Danger w={w} />
      )}
    </div>
  );
}

export default function WorkflowSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <WorkflowFrame id={id} tab="settings">
      {(w) => (
        <Suspense>
          <Settings w={w} />
        </Suspense>
      )}
    </WorkflowFrame>
  );
}
