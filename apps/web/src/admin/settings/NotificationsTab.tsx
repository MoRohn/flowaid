"use client";
/**
 * Notification channels (Settings → Notifications): email, Slack and signed webhooks that receive
 * the workspace's events — a run waiting for a person, a failed run, a schedule that could not
 * start, a rejected webhook call. Each channel can be tested; a webhook channel's signing secret
 * is shown once, on create and on rotate.
 */
import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Bell, KeyRound, Pencil, Plus, Send, Trash2 } from "lucide-react";
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
  Switch,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
  toast,
} from "@flowaid/ui/primitives";
import { del, get, patch, post } from "~/api/client";
import { useSession } from "~/session";
import type { NotificationChannel } from "../types";
import { Notice, OneTimeSecretDialog, QueryView, Section, useConfirm, useMutate } from "../ui";
import {
  KIND_LABEL,
  NOTIFICATION_EVENTS,
  channelBody,
  channelProblems,
  draftOf,
  type ChannelDraft,
} from "../triggers/logic";

export function NotificationsTab() {
  const s = useSession();
  const key = ["notifications", s.ws];
  const [editing, setEditing] = useState<NotificationChannel | "new" | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const remove = useConfirm<NotificationChannel>();
  const channels = useQuery({
    queryKey: key,
    queryFn: () => get<NotificationChannel[]>("/v1/notifications"),
    enabled: s.can("admin"),
  });
  const toggle = useMutate(
    (c: NotificationChannel) => patch(`/v1/notifications/${c.id}`, { enabled: !c.enabled }),
    { invalidate: [key] },
  );
  const test = useMutate(
    (c: NotificationChannel) =>
      post<{ ok: boolean; error?: string }>(`/v1/notifications/${c.id}/test`),
    {
      onSuccess: (r, c) => {
        if (r.ok) toast.success(`Test sent to ${c.name}`);
        else toast.error(`${c.name} did not receive the test`, { description: r.error });
      },
    },
  );
  const rotate = useMutate(
    (c: NotificationChannel) =>
      post<{ signingSecret: string }>(`/v1/notifications/${c.id}/rotate-secret`),
    { invalidate: [key], onSuccess: (r) => setSecret(r.signingSecret) },
  );
  const drop = useMutate((c: NotificationChannel) => del(`/v1/notifications/${c.id}`), {
    success: (_, c) => `Deleted ${c.name}`,
    invalidate: [key],
    onSuccess: remove.close,
  });

  if (!s.can("admin"))
    return <Notice tone="info">Only workspace admins manage notification channels.</Notice>;
  return (
    <Section
      title="Notification channels"
      description="Where the workspace tells people about runs that need them or went wrong."
      actions={
        <Button
          variant="primary"
          leadingIcon={<Plus strokeWidth={1.75} />}
          onClick={() => setEditing("new")}
        >
          Add channel
        </Button>
      }
    >
      <QueryView query={channels} rows={2}>
        {(rows) =>
          rows.length === 0 ? (
            <EmptyState
              size="sm"
              icon={<Bell strokeWidth={1.5} />}
              title="No channels yet"
              description="Add an email list, a Slack channel or a webhook to hear when runs wait for a person or fail."
            />
          ) : (
            <ul
              className="flex flex-col divide-y divide-border rounded-md border border-border"
              role="list"
              aria-label="Notification channels"
            >
              {rows.map((c) => (
                <li key={c.id} className="flex flex-col gap-1.5 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <Badge>{KIND_LABEL[c.kind]}</Badge>
                    <span className="text-sm font-medium text-ink">{c.name}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-2xs text-ink-3">
                      {c.kind === "email"
                        ? (c.config.to ?? []).join(", ")
                        : c.kind === "webhook"
                          ? c.config.url
                          : c.secretSet
                            ? "incoming webhook stored"
                            : "no URL"}
                    </span>
                    <Switch
                      size="sm"
                      checked={c.enabled}
                      aria-label={`${c.name} enabled`}
                      onCheckedChange={() => toggle.mutate(c)}
                    />
                    <IconButton
                      size="sm"
                      variant="ghost"
                      label={`Send a test to ${c.name}`}
                      onClick={() => test.mutate(c)}
                    >
                      <Send strokeWidth={1.75} />
                    </IconButton>
                    {c.kind === "webhook" ? (
                      <IconButton
                        size="sm"
                        variant="ghost"
                        label={`Rotate the signing secret of ${c.name}`}
                        onClick={() => rotate.mutate(c)}
                      >
                        <KeyRound strokeWidth={1.75} />
                      </IconButton>
                    ) : null}
                    <IconButton
                      size="sm"
                      variant="ghost"
                      label={`Edit ${c.name}`}
                      onClick={() => setEditing(c)}
                    >
                      <Pencil strokeWidth={1.75} />
                    </IconButton>
                    <IconButton
                      size="sm"
                      variant="ghost"
                      label={`Delete ${c.name}`}
                      onClick={() => remove.ask(c)}
                    >
                      <Trash2 strokeWidth={1.75} />
                    </IconButton>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {c.events.map((e) => (
                      <Badge key={e} mono>
                        {e}
                      </Badge>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )
        }
      </QueryView>
      {editing !== null ? (
        <ChannelDialog
          channel={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSecret={setSecret}
        />
      ) : null}
      <OneTimeSecretDialog
        secret={secret}
        title="Signing secret"
        description="Verify deliveries with it: X-FlowAId-Signature is sha256=HMAC(secret, `<X-FlowAId-Timestamp>.<body>`). It cannot be shown again."
        onClose={() => setSecret(null)}
      />
      <ConfirmDialog
        open={remove.target !== null}
        onOpenChange={(o) => (o ? undefined : remove.close())}
        title={`Delete ${remove.target?.name ?? "channel"}?`}
        description="It stops receiving notifications; its stored secret is deleted too."
        variant="danger"
        confirmLabel="Delete channel"
        loading={drop.isPending}
        onConfirm={() => {
          if (remove.target) drop.mutate(remove.target);
        }}
      />
    </Section>
  );
}

function ChannelDialog({
  channel,
  onClose,
  onSecret,
}: {
  channel: NotificationChannel | null;
  onClose: () => void;
  onSecret: (secret: string) => void;
}) {
  const s = useSession();
  const [d, setD] = useState<ChannelDraft>(() => draftOf(channel ?? undefined));
  const [touched, setTouched] = useState(false);
  const problems = channelProblems(d, channel !== null);
  const save = useMutate(
    (): Promise<{ signingSecret?: string }> =>
      channel
        ? patch<{ signingSecret?: string }>(`/v1/notifications/${channel.id}`, channelBody(d))
        : post<{ signingSecret?: string }>("/v1/notifications", {
            kind: d.kind,
            ...channelBody(d),
          }),
    {
      success: channel ? "Channel saved" : "Channel added",
      invalidate: [["notifications", s.ws]],
      onSuccess: (r) => {
        if (r.signingSecret) onSecret(r.signingSecret);
        onClose();
      },
    },
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(problems).length === 0) save.mutate(undefined);
  };
  const err = (k: string) => (touched ? problems[k] : undefined);

  return (
    <Dialog open onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent size="md">
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>
              {channel ? `Edit ${channel.name}` : "Add a notification channel"}
            </DialogTitle>
            <DialogDescription>
              Choose where to send it and which events it receives.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            {channel ? null : (
              <ToggleGroup
                type="single"
                value={d.kind}
                aria-label="Channel type"
                onValueChange={(v) => v && setD({ ...d, kind: v as ChannelDraft["kind"] })}
              >
                <ToggleGroupItem value="email">Email</ToggleGroupItem>
                <ToggleGroupItem value="slack_webhook">Slack</ToggleGroupItem>
                <ToggleGroupItem value="webhook">Webhook</ToggleGroupItem>
              </ToggleGroup>
            )}
            <FieldRow label="Name" htmlFor="nc-name" error={err("name")}>
              <Input
                id="nc-name"
                value={d.name}
                maxLength={100}
                placeholder="On-call"
                onChange={(e) => setD({ ...d, name: e.target.value })}
              />
            </FieldRow>
            {d.kind === "email" ? (
              <FieldRow
                label="Recipients"
                htmlFor="nc-to"
                hint="Up to 20 addresses, separated by commas or new lines. Delivery needs SMTP_URL on the server."
                error={err("recipients")}
              >
                <Textarea
                  id="nc-to"
                  rows={2}
                  value={d.recipients}
                  onChange={(e) => setD({ ...d, recipients: e.target.value })}
                />
              </FieldRow>
            ) : d.kind === "webhook" ? (
              <FieldRow
                label="URL"
                htmlFor="nc-url"
                hint="Receives a signed JSON POST per event."
                error={err("url")}
              >
                <Input
                  id="nc-url"
                  mono
                  value={d.url}
                  placeholder="https://example.com/flowaid"
                  onChange={(e) => setD({ ...d, url: e.target.value })}
                />
              </FieldRow>
            ) : (
              <FieldRow
                label="Slack incoming-webhook URL"
                htmlFor="nc-slack"
                hint={
                  channel
                    ? "Stored encrypted and never shown. Leave empty to keep the current one."
                    : "Stored encrypted and never shown again."
                }
                error={err("slackWebhookUrl")}
              >
                <Input
                  id="nc-slack"
                  mono
                  type="password"
                  autoComplete="off"
                  value={d.slackWebhookUrl}
                  placeholder="https://hooks.slack.com/services/…"
                  onChange={(e) => setD({ ...d, slackWebhookUrl: e.target.value })}
                />
              </FieldRow>
            )}
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-xs font-medium text-ink">Events</legend>
              {NOTIFICATION_EVENTS.map((ev) => (
                <label key={ev.id} className="flex items-center gap-2 text-sm text-ink-2">
                  <Checkbox
                    checked={d.events.includes(ev.id)}
                    onCheckedChange={(c) =>
                      setD({
                        ...d,
                        events: c ? [...d.events, ev.id] : d.events.filter((x) => x !== ev.id),
                      })
                    }
                  />
                  {ev.label}
                  <code className="font-mono text-2xs text-ink-3">{ev.id}</code>
                </label>
              ))}
              {err("events") ? (
                <p className="text-xs text-danger-text" role="alert">
                  {err("events")}
                </p>
              ) : null}
            </fieldset>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" loading={save.isPending}>
              {channel ? "Save" : "Add channel"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
