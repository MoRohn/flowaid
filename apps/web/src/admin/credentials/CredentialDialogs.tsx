"use client";
/**
 * Create, rotate and inspect credentials. Secret values are write-only: the API seals them and
 * only ever returns masked hints, so these forms never pre-fill a secret.
 */
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";
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
import { get, patch, post, qs } from "~/api/client";
import type { Environment } from "~/api/types";
import { useSession } from "~/session";
import type { Credential, CredentialField, CredentialType, SecretUse } from "../types";
import { Notice, useMutate } from "../ui";
import { credentialGuide } from "./guide";

const ALL_ENVIRONMENTS = "__all";

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
  const [typeId, setTypeId] = useState(defaultType ?? types[0]?.id ?? "");
  const [name, setName] = useState("");
  const [storage, setStorage] = useState<"db" | "external">("db");
  const [externalRef, setExternalRef] = useState("");
  const [env, setEnv] = useState(ALL_ENVIRONMENTS);
  const [values, setValues] = useState<Record<string, string>>({});
  const [testAfter, setTestAfter] = useState(true);
  // after saving: the credential, and the connection test when one ran
  const [saved, setSaved] = useState<{
    credential: Credential;
    test: { ok: boolean; message?: string } | null;
  } | null>(null);
  const type = types.find((t) => t.id === typeId);
  const guide = credentialGuide(typeId);
  const canTest = Boolean(type?.testSupported) && storage === "db";
  const reset = () => {
    setName("");
    setValues({});
    setExternalRef("");
    setSaved(null);
  };
  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) reset();
  };
  const create = useMutate(
    async (body: Record<string, unknown>) => {
      const credential = await post<Credential>("/v1/credentials", body);
      const test =
        canTest && testAfter
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
      // the dialog's result step says it; no toast on top
      invalidate: [["credentials", s.ws]],
      onSuccess: (r) => setSaved(r),
    },
  );
  const missing =
    storage === "db" && type
      ? type.fields.filter((f) => f.required && !values[f.name]?.trim()).map((f) => f.name)
      : [];

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!type) return;
    const clean = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== ""));
    create.mutate({
      name: name.trim(),
      type: type.id,
      storage,
      ...(storage === "db" ? { values: clean } : { externalRef: externalRef.trim() }),
      environmentId: env === ALL_ENVIRONMENTS ? null : env,
    });
  }

  if (saved)
    return (
      <Dialog open={open} onOpenChange={close}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>{saved.credential.name} is saved</DialogTitle>
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
              <p className="font-medium text-ink">Next: use it in a workflow</p>
              <p>
                Nodes read credentials through named secrets (for example{" "}
                <code className="font-mono text-xs">TYPESAFE_API_KEY</code>). Open a workflow&apos;s{" "}
                <span className="font-medium text-ink">Settings → Secrets</span> and bind the secret
                to this credential for each environment.
              </p>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={reset}>
              Add another
            </Button>
            <Button type="button" variant="primary" onClick={() => close(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent size="md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>New credential</DialogTitle>
            <DialogDescription>
              Values are encrypted with a per-credential key and never shown again.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <FieldRow label="Type" htmlFor="cred-type" required>
              <Select
                id="cred-type"
                value={typeId}
                onValueChange={(v) => {
                  setTypeId(v);
                  setValues({});
                }}
              >
                {types.map((t) => (
                  <SelectItem key={t.id} value={t.id} description={t.description}>
                    {t.name}
                  </SelectItem>
                ))}
              </Select>
            </FieldRow>
            {guide.use || guide.where ? (
              <p className="-mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
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
            <FieldRow
              label="Name"
              htmlFor="cred-name"
              required
              hint="How workflows and people refer to it"
            >
              <Input
                id="cred-name"
                value={name}
                maxLength={100}
                placeholder={type ? `${type.name} (production)` : ""}
                onChange={(e) => setName(e.target.value)}
              />
            </FieldRow>
            <FieldRow label="Storage">
              <RadioGroup
                value={storage}
                onValueChange={(v) => setStorage(v as "db" | "external")}
                orientation="horizontal"
                aria-label="Storage"
              >
                <RadioItem value="db" label="Encrypted in FlowAId" />
                <RadioItem value="external" label="External secret manager" />
              </RadioGroup>
            </FieldRow>
            {storage === "external" ? (
              <FieldRow
                label="External reference"
                htmlFor="cred-ref"
                required
                hint="For example vault://secret/data/openai#apiKey or aws-sm://prod/openai"
              >
                <Input
                  id="cred-ref"
                  className="font-mono"
                  value={externalRef}
                  onChange={(e) => setExternalRef(e.target.value)}
                />
              </FieldRow>
            ) : type ? (
              <FieldInputs type={type} values={values} onChange={setValues} />
            ) : null}
            <FieldRow
              label="Environment"
              htmlFor="cred-env"
              hint="Limit the credential to one environment, or allow every environment"
            >
              <Select id="cred-env" value={env} onValueChange={setEnv}>
                <SelectItem value={ALL_ENVIRONMENTS}>All environments</SelectItem>
                {environments.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}
                  </SelectItem>
                ))}
              </Select>
            </FieldRow>
            {canTest ? (
              <label className="flex items-center gap-2 text-sm text-ink">
                <Checkbox checked={testAfter} onCheckedChange={(v) => setTestAfter(v === true)} />
                Test the connection after saving
              </label>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={create.isPending}
              disabled={
                !type ||
                !name.trim() ||
                missing.length > 0 ||
                (storage === "external" && !externalRef.trim())
              }
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
  const rotate = useMutate(
    (v: { id: string; values: Record<string, string> }) =>
      post<Credential>(`/v1/credentials/${v.id}/rotate`, { values: v.values }),
    {
      success: (c) => `Rotated ${c.name}; runs use the new value from now on`,
      invalidate: [["credentials", s.ws]],
      onSuccess: () => {
        setValues({});
        onClose();
      },
    },
  );
  const secretFields = type?.fields.filter((f) => f.secret) ?? [];
  const complete = secretFields.filter((f) => f.required).every((f) => values[f.name]?.trim());
  return (
    <Dialog open={credential !== null} onOpenChange={(o) => (o ? undefined : onClose())}>
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
            <Button type="button" variant="ghost" onClick={onClose}>
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
  const used = useQuery({
    queryKey: ["where-used", s.ws, credential?.id],
    queryFn: () =>
      get<SecretUse[]>(`/v1/secrets/where-used${qs({ credentialId: credential?.id })}`),
    enabled: credential !== null,
  });
  const workflows = useQuery({
    queryKey: ["workflow-names", s.ws],
    queryFn: () => get<{ items: { id: string; name: string }[] }>("/v1/workflows?limit=200"),
    enabled: credential !== null && (used.data?.length ?? 0) > 0,
  });
  const names = useMemo(
    () => new Map((workflows.data?.items ?? []).map((w) => [w.id, w.name])),
    [workflows.data],
  );
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
            ) : (used.data ?? []).length === 0 ? (
              <p className="text-xs text-ink-3">
                No workflow uses it yet. Bind it in a workflow&apos;s Settings → Secrets.
              </p>
            ) : (
              <ul className="flex flex-col gap-1" role="list">
                {(used.data ?? []).map((u) => (
                  <li
                    key={`${u.workflowId}:${u.environmentId}:${u.secretName}`}
                    className="flex items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs"
                  >
                    <a
                      className="truncate text-accent-text hover:underline"
                      href={`/${s.ws}/workflows/${u.workflowId}/settings`}
                    >
                      {names.get(u.workflowId) ?? u.workflowId}
                    </a>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <Badge tone="outline" mono size="sm">
                        {u.secretName}
                      </Badge>
                      <Badge size="sm">{envName(u.environmentId)}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
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
