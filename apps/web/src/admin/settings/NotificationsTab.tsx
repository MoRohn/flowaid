"use client";
/**
 * Notification channels (Settings → Notifications): email, Slack and signed webhooks that receive
 * the workspace's events — a run waiting for a person, a failed run, a schedule that could not
 * start, a rejected webhook call. A new channel is set up step by step (where, which events,
 * review); nothing is sent until someone presses Send a test. A webhook channel's signing secret
 * is shown once, on create and on rotate.
 */
import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Bell, CheckCircle2, KeyRound, Pencil, Plus, Send, Trash2 } from "lucide-react";
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
import { del, getAll, patch, post } from "~/api/client";
import { DraftStatus, GuidedFlow, type FlowStep } from "~/guide/GuidedFlow";
import { CheckList, type Check } from "~/guide/Readiness";
import { useKeptDraft } from "~/guide/useKeptDraft";
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
  // a channel just added: what happens next, and its explicit test
  const [added, setAdded] = useState<{ channel: NotificationChannel; secret?: string } | null>(
    null,
  );
  const remove = useConfirm<NotificationChannel>();
  // replacing a signing secret that receivers verify with asks first
  const confirmRotate = useConfirm<NotificationChannel>();
  const channels = useQuery({
    queryKey: key,
    queryFn: () => getAll<NotificationChannel>("/v1/notifications"),
    enabled: s.can("admin"),
  });
  const toggle = useMutate(
    (c: NotificationChannel) => patch(`/v1/notifications/${c.id}`, { enabled: !c.enabled }),
    { invalidate: [key], errorTitle: "Could not switch the channel" },
  );
  const test = useMutate(
    (c: NotificationChannel) =>
      post<{ ok: boolean; error?: string }>(`/v1/notifications/${c.id}/test`),
    {
      errorTitle: "The test could not be sent",
      onSuccess: (r, c) => {
        if (r.ok) toast.success(`Test sent to ${c.name}`);
        else toast.error(`${c.name} did not receive the test`, { description: r.error });
      },
    },
  );
  const rotate = useMutate(
    (c: NotificationChannel) =>
      post<{ signingSecret: string }>(`/v1/notifications/${c.id}/rotate-secret`),
    {
      invalidate: [key],
      onSuccess: (r) => setSecret(r.signingSecret),
      errorTitle: "Could not rotate the signing secret",
    },
  );
  // row actions show they are running, and can't be fired twice meanwhile
  const busy = (
    m: { isPending: boolean; variables?: NotificationChannel },
    c: NotificationChannel,
  ) => m.isPending && m.variables?.id === c.id;
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
                      disabled={busy(toggle, c)}
                      aria-busy={busy(toggle, c)}
                      onCheckedChange={() => toggle.mutate(c)}
                    />
                    <IconButton
                      size="sm"
                      variant="ghost"
                      label={`Send a test to ${c.name}`}
                      loading={busy(test, c)}
                      disabled={busy(test, c)}
                      onClick={() => test.mutate(c)}
                    >
                      <Send strokeWidth={1.75} />
                    </IconButton>
                    {c.kind === "webhook" ? (
                      <IconButton
                        size="sm"
                        variant="ghost"
                        label={`Rotate the signing secret of ${c.name}`}
                        loading={busy(rotate, c)}
                        onClick={() => confirmRotate.ask(c)}
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
          onAdded={(channel, signingSecret) =>
            setAdded({ channel, ...(signingSecret ? { secret: signingSecret } : {}) })
          }
        />
      ) : null}
      {/* after adding: a webhook's secret (shown once) with the next steps, else the next steps */}
      <OneTimeSecretDialog
        secret={added?.secret ?? null}
        title="Signing secret"
        description="Verify deliveries with it: X-FlowAId-Signature is sha256=HMAC(secret, `<X-FlowAId-Timestamp>.<body>`). It cannot be shown again."
        onClose={() => setAdded(null)}
        extra={added ? <ChannelNext channel={added.channel} test={test} /> : null}
      />
      <Dialog
        open={added !== null && !added.secret}
        onOpenChange={(o) => (o ? undefined : setAdded(null))}
      >
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 strokeWidth={1.75} className="size-4 text-ok-text" aria-hidden />
              {added?.channel.name} is added
            </DialogTitle>
            <DialogDescription>Nothing has been sent to it yet.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            {added ? <ChannelNext channel={added.channel} test={test} /> : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="primary" onClick={() => setAdded(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <OneTimeSecretDialog
        secret={secret}
        title="Signing secret"
        description="Verify deliveries with it: X-FlowAId-Signature is sha256=HMAC(secret, `<X-FlowAId-Timestamp>.<body>`). It cannot be shown again."
        onClose={() => setSecret(null)}
      />
      <ConfirmDialog
        open={confirmRotate.target !== null}
        onOpenChange={(o) => (o ? undefined : confirmRotate.close())}
        title={`Rotate the signing secret of ${confirmRotate.target?.name ?? "the channel"}?`}
        description="The current secret stops working as soon as the new one is made: the receiver must verify deliveries with the new secret, which is shown once."
        variant="danger"
        confirmLabel="Rotate secret"
        onConfirm={async () => {
          // a failure is toasted by the mutation; the dialog closes either way
          if (confirmRotate.target)
            await rotate.mutateAsync(confirmRotate.target).catch(() => undefined);
        }}
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

/** What a new channel does from now on, and a test only when asked for. */
function ChannelNext({
  channel,
  test,
}: {
  channel: NotificationChannel;
  test: ReturnType<typeof useMutate<NotificationChannel, { ok: boolean; error?: string }>>;
}) {
  const result = test.variables?.id === channel.id ? test.data : undefined;
  const label = (id: string) => NOTIFICATION_EVENTS.find((e) => e.id === id)?.label ?? id;
  return (
    <div className="flex flex-col gap-2 text-sm text-ink-2">
      <p className="m-0">
        From now on it receives: {channel.events.map((e) => label(e).toLowerCase()).join("; ")}.
        Turn it off or change the events from the list at any time.
      </p>
      <p className="m-0">
        Send a test to check that messages arrive
        {channel.kind === "email"
          ? " (email needs SMTP_URL set on the server)"
          : channel.kind === "webhook"
            ? " and that your endpoint verifies the signature"
            : ""}
        .
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          leadingIcon={<Send strokeWidth={1.75} />}
          loading={test.isPending && test.variables?.id === channel.id}
          onClick={() => test.mutate(channel)}
        >
          Send a test
        </Button>
        {result ? (
          <span
            role="status"
            className={`text-xs ${result.ok ? "text-ok-text" : "text-danger-text"}`}
          >
            {result.ok ? "Test sent." : `Not delivered: ${result.error ?? "no reason given"}`}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function ChannelDialog({
  channel,
  onClose,
  onSecret,
  onAdded,
}: {
  channel: NotificationChannel | null;
  onClose: () => void;
  onSecret: (secret: string) => void;
  onAdded: (channel: NotificationChannel, signingSecret?: string) => void;
}) {
  const s = useSession();
  // a new channel's draft is kept in this tab, without the Slack URL (it is a secret)
  const kept = useKeptDraft<ChannelDraft>(
    channel ? null : `flowaid:draft:${s.ws}:notification-channel`,
    () => draftOf(channel ?? undefined),
    (d) => ({ ...d, slackWebhookUrl: "" }),
  );
  const d = kept.draft;
  const setD = kept.setDraft;
  const [touched, setTouched] = useState(false);
  const problems = channelProblems(d, channel !== null);
  const save = useMutate(
    (): Promise<{ channel?: NotificationChannel; signingSecret?: string }> =>
      channel
        ? patch<{ signingSecret?: string }>(`/v1/notifications/${channel.id}`, channelBody(d))
        : post<{ channel: NotificationChannel; signingSecret?: string }>("/v1/notifications", {
            kind: d.kind,
            ...channelBody(d),
          }),
    {
      // a new channel's next step says it was added
      ...(channel ? { success: "Channel saved" } : {}),
      invalidate: [["notifications", s.ws]],
      // a refused save keeps the form as it is
      errorTitle: channel ? "Could not save the channel" : "Could not add the channel",
      onSuccess: (r) => {
        if (!channel) kept.discard();
        if (!channel && r.channel) onAdded(r.channel, r.signingSecret);
        else if (r.signingSecret) onSecret(r.signingSecret);
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
  const whereOk =
    !problems.name && !problems.recipients && !problems.url && !problems.slackWebhookUrl;
  const notes: Check[] = [
    ...Object.entries(problems).map(([k, m]): Check => ({ id: k, label: m, state: "blocker" })),
    ...(Object.keys(problems).length === 0
      ? [{ id: "ok", label: "Everything the channel needs is filled in", state: "ok" } as Check]
      : []),
    ...(d.kind === "email"
      ? [
          {
            id: "smtp",
            label:
              "Email is delivered only when the server has SMTP_URL set; a test shows whether it does.",
            state: "info",
          } as Check,
        ]
      : d.kind === "webhook" && !channel
        ? [
            {
              id: "secret",
              label:
                "Its signing secret is shown once, right after you add it: have your endpoint's configuration ready.",
              state: "info",
            } as Check,
          ]
        : []),
    ...(d.events.length && !d.events.includes("human_task.created")
      ? [
          {
            id: "human",
            label:
              "Runs waiting for a person are not announced here; they wait under Human tasks until someone looks.",
            state: "info",
          } as Check,
        ]
      : []),
  ];

  const steps: FlowStep[] = [
    {
      id: "where",
      title: "Choose where to send it",
      why: "Pick how the people who must act hear about it: an email list, a Slack channel, or your own system through a signed webhook.",
      done: whereOk,
      // in words, since fields turn red only after a first attempt to add
      requirement:
        [problems.name, problems.recipients, problems.url, problems.slackWebhookUrl]
          .filter(Boolean)
          .map((m) => String(m).charAt(0).toLowerCase() + String(m).slice(1))
          .join("; ") || "fill in the fields",
      example:
        "Name it after who reads it: On-call, Finance approvers. A shared list or channel outlasts one person's address.",
      children: (
        <>
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
                  : "Create one in Slack under Apps → Incoming Webhooks. Stored encrypted, never shown again, and not kept if you close this form."
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
        </>
      ),
    },
    {
      id: "events",
      title: "Choose the events",
      why: "Send only what the readers of this channel will act on; a channel that announces everything gets muted. The first two are the ones someone usually has to answer.",
      done: !problems.events,
      requirement: "choose at least one event",
      children: (
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
      ),
    },
    {
      id: "review",
      doneLabel: channel ? "Ready to save" : "Ready to add",
      title: channel ? "Review and save" : "Review and add",
      why: channel
        ? "Check the changes; the channel uses them for the next event."
        : "Check the channel. Adding it sends nothing: afterwards you can send a test, and real events arrive as they happen.",
      done: Object.keys(problems).length === 0,
      requirement: "fix the items marked as needed",
      children: (
        <>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-sm border border-border px-3 py-2 text-sm">
            <dt className="text-ink-3">Type</dt>
            <dd className="m-0 text-ink">{KIND_LABEL[d.kind]}</dd>
            <dt className="text-ink-3">Name</dt>
            <dd className="m-0 text-ink">{d.name.trim() || "—"}</dd>
            <dt className="text-ink-3">Events</dt>
            <dd className="m-0 text-ink">{d.events.length ? d.events.length : "None"}</dd>
          </dl>
          <CheckList checks={notes} aria-label="Before you add it" />
        </>
      ),
    },
  ];

  return (
    <Dialog open onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent size="lg">
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>
              {channel ? `Edit ${channel.name}` : "Add a notification channel"}
            </DialogTitle>
            <DialogDescription>
              Choose where to send it and which events it receives.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <GuidedFlow
              steps={steps}
              status={
                channel ? (
                  "Changes are saved when you press Save."
                ) : (
                  <DraftStatus
                    dirty={kept.dirty}
                    restored={kept.restored}
                    onDiscard={() => {
                      kept.discard();
                      setTouched(false);
                    }}
                    what="the channel"
                  />
                )
              }
            />
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" type="button" onClick={onClose}>
              {channel ? "Cancel" : "Close"}
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
