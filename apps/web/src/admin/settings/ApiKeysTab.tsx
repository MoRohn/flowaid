"use client";
/** API keys: create (scopes, environment and workflow pins, expiry, rate limit), rotate with grace, revoke. */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { KeyRound, Plus, RotateCw, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
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
import { del, get, post } from "~/api/client";
import type { ApiKeySummary, Page, WorkflowSummary } from "~/api/types";
import { useSession } from "~/session";
import { SCOPE_GROUPS, SCOPE_PRESETS, daysUntil } from "../logic";
import type { CreatedKey } from "../types";
import { OneTimeSecretDialog, QueryView, Section, useConfirm, useMutate } from "../ui";

const ANY = "__any";
const EXPIRY_DAYS = [30, 90, 180, 365] as const;

function CreateKeyDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (k: CreatedKey) => void;
}) {
  const s = useSession();
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"live" | "test">("live");
  const [scopes, setScopes] = useState<string[]>([...(SCOPE_PRESETS["Run workflows"] ?? [])]);
  const [env, setEnv] = useState(ANY);
  const [pinned, setPinned] = useState<string[]>([]);
  const [days, setDays] = useState<string>("90");
  const [rate, setRate] = useState<number | null>(null);
  const [serviceAccount, setServiceAccount] = useState(false);
  const workflows = useQuery({
    queryKey: ["workflow-names", s.ws],
    queryFn: () => get<Page<WorkflowSummary>>("/v1/workflows?limit=200"),
    select: (p) => p.items,
    enabled: open,
  });
  const create = useMutate(
    () =>
      post<CreatedKey>("/v1/api-keys", {
        name: name.trim(),
        scopes,
        mode,
        ...(env !== ANY ? { environmentId: env } : {}),
        ...(pinned.length ? { workflowIds: pinned } : {}),
        expiresAt: new Date(Date.now() + Number(days) * 86_400_000).toISOString(),
        ...(rate ? { rateLimitPerMin: rate } : {}),
        ...(serviceAccount ? { serviceAccount: { name: name.trim() } } : {}),
      }),
    {
      invalidate: [["api-keys", s.ws]],
      onSuccess: (k) => {
        onOpenChange(false);
        setName("");
        setPinned([]);
        onCreated(k);
      },
    },
  );
  const toggle = (scope: string, on: boolean) =>
    setScopes((xs) => (on ? [...xs, scope] : xs.filter((x) => x !== scope)));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate(undefined);
          }}
        >
          <DialogHeader>
            <DialogTitle>New API key</DialogTitle>
            <DialogDescription>
              Keys never exceed your own role's scopes. Pin keys to an environment and workflows
              whenever you can.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex max-h-[70vh] flex-col gap-4 overflow-auto">
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldRow label="Name" htmlFor="key-name" required>
                <Input
                  id="key-name"
                  value={name}
                  maxLength={100}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="ci-deploy"
                />
              </FieldRow>
              <FieldRow label="Mode" htmlFor="key-mode">
                <ToggleGroup
                  id="key-mode"
                  type="single"
                  value={mode}
                  onValueChange={(v) => v && setMode(v as "live" | "test")}
                  aria-label="Mode"
                >
                  <ToggleGroupItem value="live">Live</ToggleGroupItem>
                  <ToggleGroupItem value="test">Test</ToggleGroupItem>
                </ToggleGroup>
              </FieldRow>
            </div>
            <fieldset>
              <legend className="mb-2 flex w-full flex-wrap items-center justify-between gap-2 text-xs font-medium text-ink">
                <span>Scopes ({scopes.length})</span>
                <span className="flex gap-1">
                  {Object.entries(SCOPE_PRESETS).map(([label, set]) => (
                    <Button
                      key={label}
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setScopes([...set])}
                    >
                      {label}
                    </Button>
                  ))}
                </span>
              </legend>
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
                        checked={scopes.includes(sc)}
                        disabled={!s.can(sc)}
                        onCheckedChange={(c) => toggle(sc, c === true)}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldRow
                label="Environment"
                htmlFor="key-env"
                hint="Runs started with this key use this environment"
              >
                <Select id="key-env" value={env} onValueChange={setEnv}>
                  <SelectItem value={ANY}>Any (the request chooses)</SelectItem>
                  {s.environments.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name}
                    </SelectItem>
                  ))}
                </Select>
              </FieldRow>
              <FieldRow label="Expires" htmlFor="key-exp">
                <Select id="key-exp" value={days} onValueChange={setDays}>
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
                  value={rate}
                  min={1}
                  max={100_000}
                  unit="/min"
                  onValueChange={setRate}
                />
              </FieldRow>
              <FieldRow
                label="Service account"
                htmlFor="key-sa"
                hint="Owned by a bot identity instead of you; survives you leaving"
              >
                <Checkbox
                  id="key-sa"
                  checked={serviceAccount}
                  onCheckedChange={(c) => setServiceAccount(c === true)}
                  label="Create as a service account"
                />
              </FieldRow>
            </div>
            <fieldset>
              <legend className="mb-2 text-xs font-medium text-ink">
                Workflows ({pinned.length ? `${pinned.length} pinned` : "all"})
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
                      checked={pinned.includes(w.id)}
                      onCheckedChange={(c) =>
                        setPinned((p) => (c === true ? [...p, w.id] : p.filter((x) => x !== w.id)))
                      }
                    />
                  ))
                )}
              </div>
            </fieldset>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={create.isPending}
              disabled={!name.trim() || scopes.length === 0}
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
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<{ title: string; key: string } | null>(null);
  const [rotating, setRotating] = useState<ApiKeySummary | null>(null);
  const [grace, setGrace] = useState("60");
  const revoke = useConfirm<ApiKeySummary>();
  const keys = useQuery({
    queryKey: ["api-keys", s.ws],
    queryFn: () => get<ApiKeySummary[]>("/v1/api-keys"),
  });
  const rotate = useMutate(
    (k: ApiKeySummary) =>
      post<CreatedKey>(`/v1/api-keys/${k.id}/rotate`, { graceMinutes: Number(grace) }),
    {
      invalidate: [["api-keys", s.ws]],
      onSuccess: (c, k) => {
        setRotating(null);
        setSecret({ title: `New key for ${k.name}`, key: c.key });
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
        onCreated={(k) => setSecret({ title: "API key created", key: k.key })}
      />
      <OneTimeSecretDialog
        secret={secret?.key ?? null}
        title={secret?.title ?? ""}
        onClose={() => setSecret(null)}
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
