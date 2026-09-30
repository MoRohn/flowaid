"use client";
/**
 * API keys: create (scopes, environment and workflow pins, expiry, rate limit) step by step,
 * rotate with grace, revoke. The key is shown once, with a request that calls a workflow with it.
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { KeyRound, Plus, RotateCw, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  CopyButton,
  Checkbox,
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  FieldRow,
  IconButton,
  Input,
  NumberInput,
  Select,
  SelectItem,
  ToggleGroup,
  ToggleGroupItem,
} from "@flowaid/ui/primitives";
import { RelativeTime, ScopeChips } from "@flowaid/ui/data";
import { del, get, getAll, post } from "~/api/client";
import type { ApiKeySummary, Page, WorkflowSummary } from "~/api/types";
import { DraftStatus, GuidedFlow, type FlowStep } from "~/guide/GuidedFlow";
import { CheckList, type Check } from "~/guide/Readiness";
import { useKeptDraft } from "~/guide/useKeptDraft";
import { useSession } from "~/session";
import { HELP } from "~/shell/help";
import { LearnMore } from "~/shell/LearnMore";
import { SCOPE_GROUPS, SCOPE_PRESETS, daysUntil } from "../logic";
import type { CreatedKey } from "../types";
import { OneTimeSecretDialog, QueryView, Section, useConfirm, useMutate } from "../ui";
import { useOpenFromQuery } from "~/admin/ui";
import {
  ANY_ENVIRONMENT,
  EXPIRY_DAYS,
  apiKeyBody,
  apiKeyChecks,
  emptyApiKeyDraft,
  type ApiKeyDraft,
  type GuidanceCheck,
} from "./guidance";

/** What each ready-made scope set is for, beside its button. */
const PRESET_USE: Record<string, string> = {
  "Run workflows": "Start runs and read their results: a website, a script or another service.",
  "Read only": "Look at workflows, runs and evaluation results: dashboards and reports.",
  "CI / deploy": "Change, publish and deploy workflows and run evaluations: a CI job.",
};

function CreateKeyDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (k: CreatedKey, draft: ApiKeyDraft) => void;
}) {
  const s = useSession();
  // kept in this browser tab until the key is created; a key's draft holds no secret
  const kept = useKeptDraft<ApiKeyDraft>(`flowaid:draft:${s.ws}:api-key`, () =>
    emptyApiKeyDraft(SCOPE_PRESETS["Run workflows"] ?? []),
  );
  const { draft, setDraft } = kept;
  const set = <K extends keyof ApiKeyDraft>(k: K, v: ApiKeyDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));
  const workflows = useQuery({
    queryKey: ["workflow-names", s.ws],
    queryFn: () => get<Page<WorkflowSummary>>("/v1/workflows?limit=200"),
    select: (p) => p.items,
    enabled: open,
  });
  const checks = apiKeyChecks(draft, { environments: s.environments, isAdmin: s.can("admin") });
  const blocking = checks.filter((c) => c.state === "blocker");
  const blockedAt = (step: GuidanceCheck["step"]) => blocking.some((c) => c.step === step);
  // what a step still needs, in the checks' own words (nothing on the form is marked)
  const needed = (step?: GuidanceCheck["step"]) =>
    blocking
      .filter((c) => step === undefined || c.step === step)
      .map((c) => c.message.charAt(0).toLowerCase() + c.message.slice(1))
      .join("; ");
  const create = useMutate(() => post<CreatedKey>("/v1/api-keys", apiKeyBody(draft)), {
    invalidate: [["api-keys", s.ws]],
    // a refused create keeps the draft as it is
    errorTitle: "Could not create the key",
    onSuccess: (k) => {
      onOpenChange(false);
      onCreated(k, draft);
      kept.discard();
    },
  });
  const toggle = (scope: string, on: boolean) =>
    set("scopes", on ? [...draft.scopes, scope] : draft.scopes.filter((x) => x !== scope));
  const preset = Object.entries(SCOPE_PRESETS).find(
    ([, set]) => set.length === draft.scopes.length && set.every((x) => draft.scopes.includes(x)),
  )?.[0];
  const envName = (id: string) => s.environments.find((e) => e.id === id)?.name ?? id;

  const steps: FlowStep[] = [
    {
      id: "name",
      title: "Name it",
      why: "Name the key after what will use it. When you look at the list, or at the audit log, the name is how you tell which system made a call and which key to rotate.",
      done: !blockedAt("name"),
      requirement: "give the key a name",
      example: (
        <>
          <strong className="font-medium text-ink">website-support-form</strong>,{" "}
          <strong className="font-medium text-ink">ci-publish</strong> or{" "}
          <strong className="font-medium text-ink">nightly-report</strong>: one key per caller.
        </>
      ),
      children: (
        <FieldRow label="Name" htmlFor="key-name" required>
          <Input
            id="key-name"
            value={draft.name}
            maxLength={100}
            onChange={(e) => set("name", e.target.value)}
            placeholder="ci-deploy"
          />
        </FieldRow>
      ),
    },
    {
      id: "scopes",
      title: "Choose what it may do",
      why: "Scopes are the actions the key allows. Give it only what its caller needs: a leaked key can do exactly what its scopes allow. Scopes your own role lacks are greyed out.",
      done: !blockedAt("scopes"),
      requirement: "choose at least one scope",
      example:
        "Most callers only start runs: Run workflows is enough. Add a scope later by creating a new key, when a call fails with a missing-scope error.",
      children: (
        <fieldset>
          <legend className="sr-only">Scopes</legend>
          <div className="mb-3 flex flex-col gap-1.5">
            {Object.entries(SCOPE_PRESETS).map(([label, scopes]) => (
              <div key={label} className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={preset === label ? "primary" : "secondary"}
                  aria-pressed={preset === label}
                  onClick={() => set("scopes", [...scopes])}
                >
                  {label}
                </Button>
                <span className="text-xs text-ink-3">{PRESET_USE[label]}</span>
              </div>
            ))}
          </div>
          <p className="m-0 mb-2 text-xs font-medium text-ink">Scopes ({draft.scopes.length})</p>
          <div className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-2">
            {SCOPE_GROUPS.map((g) => (
              <div key={g.label} className="flex flex-col gap-1">
                <p className="text-2xs font-semibold uppercase tracking-wide text-ink-3">
                  {g.label}
                </p>
                {g.scopes.map((sc) => (
                  <Checkbox
                    key={sc}
                    size="sm"
                    label={<span className="font-mono text-xs">{sc}</span>}
                    checked={draft.scopes.includes(sc)}
                    disabled={!s.can(sc)}
                    onCheckedChange={(c) => toggle(sc, c === true)}
                  />
                ))}
              </div>
            ))}
          </div>
        </fieldset>
      ),
    },
    {
      id: "reach",
      title: "Choose where it works",
      why: "Limit the key to one environment and to the workflows it calls. A key limited to an environment always runs there; one that is not must name the environment in every request.",
      done: !blockedAt("reach"),
      requirement: needed("reach") || "fix what the review lists",
      example:
        "A production caller: limit it to prod and to its workflows. A test script: a Test key limited to dev.",
      children: (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldRow
              label="Environment"
              htmlFor="key-env"
              hint="Runs started with this key use this environment"
            >
              <Select id="key-env" value={draft.env} onValueChange={(v) => set("env", v)}>
                <SelectItem value={ANY_ENVIRONMENT}>Any (the request chooses)</SelectItem>
                {s.environments.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}
                  </SelectItem>
                ))}
              </Select>
            </FieldRow>
            <FieldRow
              label="Mode"
              htmlFor="key-mode"
              hint="Test keys start fa_test_ so they are easy to tell apart, and cannot be limited to a protected environment"
            >
              <ToggleGroup
                id="key-mode"
                type="single"
                value={draft.mode}
                onValueChange={(v) => v && set("mode", v as "live" | "test")}
                aria-label="Mode"
              >
                <ToggleGroupItem value="live">Live</ToggleGroupItem>
                <ToggleGroupItem value="test">Test</ToggleGroupItem>
              </ToggleGroup>
            </FieldRow>
          </div>
          <fieldset>
            <legend className="mb-2 text-xs font-medium text-ink">
              Workflows ({draft.pinned.length ? `${draft.pinned.length} pinned` : "all"})
            </legend>
            <div className="flex max-h-40 flex-col gap-1 overflow-auto rounded-md border border-border p-2">
              {(workflows.data ?? []).length === 0 ? (
                <p className="text-xs text-ink-3">
                  No workflows yet; the key will reach every workflow.
                </p>
              ) : (
                (workflows.data ?? []).map((w) => (
                  <Checkbox
                    key={w.id}
                    size="sm"
                    label={w.name}
                    checked={draft.pinned.includes(w.id)}
                    onCheckedChange={(c) =>
                      set(
                        "pinned",
                        c === true
                          ? [...draft.pinned, w.id]
                          : draft.pinned.filter((x) => x !== w.id),
                      )
                    }
                  />
                ))
              )}
            </div>
          </fieldset>
          <FieldRow
            label="Service account"
            htmlFor="key-sa"
            hint="Owned by a bot identity instead of you, with exactly the scopes chosen here. Admins only."
          >
            <Checkbox
              id="key-sa"
              checked={draft.serviceAccount}
              onCheckedChange={(c) => set("serviceAccount", c === true)}
              label="Create as a service account"
            />
          </FieldRow>
        </>
      ),
    },
    {
      id: "expiry",
      title: "Set how long it lasts",
      why: "Every key expires. A shorter life limits the damage of a key that leaked unnoticed; rotating issues a new key with the same settings and lets the old one overlap for a grace period.",
      done: !blockedAt("expiry"),
      requirement: "choose when it expires",
      example: "90 days suits most callers. Use 30 for a one-off script.",
      children: (
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldRow label="Expires" htmlFor="key-exp">
            <Select id="key-exp" value={draft.days} onValueChange={(v) => set("days", v)}>
              {EXPIRY_DAYS.map((d) => (
                <SelectItem key={d} value={String(d)}>
                  In {d} days
                </SelectItem>
              ))}
            </Select>
          </FieldRow>
          <FieldRow
            label="Rate limit"
            htmlFor="key-rate"
            hint="Requests per minute; empty uses the server default"
          >
            <NumberInput
              id="key-rate"
              value={draft.rate}
              min={1}
              max={100_000}
              unit="/min"
              onValueChange={(v) => set("rate", v)}
            />
          </FieldRow>
        </div>
      ),
    },
    {
      id: "review",
      doneLabel: "Ready to create",
      title: "Review and create",
      why: "Check what the key can reach. The key is shown once, right after you create it: have your secret store ready.",
      done: blocking.length === 0,
      requirement: needed() || "fix what is listed above",
      children: (
        <>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-sm border border-border px-3 py-2 text-sm">
            <dt className="text-ink-3">Name</dt>
            <dd className="m-0 text-ink">{draft.name.trim() || "—"}</dd>
            <dt className="text-ink-3">Scopes</dt>
            <dd className="m-0 font-mono text-xs text-ink">
              {draft.scopes.length ? draft.scopes.join(", ") : "—"}
            </dd>
            <dt className="text-ink-3">Environment</dt>
            <dd className="m-0 text-ink">
              {draft.env === ANY_ENVIRONMENT ? "Any" : envName(draft.env)}
            </dd>
            <dt className="text-ink-3">Workflows</dt>
            <dd className="m-0 text-ink">
              {draft.pinned.length ? `${draft.pinned.length} pinned` : "All"}
            </dd>
            <dt className="text-ink-3">Expires</dt>
            <dd className="m-0 text-ink">In {draft.days} days</dd>
          </dl>
          <CheckList
            checks={checks.map((c): Check => ({ id: c.id, label: c.message, state: c.state }))}
            aria-label="Before you create"
          />
        </>
      ),
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (blocking.length === 0) create.mutate(undefined);
          }}
        >
          <DialogHeader>
            <DialogTitle>New API key</DialogTitle>
            <DialogDescription>
              Keys never exceed your own role&apos;s scopes. Pin keys to an environment and
              workflows whenever you can.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex max-h-[70vh] flex-col gap-4 overflow-auto">
            <GuidedFlow
              steps={steps}
              status={
                <DraftStatus
                  dirty={kept.dirty}
                  restored={kept.restored}
                  onDiscard={kept.discard}
                  what="the key"
                />
              }
            />
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={create.isPending}
              disabled={blocking.length > 0}
            >
              Create key
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ApiKeysTab() {
  const s = useSession();
  const [creating, setCreating] = useOpenFromQuery();
  const [secret, setSecret] = useState<{
    title: string;
    key: string;
    environmentId: string | null;
  } | null>(null);
  const [rotating, setRotating] = useState<ApiKeySummary | null>(null);
  const [grace, setGrace] = useState("60");
  const revoke = useConfirm<ApiKeySummary>();
  const keys = useQuery({
    queryKey: ["api-keys", s.ws],
    queryFn: () => getAll<ApiKeySummary>("/v1/api-keys"),
  });
  const rotate = useMutate(
    (k: ApiKeySummary) =>
      post<CreatedKey>(`/v1/api-keys/${k.id}/rotate`, { graceMinutes: Number(grace) }),
    {
      invalidate: [["api-keys", s.ws]],
      onSuccess: (c, k) => {
        setRotating(null);
        setSecret({ title: `New key for ${k.name}`, key: c.key, environmentId: k.environmentId });
      },
    },
  );
  const remove = useMutate((k: ApiKeySummary) => del(`/v1/api-keys/${k.id}`), {
    success: (_, k) => `Revoked ${k.name}`,
    invalidate: [["api-keys", s.ws]],
    onSuccess: revoke.close,
  });
  const envName = (id: string | null) =>
    id ? (s.environments.find((e) => e.id === id)?.name ?? id.slice(0, 8)) : null;

  return (
    <Section
      title="API keys"
      description="For scripts, CI and services calling the API. Keys are shown once and stored hashed."
      actions={
        <Button
          variant="primary"
          leadingIcon={<Plus strokeWidth={1.75} />}
          onClick={() => setCreating(true)}
        >
          New API key
        </Button>
      }
    >
      <QueryView query={keys}>
        {(rows) => {
          const active = rows.filter((k) => !k.revokedAt);
          return active.length === 0 ? (
            <EmptyState
              size="sm"
              icon={<KeyRound strokeWidth={1.5} />}
              title="No API keys"
              description="Create a key to run workflows from code, CI or another service."
            />
          ) : (
            <ul
              className="flex flex-col divide-y divide-border rounded-md border border-border"
              role="list"
            >
              {active.map((k) => {
                const left = daysUntil(k.expiresAt);
                return (
                  <li key={k.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-sm text-ink">
                        <span className="truncate font-medium">{k.name}</span>
                        <code className="font-mono text-2xs text-ink-3">{k.prefix}…</code>
                        {k.serviceAccount ? <Badge tone="info">Service account</Badge> : null}
                        {envName(k.environmentId) ? (
                          <Badge>{envName(k.environmentId)}</Badge>
                        ) : null}
                        {k.workflowIds ? (
                          <Badge tone="outline">
                            {k.workflowIds.length} workflow{k.workflowIds.length === 1 ? "" : "s"}
                          </Badge>
                        ) : null}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-2xs text-ink-3">
                        <ScopeChips scopes={k.scopes} max={4} />
                        <span>·</span>
                        <span>
                          {k.lastUsedAt ? (
                            <>
                              used <RelativeTime date={k.lastUsedAt} />
                            </>
                          ) : (
                            "never used"
                          )}
                        </span>
                        <span>·</span>
                        <span className={left < 14 ? "text-warn-text" : undefined}>
                          {left < 0 ? "expired" : `expires in ${left} days`}
                        </span>
                      </div>
                    </div>
                    <IconButton
                      size="sm"
                      variant="ghost"
                      label={`Rotate ${k.name}`}
                      onClick={() => setRotating(k)}
                    >
                      <RotateCw strokeWidth={1.75} />
                    </IconButton>
                    <IconButton
                      size="sm"
                      variant="ghost"
                      label={`Revoke ${k.name}`}
                      onClick={() => revoke.ask(k)}
                    >
                      <Trash2 strokeWidth={1.75} />
                    </IconButton>
                  </li>
                );
              })}
            </ul>
          );
        }}
      </QueryView>
      <CreateKeyDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(k, d) =>
          setSecret({
            title: `${d.name.trim()} created`,
            key: k.key,
            environmentId: d.env === ANY_ENVIRONMENT ? null : d.env,
          })
        }
      />
      <OneTimeSecretDialog
        secret={secret?.key ?? null}
        title={secret?.title ?? ""}
        onClose={() => setSecret(null)}
        extra={
          secret ? <KeyExample apiKey={secret.key} environmentId={secret.environmentId} /> : null
        }
      />
      <ConfirmDialog
        open={rotating !== null}
        onOpenChange={(o) => (o ? undefined : setRotating(null))}
        title={`Rotate ${rotating?.name ?? "key"}?`}
        description="A new key is issued with the same scopes and pins. The old key keeps working during the grace period, then stops."
        confirmLabel="Rotate"
        loading={rotate.isPending}
        onConfirm={() => {
          if (rotating) rotate.mutate(rotating);
        }}
      >
        <FieldRow label="Grace period" htmlFor="rot-grace">
          <Select id="rot-grace" value={grace} onValueChange={setGrace}>
            <SelectItem value="0">None (revoke now)</SelectItem>
            <SelectItem value="15">15 minutes</SelectItem>
            <SelectItem value="60">1 hour</SelectItem>
            <SelectItem value="1440">24 hours</SelectItem>
          </Select>
        </FieldRow>
      </ConfirmDialog>
      <ConfirmDialog
        open={revoke.target !== null}
        onOpenChange={(o) => (o ? undefined : revoke.close())}
        title={`Revoke ${revoke.target?.name ?? "key"}?`}
        description="Requests with this key fail immediately. This cannot be undone."
        variant="danger"
        confirmLabel="Revoke"
        loading={remove.isPending}
        onConfirm={() => {
          if (revoke.target) remove.mutate(revoke.target);
        }}
      />
    </Section>
  );
}

/**
 * How to use a fresh key: start a deployed workflow's run from a script. A key that is not
 * limited to an environment must name one in the request (the API refuses it otherwise).
 */
function KeyExample({ apiKey, environmentId }: { apiKey: string; environmentId: string | null }) {
  const s = useSession();
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const fallback = s.environments.find((e) => e.name === "dev") ?? s.environments[0];
  const body = environmentId
    ? `{"input": {"message": "Hello"}, "mode": "sync"}`
    : `{"input": {"message": "Hello"}, "mode": "sync", "environmentId": "${fallback?.id ?? "<environment id>"}"}`;
  const example = [
    `curl -X POST ${origin}/v1/workflows/<workflow id>/run \\`,
    `  -H "Authorization: Bearer ${apiKey}" \\`,
    "  -H 'content-type: application/json' \\",
    `  -d '${body}'`,
  ].join("\n");
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs text-ink-2">
        Start a run of the version deployed to{" "}
        {environmentId
          ? "the key's environment"
          : `${fallback?.name ?? "an environment"} (change environmentId to call another)`}
        . The workflow id is in the workflow&apos;s address:
      </p>
      <div className="flex items-start gap-2">
        <pre className="min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-surface-2 p-2 font-mono text-2xs text-ink">
          {example}
        </pre>
        <CopyButton value={example} label="Copy example request" size="sm" />
      </div>
      <p className="text-xs text-ink-3">
        The same key works with the SDK and the <code className="font-mono">flowaid</code> CLI (
        <code className="font-mono">FLOWAID_API_KEY</code>). Nothing has run yet: the request above
        starts a run only when you send it, and fails until a version is deployed to that
        environment. <LearnMore href={HELP.callIt} label="Calling a workflow" />
      </p>
    </div>
  );
}
