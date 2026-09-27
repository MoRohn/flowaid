"use client";
/**
 * Live webhooks (materialised per environment on deploy): the environment-specific settings
 * (enabled, signed timestamps, idempotency header, signing secret) and the delivery log with
 * accepted, duplicate and rejected calls. The path and signature scheme belong to the workflow
 * definition and are read-only here.
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { History, KeyRound, Webhook } from "lucide-react";
import {
  Badge,
  Button,
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
import { get, patch, post, qs } from "~/api/client";
import type { Page } from "~/api/types";
import { useSession } from "~/session";
import type { Webhook as WebhookRow, WebhookDelivery } from "../types";
import { Notice, OneTimeSecretDialog, QueryView, useMutate } from "../ui";
import { DELIVERY_LABEL, deliveryTone } from "./logic";

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
  const [secret, setSecret] = useState<string | null>(null);
  const [log, setLog] = useState<WebhookRow | null>(null);
  const key = ["triggers", s.ws, workflowId ?? "*", "webhooks"];
  const hooks = useQuery({
    queryKey: key,
    queryFn: () => get<WebhookRow[]>(`/v1/webhooks${qs({ workflowId })}`),
    enabled: s.can("webhooks:write"),
  });
  const envName = (id: string) => s.environments.find((e) => e.id === id)?.name ?? id.slice(0, 8);
  const patchHook = useMutate(
    (v: { id: string; body: Record<string, unknown> }) => patch(`/v1/webhooks/${v.id}`, v.body),
    { success: "Webhook updated", invalidate: [key] },
  );
  const rotate = useMutate(
    (id: string) => post<{ secret: string }>(`/v1/webhooks/${id}/rotate-secret`),
    { invalidate: [key], onSuccess: (r) => setSecret(r.secret) },
  );

  if (!s.can("webhooks:write"))
    return <Notice tone="info">You need the webhooks:write scope to manage webhooks.</Notice>;
  return (
    <>
      <QueryView query={hooks} rows={2}>
        {(rows) =>
          rows.length === 0 ? (
            <p className="text-xs text-ink-3">
              No webhook is live. Add a webhook trigger in the builder, publish and deploy.
            </p>
          ) : (
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
                        disabled={h.signature !== "hmac_sha256"}
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
                            No signing secret
                          </Badge>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          leadingIcon={<KeyRound strokeWidth={1.75} />}
                          loading={rotate.isPending && rotate.variables === h.id}
                          onClick={() => rotate.mutate(h.id)}
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
                </li>
              ))}
            </ul>
          )
        }
      </QueryView>
      <OneTimeSecretDialog
        secret={secret}
        title="Webhook signing secret"
        description="Configure the sender with it now; it is stored as a credential and cannot be shown again."
        onClose={() => setSecret(null)}
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
