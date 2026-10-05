"use client";
/**
 * Live webhooks (materialised per environment on deploy): the environment-specific settings
 * (enabled, signed timestamps, idempotency header, signing secret) and the delivery log with
 * accepted, duplicate and rejected calls. The path and signature scheme belong to the workflow
 * definition and are read-only here. Rotating a secret asks first: the current one stops working.
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { History, KeyRound, Webhook } from "lucide-react";
import {
  Badge,
  Button,
  ConfirmDialog,
  CopyButton,
  Input,
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Switch,
} from "@flowaid/ui/primitives";
import { RelativeTime } from "@flowaid/ui/data";
import { get, getAll, patch, post } from "~/api/client";
import type { Page } from "~/api/types";
import { useSession } from "~/session";
import type { Webhook as WebhookRow, WebhookDelivery } from "../types";
import { Notice, OneTimeSecretDialog, QueryView, useMutate } from "../ui";
import { DELIVERY_LABEL, deliveryTone } from "./logic";
import { exampleWebhookRequest } from "./add";
import { NoTriggers } from "./AddTriggerDialog";
import { ListHelp, WEBHOOK_TERMS } from "./ListHelp";

/** The live webhooks (one workflow's, or all); shared with the Triggers page's checks. */
export function useWebhooks(workflowId?: string) {
  const s = useSession();
  return useQuery({
    queryKey: ["triggers", s.ws, workflowId ?? "*", "webhooks"],
    queryFn: () => getAll<WebhookRow>("/v1/webhooks", { workflowId }),
    enabled: s.can("webhooks:write"),
  });
}

export function WebhookList({
  workflowId,
  workflowName,
  highlight,
}: {
  /** one workflow's webhooks (workflow settings); all of them otherwise */
  workflowId?: string;
  workflowName?: (id: string) => string;
  highlight?: string | null;
}) {
  const s = useSession();
  const [secret, setSecret] = useState<{ value: string; env: string } | null>(null);
  const [log, setLog] = useState<WebhookRow | null>(null);
  // replacing a secret that callers use asks first
  const [confirmRotate, setConfirmRotate] = useState<WebhookRow | null>(null);
  const key = ["triggers", s.ws, workflowId ?? "*", "webhooks"];
  const hooks = useWebhooks(workflowId);
  const envName = (id: string) => s.environments.find((e) => e.id === id)?.name ?? id.slice(0, 8);
  const patchHook = useMutate(
    (v: { id: string; body: Record<string, unknown> }) => patch(`/v1/webhooks/${v.id}`, v.body),
    { success: "Webhook updated", invalidate: [key], errorTitle: "Could not update the webhook" },
  );
  // a switch shows its change is being saved, and can't be flipped again meanwhile
  const pending = (id: string, field: string) =>
    patchHook.isPending && patchHook.variables.id === id && field in patchHook.variables.body;
  const rotate = useMutate(
    (h: WebhookRow) => post<{ secret: string }>(`/v1/webhooks/${h.id}/rotate-secret`),
    {
      invalidate: [key],
      onSuccess: (r, h) => setSecret({ value: r.secret, env: envName(h.environmentId) }),
      errorTitle: "Could not create the signing secret",
    },
  );

  if (!s.can("webhooks:write"))
    return <Notice tone="info">You need the webhooks:write scope to manage webhooks.</Notice>;
  return (
    <>
      <QueryView query={hooks} rows={2}>
        {(rows) =>
          rows.length === 0 ? (
            <NoTriggers kind="webhook" {...(workflowId ? { workflowId } : {})} />
          ) : (
            <>
              <ListHelp terms={WEBHOOK_TERMS} />
              <ul
                className="flex flex-col divide-y divide-border rounded-md border border-border"
                role="list"
              >
                {rows.map((h) => (
                  <li
                    key={h.id}
                    className={
                      "flex flex-col gap-2 px-3 py-2.5 " +
                      (highlight === h.id ? "bg-accent-soft" : "")
                    }
                  >
                    <div className="flex items-center gap-2">
                      <Webhook
                        strokeWidth={1.75}
                        className="size-3.5 shrink-0 text-ink-3"
                        aria-hidden="true"
                      />
                      {workflowName ? (
                        <a
                          className="shrink-0 text-xs font-medium text-ink hover:underline"
                          href={`/${s.ws}/workflows/${h.workflowId}/settings?tab=triggers`}
                        >
                          {workflowName(h.workflowId)}
                        </a>
                      ) : null}
                      <Badge mono>{envName(h.environmentId)}</Badge>
                      <code className="min-w-0 flex-1 truncate font-mono text-2xs text-ink">
                        {h.url}
                      </code>
                      <CopyButton value={h.url} label="Copy URL" size="sm" />
                    </div>
                    <div className="flex flex-wrap items-center gap-4 text-xs text-ink-2">
                      <label className="flex items-center gap-2">
                        <Switch
                          size="sm"
                          checked={h.enabled}
                          disabled={pending(h.id, "enabled")}
                          aria-busy={pending(h.id, "enabled")}
                          onCheckedChange={(c) =>
                            patchHook.mutate({ id: h.id, body: { enabled: c } })
                          }
                        />
                        Enabled
                      </label>
                      <label className="flex items-center gap-2">
                        <Switch
                          size="sm"
                          checked={h.requireTimestamp}
                          disabled={
                            h.signature !== "hmac_sha256" || pending(h.id, "requireTimestamp")
                          }
                          aria-busy={pending(h.id, "requireTimestamp")}
                          onCheckedChange={(c) =>
                            patchHook.mutate({ id: h.id, body: { requireTimestamp: c } })
                          }
                        />
                        Require signed timestamp
                      </label>
                      <label className="flex items-center gap-2">
                        Idempotency header
                        <Input
                          size="sm"
                          mono
                          className="w-44"
                          placeholder="body hash"
                          aria-label="Idempotency header"
                          defaultValue={h.idempotencyHeader ?? ""}
                          key={`${h.id}:${h.idempotencyHeader ?? ""}`}
                          onBlur={(e) => {
                            const v = e.target.value.trim();
                            if (v === (h.idempotencyHeader ?? "")) return;
                            patchHook.mutate({ id: h.id, body: { idempotencyHeader: v || null } });
                          }}
                        />
                      </label>
                      {h.signature === "none" ? (
                        <Badge tone="warn" dot>
                          Unsigned
                        </Badge>
                      ) : (
                        <span className="flex items-center gap-1.5">
                          {h.secretBound ? (
                            <Badge tone="ok" dot>
                              Signed ({h.signature})
                            </Badge>
                          ) : (
                            <Badge tone="warn" dot>
                              No signing secret: calls are refused
                            </Badge>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            leadingIcon={<KeyRound strokeWidth={1.75} />}
                            loading={rotate.isPending && rotate.variables?.id === h.id}
                            onClick={() => (h.secretBound ? setConfirmRotate(h) : rotate.mutate(h))}
                          >
                            {h.secretBound ? "Rotate secret" : "Generate secret"}
                          </Button>
                        </span>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        leadingIcon={<History strokeWidth={1.75} />}
                        onClick={() => setLog(h)}
                      >
                        Deliveries
                      </Button>
                      <span className="ml-auto text-2xs text-ink-3">
                        {h.lastReceivedAt ? (
                          <>
                            last call <RelativeTime date={h.lastReceivedAt} />
                          </>
                        ) : (
                          "never called"
                        )}
                      </span>
                    </div>
                    <details className="group text-xs">
                      <summary className="cursor-pointer select-none text-ink-3 hover:text-ink">
                        Example request
                      </summary>
                      <div className="mt-2 flex items-start gap-2">
                        <pre className="min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-surface-2 p-2 font-mono text-2xs text-ink">
                          {exampleWebhookRequest(
                            h.url,
                            h.signature as "hmac_sha256" | "token" | "none",
                          )}
                        </pre>
                        <CopyButton
                          value={exampleWebhookRequest(
                            h.url,
                            h.signature as "hmac_sha256" | "token" | "none",
                          )}
                          label="Copy example request"
                          size="sm"
                        />
                      </div>
                      <p className="mt-1.5 text-ink-3">
                        {h.signature === "hmac_sha256"
                          ? "Replace <signing secret> with the secret you generated; the signature covers the timestamp and the raw body, and each one is accepted once."
                          : h.signature === "token"
                            ? "Replace <signing secret> with the secret you generated."
                            : "Unsigned: anyone who knows this URL can start runs."}{" "}
                        The JSON body becomes the run&apos;s input.
                      </p>
                    </details>
                  </li>
                ))}
              </ul>
            </>
          )
        }
      </QueryView>
      <OneTimeSecretDialog
        secret={secret?.value ?? null}
        title={`Webhook signing secret for ${secret?.env ?? "this environment"}`}
        description="Give it to the sender now: it is stored encrypted and cannot be shown again. It works only in this environment, and any earlier secret here stops working."
        onClose={() => setSecret(null)}
      />
      <ConfirmDialog
        open={confirmRotate !== null}
        onOpenChange={(o) => {
          if (!o) setConfirmRotate(null);
        }}
        variant="danger"
        title={`Rotate the signing secret of /${confirmRotate?.path ?? ""}?`}
        description="The current secret stops working as soon as the new one is made: calls signed with it are refused until the sender uses the new secret, which is shown once."
        confirmLabel="Rotate secret"
        onConfirm={async () => {
          // a failure is toasted by the mutation; the dialog closes either way
          if (confirmRotate) await rotate.mutateAsync(confirmRotate).catch(() => undefined);
        }}
      />
      <DeliveriesSheet hook={log} onClose={() => setLog(null)} />
    </>
  );
}

export function DeliveriesSheet({
  hook,
  onClose,
}: {
  hook: WebhookRow | null;
  onClose: () => void;
}) {
  const s = useSession();
  const deliveries = useQuery({
    queryKey: ["webhook-deliveries", s.ws, hook?.id],
    queryFn: () => get<Page<WebhookDelivery>>(`/v1/webhooks/${hook?.id ?? ""}/deliveries?limit=50`),
    enabled: hook !== null,
    refetchInterval: 10_000,
  });
  return (
    <Sheet open={hook !== null} onOpenChange={(o) => (o ? undefined : onClose())}>
      <SheetContent side="right" width={560}>
        <SheetHeader>
          <SheetTitle>Deliveries</SheetTitle>
          <SheetDescription>
            The latest calls to <code className="font-mono">/{hook?.path}</code>, newest first.
            Duplicates repeat an earlier delivery (same idempotency key) and start no run.
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
          <QueryView query={deliveries}>
            {(page) =>
              page.items.length === 0 ? (
                <p className="text-xs text-ink-3">No call has reached this webhook yet.</p>
              ) : (
                <ul
                  className="flex flex-col divide-y divide-border rounded-md border border-border"
                  role="list"
                  aria-label="Webhook deliveries"
                >
                  {page.items.map((d) => (
                    <li key={d.id} className="flex flex-col gap-1 px-3 py-2 text-xs">
                      <div className="flex items-center gap-2">
                        <Badge tone={deliveryTone(d.status)} dot>
                          {DELIVERY_LABEL[d.status]}
                        </Badge>
                        {d.httpStatus ? (
                          <span className="font-mono text-2xs text-ink-3">HTTP {d.httpStatus}</span>
                        ) : null}
                        {d.direction === "outbound" ? <Badge>callback</Badge> : null}
                        <span className="ml-auto text-2xs text-ink-3">
                          <RelativeTime date={d.createdAt} />
                        </span>
                      </div>
                      {d.error ? <p className="text-danger-text">{d.error}</p> : null}
                      <div className="flex flex-wrap gap-3 text-2xs text-ink-3">
                        {d.externalId ? (
                          <span className="font-mono">key {d.externalId.slice(0, 24)}</span>
                        ) : null}
                        {d.runId ? (
                          <a
                            className="text-accent-text hover:underline"
                            href={`/${s.ws}/runs/${d.runId}`}
                          >
                            Open run
                          </a>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )
            }
          </QueryView>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
