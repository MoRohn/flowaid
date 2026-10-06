"use client";
/**
 * Create, rotate and inspect credentials. Secret values are write-only: the API seals them and
 * only ever returns masked hints, so these forms never pre-fill a secret. A new credential is
 * built step by step (service, secret, where it may be used, review); its draft is kept in this
 * browser tab without the secret values.
 */
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { CheckCircle2, ExternalLink, Plug, XCircle } from "lucide-react";
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldRow,
  Input,
  RadioGroup,
  RadioItem,
  Select,
  SelectItem,
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@flowaid/ui/primitives";
import { KeyValueList } from "@flowaid/ui/inspector";
import { RelativeTime } from "@flowaid/ui/data";
import { ApiError, del, get, getAll, patch, post } from "~/api/client";
import type { Environment } from "~/api/types";
import { suggestSecretName } from "~/builder/keySources";
import { DraftStatus, GuidedFlow, type FlowStep } from "~/guide/GuidedFlow";
import { CheckList, type Check } from "~/guide/Readiness";
import { useKeptDraft } from "~/guide/useKeptDraft";
import { useSession } from "~/session";
import { providerName } from "../providerNames";
import { errorMessage } from "~/shell/states";
import type {
  Credential,
  CredentialField,
  CredentialType,
  CredentialUse,
  Provider,
} from "../types";
import { Notice, useMutate } from "../ui";
import { credentialGuide } from "./guide";
import {
  ALL_ENVIRONMENTS,
  SERVICE_GROUP_LABEL,
  UNBIND_EFFECTS,
  credentialBody,
  credentialChecks,
  describeUse,
  emptyCredentialDraft,
  externalRefProblem,
  keptDraft,
  serverKeyProvider,
  serviceGroup,
  type CredentialDraft,
} from "./logic";

const ACRONYMS: Record<string, string> = {
  api: "API",
  url: "URL",
  id: "ID",
  oauth: "OAuth",
  mcp: "MCP",
};

/** `apiKey` → "API key", `baseUrl` → "Base URL". */
export function fieldLabel(f: Pick<CredentialField, "name">): string {
  const words = f.name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((w) => ACRONYMS[w] ?? w);
  const [first = "", ...rest] = words;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(" ");
}

/** One input per credential-type field; secrets are password inputs and never pre-filled. */
function FieldInputs({
  type,
  values,
  onChange,
  onlySecrets,
  hints,
}: {
  type: CredentialType;
  values: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  onlySecrets?: boolean;
  hints?: Record<string, string>;
}) {
  const fields = onlySecrets ? type.fields.filter((f) => f.secret) : type.fields;
  return (
    <>
      {fields.map((f) => (
        <FieldRow
          key={f.name}
          label={fieldLabel(f)}
          htmlFor={`cred-${f.name}`}
          required={f.required && !onlySecrets}
          optional={!f.required}
          hint={
            hints?.[f.name]
              ? `Current: ${hints[f.name]}`
              : (credentialGuide(type.id).fields?.[f.name] ??
                (typeof f.schema.description === "string"
                  ? f.schema.description
                  : f.schema.format === "uri"
                    ? "A full URL, starting with https://"
                    : undefined))
          }
        >
          {f.schema.enum ? (
            <Select
              id={`cred-${f.name}`}
              value={values[f.name] ?? ""}
              onValueChange={(v) => onChange({ ...values, [f.name]: v })}
            >
              {f.schema.enum.map((o) => (
                <SelectItem key={o} value={o}>
                  {o}
                </SelectItem>
              ))}
            </Select>
          ) : (
            <Input
              id={`cred-${f.name}`}
              type={f.secret ? "password" : f.schema.format === "uri" ? "url" : "text"}
              autoComplete={f.secret ? "new-password" : "off"}
              spellCheck={false}
              className={f.secret ? "font-mono" : undefined}
              value={values[f.name] ?? ""}
              onChange={(e) => onChange({ ...values, [f.name]: e.target.value })}
            />
          )}
        </FieldRow>
      ))}
    </>
  );
}

export function CreateCredentialDialog({
  open,
  onOpenChange,
  types,
  environments,
  defaultType,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  types: CredentialType[];
  environments: Environment[];
  defaultType?: string;
}) {
  const s = useSession();
  // kept in this browser tab until created, without the secret values (they stay in memory only)
  const kept = useKeptDraft<CredentialDraft>(
    `flowaid:draft:${s.ws}:credential`,
    () => emptyCredentialDraft(defaultType ?? ""),
    (d) => keptDraft(d, types),
  );
  const { draft, setDraft } = kept;
  // after saving: the credential, and the connection test when one ran
  const [saved, setSaved] = useState<{
    credential: Credential;
    test: { ok: boolean; message?: string } | null;
  } | null>(null);
  const providers = useQuery({
    queryKey: ["providers", s.ws],
    queryFn: () => get<Provider[]>("/v1/providers"),
    staleTime: 60_000,
    enabled: open,
  });
  const existing = useQuery({
    queryKey: ["credentials", s.ws],
    queryFn: () => getAll<Credential>("/v1/credentials"),
    enabled: open,
  });
  const workflows = useQuery({
    queryKey: ["workflow-names", s.ws],
    queryFn: () => get<{ items: { id: string; name: string }[] }>("/v1/workflows?limit=200"),
    enabled: open,
  });
  const type = types.find((t) => t.id === draft.typeId);
  const guide = credentialGuide(draft.typeId);
  const serverHasKey = (p: string) =>
    (providers.data ?? []).some((x) => x.id === p && x.configuredOnServer);
  const canUseExternal = s.can("admin");
  const canTest = Boolean(type?.testSupported) && draft.storage === "db";
  const set = <K extends keyof CredentialDraft>(k: K, v: CredentialDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));
  const envName = (id: string) => environments.find((e) => e.id === id)?.name ?? id;
  const checks = credentialChecks(draft, {
    type,
    serverHasKey,
    existingNames: (existing.data ?? []).map((c) => c.name),
    envName,
    canUseExternal,
  });
  const blocking = checks.filter((c) => c.state === "blocker");
  const nameProblem = blocking.find((c) => c.id === "name");
  const blockedAt = (step: string) => blocking.some((c) => c.step === step);
  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) setSaved(null);
  };
  const create = useMutate(
    async (body: Record<string, unknown>) => {
      const credential = await post<Credential>("/v1/credentials", body);
      const test =
        canTest && draft.testAfter
          ? await post<{ ok: boolean; message?: string }>(
              `/v1/credentials/${credential.id}/test`,
            ).catch((e: unknown) => ({
              ok: false,
              message: e instanceof Error ? e.message : "The test could not run.",
            }))
          : null;
      return { credential, test };
    },
    {
      // the dialog's result step says it; no toast on top. A failed create keeps everything typed.
      invalidate: [["credentials", s.ws]],
      onSuccess: (r) => {
        kept.discard();
        setSaved(r);
      },
      errorTitle: "Could not create the credential",
    },
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!type || blocking.length) return;
    create.mutate(credentialBody(draft));
  }

  if (saved)
    return (
      <Dialog open={open} onOpenChange={close}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 strokeWidth={1.75} className="size-4 text-ok-text" aria-hidden />
              {saved.credential.name} is saved
            </DialogTitle>
            <DialogDescription>
              The secret is encrypted; FlowAId shows only a masked hint from now on.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            {saved.test ? (
              <p
                role="status"
                className={
                  "flex items-center gap-1.5 text-sm " +
                  (saved.test.ok ? "text-ok-text" : "text-danger-text")
                }
              >
                {saved.test.ok ? (
                  <CheckCircle2 strokeWidth={1.75} className="size-4" aria-hidden="true" />
                ) : (
                  <XCircle strokeWidth={1.75} className="size-4" aria-hidden="true" />
                )}
                {saved.test.ok
                  ? "Connection test passed: the provider accepted it."
                  : `Connection test failed: ${saved.test.message ?? "the provider refused it"}. Check the value and rotate it from the credential's details.`}
              </p>
            ) : null}
            <div className="flex flex-col gap-1.5 text-sm text-ink-2">
              <p className="m-0 font-medium text-ink">Next: use it in a workflow</p>
              <ol className="m-0 flex list-decimal flex-col gap-1.5 pl-5">
                <li>
                  Open a workflow and select a step that needs this service. Its Config tab lists
                  the step&apos;s credential slots: bind the slot to a secret (for example{" "}
                  <code className="font-mono text-xs">
                    {suggestSecretName(saved.credential.type, [])}
                  </code>
                  ), or add the secret there.
                </li>
                <li>
                  In the workflow&apos;s{" "}
                  <span className="font-medium text-ink">Settings → Secrets</span>, bind that secret
                  to {saved.credential.name} for each environment it should work in
                  {saved.credential.environmentId
                    ? ` (only ${envName(saved.credential.environmentId)} can use it)`
                    : ""}
                  .
                </li>
                <li>Press Run draft in the builder to try it; draft runs use dev.</li>
              </ol>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setSaved(null)}>
              Add another
            </Button>
            <Button asChild variant="secondary">
              <Link href={`/${s.ws}/workflows`}>Open a workflow</Link>
            </Button>
            <Button type="button" variant="primary" onClick={() => close(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );

  const groups = (["models", "tools", "http"] as const)
    .map((g) => ({ g, items: types.filter((t) => serviceGroup(t.id) === g) }))
    .filter((x) => x.items.length > 0);
  const savedCount = (id: string) => (existing.data ?? []).filter((c) => c.type === id).length;
  const provider = type ? serverKeyProvider(type.id) : undefined;

  const steps: FlowStep[] = [
    {
      id: "service",
      title: "Choose the service",
      why: "Pick what the key is for. The type decides which fields you fill in and whether FlowAId can test it; a step asks for a credential of one type.",
      done: type !== undefined,
      requirement: "choose the service",
      example:
        "For decision steps choose TypeSafe API key; for Generate and Agent steps, the key of the model provider you use. For an API with no type of its own, choose Bearer token or API key under “Any HTTP API”.",
      children: (
        <>
          <RadioGroup
            value={draft.typeId}
            onValueChange={(v) => setDraft((d) => ({ ...d, typeId: v, values: {} }))}
            aria-label="Service"
            className="max-h-72 gap-3 overflow-auto rounded-sm border border-border p-3"
          >
            {groups.map(({ g, items }) => (
              <div key={g} className="flex flex-col gap-2">
                <p className="text-eyebrow m-0">{SERVICE_GROUP_LABEL[g]}</p>
                {items.map((t) => {
                  const p = serverKeyProvider(t.id);
                  const n = savedCount(t.id);
                  return (
                    <RadioItem
                      key={t.id}
                      value={t.id}
                      label={t.name}
                      description={t.description}
                      meta={
                        n > 0 ? `${n} saved` : p && serverHasKey(p) ? "server key set" : undefined
                      }
                    />
                  );
                })}
              </div>
            ))}
          </RadioGroup>
          {guide.use || guide.where ? (
            <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
              {guide.use ? <span>{guide.use}</span> : null}
              {guide.where ? (
                <a
                  className="inline-flex items-center gap-1 text-accent-text hover:underline"
                  href={guide.where.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Get a key: {guide.where.label}
                  <ExternalLink strokeWidth={1.75} className="size-3" aria-hidden="true" />
                </a>
              ) : null}
            </p>
          ) : null}
          {provider && serverHasKey(provider) ? (
            <Notice tone="info">
              The server already has its own {providerName(provider)} key (set in its environment,
              such as .env.local). Steps whose secret is optional use it without a credential. Add
              one here to use a different key, a key per environment, or for a secret a workflow
              marks as required.
            </Notice>
          ) : null}
        </>
      ),
    },
    {
      id: "secret",
      title: "Enter the secret",
      why: "Name it after what it is for and where it is used, then paste the values from the service. Secret fields are encrypted as soon as you create the credential and are never shown again; they are not kept if you close this dialog.",
      done: type !== undefined && !blockedAt("secret"),
      requirement: "fill in the fields marked as required",
      example: (
        <>
          Names like <strong className="font-medium text-ink">OpenAI (prod)</strong> or{" "}
          <strong className="font-medium text-ink">GitHub read-only</strong> say what it is and
          where it belongs, which matters once you have several.
        </>
      ),
      children: type ? (
        <>
          <FieldRow
            label="Name"
            htmlFor="cred-name"
            required
            hint="How workflows and people refer to it"
            error={draft.name.trim() ? nameProblem?.message : undefined}
          >
            <Input
              id="cred-name"
              value={draft.name}
              maxLength={100}
              placeholder={`${type.name} (production)`}
              onChange={(e) => set("name", e.target.value)}
            />
          </FieldRow>
          <FieldRow
            label="Storage"
            hint={
              canUseExternal
                ? "Encrypted in FlowAId suits most keys. Choose an external secret manager when your team keeps keys in Vault, AWS, Azure or Google Cloud; FlowAId then reads the value when a run needs it."
                : "Only admins can point at an external secret manager."
            }
          >
            <RadioGroup
              value={draft.storage}
              onValueChange={(v) => set("storage", v as "db" | "external")}
              orientation="horizontal"
              aria-label="Storage"
            >
              <RadioItem value="db" label="Encrypted in FlowAId" />
              <RadioItem
                value="external"
                label="External secret manager"
                disabled={!canUseExternal}
              />
            </RadioGroup>
          </FieldRow>
          {draft.storage === "external" ? (
            <FieldRow
              label="External reference"
              htmlFor="cred-ref"
              required
              hint="For example vault:secret/data/openai#apiKey, env:FLOWAID_SECRET_OPENAI or aws-sm:arn:aws:secretsmanager:<region>:<account>:secret:<name>"
              error={draft.externalRef.trim() ? externalRefProblem(draft.externalRef) : undefined}
            >
              <Input
                id="cred-ref"
                className="font-mono"
                value={draft.externalRef}
                onChange={(e) => set("externalRef", e.target.value)}
              />
            </FieldRow>
          ) : (
            <FieldInputs type={type} values={draft.values} onChange={(v) => set("values", v)} />
          )}
        </>
      ) : (
        <p className="m-0 text-sm text-ink-3">Choose the service first.</p>
      ),
    },
    {
      id: "scope",
      title: "Choose where it may be used",
      why: "By default every environment and every workflow may bind it. Narrow it for keys that must not leak into tests, such as a production key: a binding outside these limits never resolves, and the run fails with “secret not bound”.",
      done: !blockedAt("scope"),
      requirement: "choose at least one workflow",
      example:
        "One key for everything is simplest. Separate keys for dev and prod let you try changes against a test account and rotate one without touching the other.",
      children: (
        <>
          <FieldRow
            label="Environment"
            htmlFor="cred-env"
            hint="Limit the credential to one environment, or allow every environment"
          >
            <Select id="cred-env" value={draft.env} onValueChange={(v) => set("env", v)}>
              <SelectItem value={ALL_ENVIRONMENTS}>All environments</SelectItem>
              {environments.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.name}
                </SelectItem>
              ))}
            </Select>
          </FieldRow>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-xs font-medium text-ink">Workflows</legend>
            <RadioGroup
              value={draft.allowedWorkflowIds === null ? "all" : "some"}
              onValueChange={(v) => set("allowedWorkflowIds", v === "all" ? null : [])}
              orientation="horizontal"
              aria-label="Workflows that may use it"
            >
              <RadioItem value="all" label="Every workflow" />
              <RadioItem value="some" label="Only the workflows I choose" />
            </RadioGroup>
            {draft.allowedWorkflowIds !== null ? (
              <div className="flex max-h-40 flex-col gap-1 overflow-auto rounded-sm border border-border p-2">
                {workflows.isPending ? (
                  <p className="m-0 text-xs text-ink-3">Loading workflows…</p>
                ) : (workflows.data?.items ?? []).length === 0 ? (
                  <p className="m-0 text-xs text-ink-3">
                    No workflows yet. Allow every workflow, or create the workflow first and limit
                    the credential from its details later.
                  </p>
                ) : (
                  (workflows.data?.items ?? []).map((w) => (
                    <Checkbox
                      key={w.id}
                      size="sm"
                      label={w.name}
                      checked={draft.allowedWorkflowIds?.includes(w.id) ?? false}
                      onCheckedChange={(c) =>
                        set(
                          "allowedWorkflowIds",
                          c === true
                            ? [...(draft.allowedWorkflowIds ?? []), w.id]
                            : (draft.allowedWorkflowIds ?? []).filter((x) => x !== w.id),
                        )
                      }
                    />
                  ))
                )}
              </div>
            ) : null}
          </fieldset>
        </>
      ),
    },
    {
      id: "review",
      doneLabel: "Ready to create",
      title: "Review and create",
      why: "Check the details. Creating it encrypts the secret and saves the credential; no workflow uses it until one binds it.",
      done: blocking.length === 0,
      requirement: "fix the items marked as needed",
      children: (
        <>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-sm border border-border px-3 py-2 text-sm">
            <dt className="text-ink-3">Service</dt>
            <dd className="m-0 text-ink">{type?.name ?? "—"}</dd>
            <dt className="text-ink-3">Name</dt>
            <dd className="m-0 text-ink">{draft.name.trim() || "—"}</dd>
            <dt className="text-ink-3">Stored</dt>
            <dd className="m-0 text-ink">
              {draft.storage === "external" ? (
                <span className="font-mono text-xs break-all">{draft.externalRef || "—"}</span>
              ) : (
                "Encrypted in FlowAId"
              )}
            </dd>
            <dt className="text-ink-3">Environments</dt>
            <dd className="m-0 text-ink">
              {draft.env === ALL_ENVIRONMENTS ? "All" : envName(draft.env)}
            </dd>
            <dt className="text-ink-3">Workflows</dt>
            <dd className="m-0 text-ink">
              {draft.allowedWorkflowIds === null
                ? "All"
                : `${draft.allowedWorkflowIds.length} chosen`}
            </dd>
          </dl>
          <CheckList
            checks={checks.map((c): Check => ({ id: c.id, label: c.message, state: c.state }))}
            aria-label="Before you create"
          />
          {canTest ? (
            <Checkbox
              checked={draft.testAfter}
              onCheckedChange={(v) => set("testAfter", v === true)}
              label="Test the connection after creating it"
              description="Sends one request to the service with this key; nothing else runs."
            />
          ) : null}
        </>
      ),
    },
  ];

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent size="lg">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>New credential</DialogTitle>
            <DialogDescription>
              Values are encrypted with a per-credential key and never shown again.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <GuidedFlow
              steps={steps}
              initialStep={defaultType ? 1 : 0}
              status={
                <DraftStatus
                  dirty={kept.dirty}
                  restored={kept.restored}
                  onDiscard={kept.discard}
                  what="the credential"
                />
              }
            />
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => close(false)}>
              Close
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={create.isPending}
              disabled={blocking.length > 0}
            >
              Create credential
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RotateCredentialDialog({
  credential,
  type,
  onClose,
}: {
  credential: Credential | null;
  type: CredentialType | undefined;
  onClose: () => void;
}) {
  const s = useSession();
  const [values, setValues] = useState<Record<string, string>>({});
  // typed secrets belong to one opening for one credential: a new target starts empty
  const [forId, setForId] = useState(credential?.id ?? null);
  if ((credential?.id ?? null) !== forId) {
    setForId(credential?.id ?? null);
    setValues({});
  }
  const close = () => {
    setValues({});
    onClose();
  };
  const rotate = useMutate(
    (v: { id: string; values: Record<string, string> }) =>
      post<Credential>(`/v1/credentials/${v.id}/rotate`, { values: v.values }),
    {
      success: (c) => `Rotated ${c.name}; runs use the new value from now on`,
      invalidate: [["credentials", s.ws]],
      onSuccess: close,
      errorTitle: "Could not rotate the credential",
    },
  );
  const secretFields = type?.fields.filter((f) => f.secret) ?? [];
  const complete = secretFields.filter((f) => f.required).every((f) => values[f.name]?.trim());
  return (
    <Dialog open={credential !== null} onOpenChange={(o) => (o ? undefined : close())}>
      <DialogContent size="sm">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (credential) rotate.mutate({ id: credential.id, values });
          }}
        >
          <DialogHeader>
            <DialogTitle>Rotate {credential?.name}</DialogTitle>
            <DialogDescription>
              Enter the new secret values. Runs that already started keep the old value.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            {credential?.storage === "external" ? (
              <Notice tone="info">
                This credential lives in an external secret manager: rotate it there.
              </Notice>
            ) : type ? (
              <FieldInputs
                type={type}
                values={values}
                onChange={setValues}
                onlySecrets
                hints={credential?.hints ?? {}}
              />
            ) : (
              <Notice>
                The credential type {credential?.type} is not installed on this server.
              </Notice>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={rotate.isPending}
              disabled={credential?.storage === "external" || !type || !complete}
            >
              Rotate
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Details: public fields, masked hints, test, rename, environment and where the credential is bound. */
export function CredentialSheet({
  credential,
  type,
  environments,
  onClose,
  onRotate,
}: {
  credential: Credential | null;
  type: CredentialType | undefined;
  environments: Environment[];
  onClose: () => void;
  onRotate: (c: Credential) => void;
}) {
  const s = useSession();
  const canWrite = s.can("credentials:write");
  const [name, setName] = useState<string | null>(null);
  const [test, setTest] = useState<{ ok: boolean; message?: string } | null>(null);
  const used = useCredentialUses(credential?.id ?? null);
  const envName = (id: string | null) =>
    id ? (environments.find((e) => e.id === id)?.name ?? id) : "All environments";
  const runTest = useMutate(
    (id: string) => post<{ ok: boolean; message?: string }>(`/v1/credentials/${id}/test`),
    {
      onSuccess: (r) => setTest(r),
      invalidate: [["credentials", s.ws]],
    },
  );
  const rename = useMutate(
    (v: { id: string; name: string }) =>
      patch<Credential>(`/v1/credentials/${v.id}`, { name: v.name }),
    { success: "Renamed", invalidate: [["credentials", s.ws]], onSuccess: () => setName(null) },
  );

  const rows = credential
    ? [
        { label: "Type", value: <span className="font-mono">{credential.type}</span> },
        {
          label: "Storage",
          value:
            credential.storage === "external" ? (
              <span className="font-mono break-all">{credential.externalRef}</span>
            ) : (
              "Encrypted in FlowAId"
            ),
        },
        { label: "Environment", value: envName(credential.environmentId) },
        {
          label: "Workflows",
          value:
            credential.allowedWorkflowIds === null
              ? "Any workflow may bind it"
              : `Only ${credential.allowedWorkflowIds.length} chosen workflow${credential.allowedWorkflowIds.length === 1 ? "" : "s"}`,
        },
        ...Object.entries(credential.publicFields).map(([k, v]) => ({
          id: `public:${k}`,
          label: k,
          value: v,
          mono: true,
        })),
        ...Object.entries(credential.hints).map(([k, v]) => ({
          id: `hint:${k}`,
          label: k,
          value: v,
          mono: true,
          copyValue: "",
        })),
        {
          label: "Last tested",
          value: credential.lastTestedAt ? (
            <span className="flex items-center gap-1.5">
              <Badge tone={credential.lastTestOk ? "ok" : "danger"} dot>
                {credential.lastTestOk ? "OK" : "Failed"}
              </Badge>
              <RelativeTime date={credential.lastTestedAt} />
            </span>
          ) : (
            "Never"
          ),
        },
        {
          label: "Last used",
          value: credential.lastUsedAt ? <RelativeTime date={credential.lastUsedAt} /> : "Never",
        },
        {
          label: "Rotated",
          value: credential.rotatedAt ? <RelativeTime date={credential.rotatedAt} /> : "Never",
        },
        { label: "Created", value: <RelativeTime date={credential.createdAt} /> },
      ]
    : [];

  return (
    <Sheet
      open={credential !== null}
      onOpenChange={(o) => {
        if (!o) {
          setTest(null);
          setName(null);
          onClose();
        }
      }}
    >
      <SheetContent
        width={440}
        // opening the details is not editing them: focus the panel, not the Name field
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement | null)?.focus();
        }}
      >
        <SheetHeader>
          <SheetTitle>{credential?.name}</SheetTitle>
          <SheetDescription>{type?.name ?? credential?.type}</SheetDescription>
        </SheetHeader>
        <SheetBody className="flex flex-col gap-5">
          {canWrite ? (
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (credential && name?.trim())
                  rename.mutate({ id: credential.id, name: name.trim() });
              }}
            >
              <FieldRow label="Name" htmlFor="cred-rename" className="flex-1">
                <Input
                  id="cred-rename"
                  value={name ?? credential?.name ?? ""}
                  maxLength={100}
                  onChange={(e) => setName(e.target.value)}
                />
              </FieldRow>
              <Button
                type="submit"
                disabled={name === null || !name.trim() || name === credential?.name}
                loading={rename.isPending}
              >
                Rename
              </Button>
            </form>
          ) : null}
          <KeyValueList items={rows} />
          {type?.testSupported && canWrite ? (
            <div className="flex flex-col gap-2">
              <Button
                leadingIcon={<Plug strokeWidth={1.75} />}
                loading={runTest.isPending}
                onClick={() => credential && runTest.mutate(credential.id)}
                className="self-start"
              >
                Test connection
              </Button>
              {test ? (
                <p
                  role="status"
                  className={
                    "flex items-center gap-1.5 text-xs " +
                    (test.ok ? "text-ok-text" : "text-danger-text")
                  }
                >
                  {test.ok ? (
                    <CheckCircle2 strokeWidth={1.75} className="size-3.5" aria-hidden="true" />
                  ) : (
                    <XCircle strokeWidth={1.75} className="size-3.5" aria-hidden="true" />
                  )}
                  {test.ok
                    ? "The provider accepted the credential."
                    : (test.message ?? "The test failed.")}
                </p>
              ) : null}
            </div>
          ) : null}
          <div>
            <h3 className="mb-2 text-xs font-semibold text-ink">Where it is used</h3>
            {used.isPending ? (
              <p className="text-xs text-ink-3">Loading…</p>
            ) : used.isError ? (
              <p className="text-xs text-danger-text">
                Could not load where it is used: {errorMessage(used.error)}
              </p>
            ) : (used.data ?? []).length === 0 ? (
              <p className="text-xs text-ink-3">
                Nothing uses it yet. Bind it in a workflow&apos;s Settings → Secrets, or choose it
                for an MCP server, OpenAPI toolset or knowledge source.
              </p>
            ) : (
              <CredentialUseList uses={used.data ?? []} envName={envName} />
            )}
          </div>
        </SheetBody>
        {canWrite && credential ? (
          <SheetFooter>
            <Button
              onClick={() => onRotate(credential)}
              disabled={credential.storage === "external"}
            >
              Rotate secret
            </Button>
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/** Every use of a credential: workflow secret bindings, tools, MCP servers, sources, triggers. */
export function useCredentialUses(credentialId: string | null) {
  const s = useSession();
  return useQuery({
    queryKey: ["credential-uses", s.ws, credentialId],
    queryFn: () => get<CredentialUse[]>(`/v1/credentials/${credentialId ?? ""}/uses`),
    enabled: credentialId !== null,
  });
}

/** The uses, each linking to where it can be changed. */
export function CredentialUseList({
  uses,
  envName,
}: {
  uses: readonly CredentialUse[];
  envName: (id: string | null) => string;
}) {
  const s = useSession();
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Where it is used">
      {uses.map((u) => {
        const d = describeUse(s.ws, u);
        return (
          <li
            key={`${u.kind}:${u.id}:${u.environmentId ?? ""}:${u.secretName ?? ""}`}
            className="flex items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs"
          >
            <span className="flex min-w-0 flex-col">
              <Link className="truncate text-accent-text hover:underline" href={d.href}>
                {u.name}
              </Link>
              <span className="text-2xs text-ink-3">{d.kind}</span>
            </span>
            {u.kind === "workflow_secret" ? (
              <span className="flex shrink-0 items-center gap-1.5">
                <Badge tone="outline" mono size="sm">
                  {u.secretName}
                </Badge>
                <Badge size="sm">{envName(u.environmentId)}</Badge>
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Deleting a credential: first where it is used. Nothing uses it: a plain confirmation. Something
 * does: the uses are listed, and only an admin may unbind them and delete it anyway.
 */
export function DeleteCredentialDialog({
  credential,
  environments,
  onClose,
}: {
  credential: { id: string; name: string } | null;
  environments: Environment[];
  onClose: () => void;
}) {
  const s = useSession();
  const isAdmin = s.can("admin");
  const uses = useCredentialUses(credential?.id ?? null);
  const envName = (id: string | null) =>
    id ? (environments.find((e) => e.id === id)?.name ?? id) : "All environments";
  const remove = useMutate(
    (v: { id: string; force: boolean }) =>
      del(`/v1/credentials/${v.id}${v.force ? "?force=true" : ""}`).catch(async (e: unknown) => {
        // something started using it since the list loaded: show the current uses
        if (e instanceof ApiError && e.status === 409) await uses.refetch();
        throw e;
      }),
    {
      success: (_r, v) => (v.force ? "Credential deleted and unbound" : "Credential deleted"),
      invalidate: [
        ["credentials", s.ws],
        ["credential-uses", s.ws],
      ],
      onSuccess: () => onClose(),
      errorTitle: "Could not delete the credential",
    },
  );
  const list = uses.data ?? [];
  const inUse = list.length > 0;
  return (
    <Dialog
      open={credential !== null}
      onOpenChange={(o) => {
        if (!o && !remove.isPending) onClose();
      }}
    >
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Delete {credential?.name}?</DialogTitle>
          <DialogDescription>
            {uses.isPending
              ? "Checking where it is used…"
              : inUse
                ? `It is used in ${list.length} place${list.length === 1 ? "" : "s"}.`
                : "Nothing uses it. Deleting it can't be undone."}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          {uses.isError ? (
            <Notice tone="danger">
              Could not check where it is used: {errorMessage(uses.error)}
            </Notice>
          ) : inUse ? (
            <>
              <CredentialUseList uses={list} envName={envName} />
              {isAdmin ? (
                <Notice>
                  Give each of these another credential first, or unbind and delete it now.{" "}
                  {UNBIND_EFFECTS}
                </Notice>
              ) : (
                <Notice tone="info">
                  Give each of these another credential first; only an admin can delete a credential
                  that is still in use.
                </Notice>
              )}
            </>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={remove.isPending}>
            Cancel
          </Button>
          {uses.isSuccess && (!inUse || isAdmin) ? (
            <Button
              type="button"
              variant="danger"
              loading={remove.isPending}
              onClick={() => {
                if (credential) remove.mutate({ id: credential.id, force: inUse });
              }}
            >
              {inUse ? "Unbind and delete" : "Delete credential"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
