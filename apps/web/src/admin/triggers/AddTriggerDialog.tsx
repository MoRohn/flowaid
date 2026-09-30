"use client";
/**
 * Adds a webhook or a schedule to a workflow: the trigger is written into the workflow's draft,
 * and becomes live in an environment when a version with it is published and deployed there.
 * A new trigger is built step by step (or all at once, "All fields"); its draft is kept in this
 * browser tab until it is added, and adding it ends on what to do next. Nothing is published or
 * deployed from here.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { CalendarClock, CheckCircle2, Plus, Webhook } from "lucide-react";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  FieldRow,
  Input,
  RadioGroup,
  RadioItem,
  Select,
  SelectItem,
  Textarea,
} from "@flowaid/ui/primitives";
import { get, getAll, put } from "~/api/client";
import type { WorkflowDetail } from "~/api/types";
import { DraftStatus, GuidedFlow, type FlowStep } from "~/guide/GuidedFlow";
import { CheckList, QualityNote, type Check } from "~/guide/Readiness";
import { useKeptDraft } from "~/guide/useKeptDraft";
import { useSession } from "~/session";
import type { Webhook as WebhookRow } from "../types";
import { Notice, useMutate } from "../ui";
import {
  CRON_PRESETS,
  cronProblem,
  nextCronRuns,
  webhookPathFrom,
  withTrigger,
  type NewTrigger,
} from "./add";
import {
  exampleInput,
  existingTriggers,
  inputFields,
  missingInputs,
  triggerNotes,
  validTimezone,
} from "./guide";

const CUSTOM = "__custom";

function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

interface TriggerDraft {
  workflowId: string;
  /** null: derived from the workflow's name */
  path: string | null;
  signature: "hmac_sha256" | "token" | "none";
  responseMode: "async" | "sync";
  preset: string;
  cron: string;
  timezone: string;
  input: string;
}

const SIGNATURES: readonly {
  id: TriggerDraft["signature"];
  label: string;
  detail: string;
}[] = [
  {
    id: "hmac_sha256",
    label: "A signature (HMAC-SHA256), recommended",
    detail:
      "The sender signs each call with a shared secret and the current time. The secret never travels with the call, old or repeated signatures are refused, and a changed body fails the check.",
  },
  {
    id: "token",
    label: "A shared token header",
    detail:
      "The sender puts the secret in an X-Webhook-Token header. Simple for senders that cannot sign, but anyone who sees one call can reuse the token.",
  },
  {
    id: "none",
    label: "Nothing (unsigned)",
    detail:
      "Anyone who learns the URL can start runs. Only for trying things out; protected environments refuse unsigned calls.",
  },
];

const RESPONSES: readonly { id: TriggerDraft["responseMode"]; label: string; detail: string }[] = [
  {
    id: "async",
    label: "Run in the background, recommended",
    detail:
      "The caller gets 202 with the run id at once; the run carries on. Suits senders that only need to know the call arrived, and runs that take a while or wait for a person.",
  },
  {
    id: "sync",
    label: "Wait for the output",
    detail:
      "The caller waits up to 30 seconds and gets the workflow's output in the answer. If the run takes longer, it gets 202 with the run id instead. Use it only when the caller needs the answer in the same call.",
  },
];

export function AddTriggerDialog({
  kind,
  open,
  onOpenChange,
  workflowId: fixedWorkflow,
}: {
  kind: "webhook" | "schedule";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** preselected (the workflow's own settings); otherwise the person picks one */
  workflowId?: string;
}) {
  const s = useSession();
  const qc = useQueryClient();
  // an unsent trigger survives closing the dialog in this tab; nothing in it is secret
  const kept = useKeptDraft<TriggerDraft>(
    `flowaid:draft:${s.ws}:trigger:${kind}${fixedWorkflow ? `:${fixedWorkflow}` : ""}`,
    () => ({
      workflowId: fixedWorkflow ?? "",
      path: null,
      signature: "hmac_sha256",
      responseMode: "async",
      preset: CRON_PRESETS[2]?.cron ?? "0 9 * * *",
      cron: "",
      timezone: localTimezone(),
      input: "{}",
    }),
  );
  const { draft, setDraft } = kept;
  const set = <K extends keyof TriggerDraft>(k: K, v: TriggerDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));
  const workflowId = fixedWorkflow ?? draft.workflowId;
  const [done, setDone] = useState<{ id: string; name: string } | null>(null);

  const workflows = useQuery({
    queryKey: ["workflow-names", s.ws],
    queryFn: () => get<{ items: { id: string; name: string }[] }>("/v1/workflows?limit=200"),
    enabled: open && !fixedWorkflow,
  });
  const detailKey = ["workflow", s.ws, workflowId];
  const detail = useQuery({
    queryKey: detailKey,
    queryFn: () => get<WorkflowDetail>(`/v1/workflows/${workflowId}`),
    enabled: open && Boolean(workflowId),
  });
  const hooks = useQuery({
    queryKey: ["triggers", s.ws, "*", "webhooks"],
    queryFn: () => getAll<WebhookRow>("/v1/webhooks"),
    enabled: open && kind === "webhook" && s.can("webhooks:write"),
  });
  const name = detail.data?.name ?? "";
  const effectivePath = draft.path ?? (name ? webhookPathFrom(name) : "");
  const effectiveCron = draft.preset === CUSTOM ? draft.cron : draft.preset;
  let parsedInput: unknown = {};
  let inputError: string | null = null;
  if (kind === "schedule") {
    try {
      parsedInput = draft.input.trim() ? JSON.parse(draft.input) : {};
    } catch {
      inputError = "Enter valid JSON, or leave {}";
    }
  }
  const timezone = draft.timezone.trim() || "UTC";
  const trigger: NewTrigger =
    kind === "webhook"
      ? {
          type: "webhook",
          path: effectivePath,
          signature: draft.signature,
          responseMode: draft.responseMode,
        }
      : { type: "schedule", cron: effectiveCron, timezone, input: parsedInput };
  const next = detail.data ? withTrigger(detail.data.draft, trigger) : null;
  const problem =
    (next && "error" in next ? next.error : null) ??
    inputError ??
    (kind === "schedule" && !validTimezone(timezone) ? `${timezone} is not a time zone` : null);
  const fields = inputFields(detail.data?.draft.inputs);
  const notes = detail.data
    ? triggerNotes(trigger, {
        workflowId,
        latestVersion: detail.data.latestVersion,
        deployments: detail.data.deployments.map((d) => ({
          environment: d.environment,
          version: d.version,
        })),
        environments: s.environments,
        liveWebhooks: hooks.data ?? [],
        inputs: detail.data.draft.inputs,
      })
    : [];

  const save = useMutate(
    async () => {
      const d = detail.data;
      if (!d || !next || "error" in next) throw new Error(problem ?? "Choose a workflow");
      try {
        await put(
          `/v1/workflows/${d.id}/draft`,
          { definition: next.definition },
          { headers: { "if-match": `"${d.draftRevision}"` } },
        );
      } catch (error) {
        // someone changed the draft meanwhile: reload it so pressing Add again uses the new one
        void qc.invalidateQueries({ queryKey: detailKey });
        throw error;
      }
      return d;
    },
    {
      errorTitle: "Could not add the trigger",
      onSuccess: (d) => {
        kept.discard();
        setDone({ id: d.id, name: d.name });
        void qc.invalidateQueries({ queryKey: ["workflow", s.ws, d.id] });
      },
    },
  );

  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      setDone(null);
      save.reset();
    }
  };
  const what = kind === "webhook" ? "webhook" : "schedule";

  if (done)
    return (
      <Dialog open={open} onOpenChange={close}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 strokeWidth={1.75} className="size-4 text-ok-text" aria-hidden="true" />
              Added to {done.name}&apos;s draft
            </DialogTitle>
            <DialogDescription>
              The {what} is saved in the draft only. It is not live anywhere yet, and nothing was
              published or deployed.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <ol className="m-0 flex list-decimal flex-col gap-1.5 pl-5 text-sm text-ink-2">
              <li>
                Open the workflow and press Publish. Tick an environment there to deploy the new
                version at once, or deploy it later from the workflow&apos;s Deployments page.
              </li>
              {kind === "webhook" ? (
                <>
                  <li>
                    Back on the Webhooks tab, the webhook appears once per environment with its URL.
                    {draft.signature === "none"
                      ? ""
                      : " Press Generate secret there: it is shown once, and calls are refused until it exists."}
                  </li>
                  <li>
                    Give the URL{draft.signature === "none" ? "" : " and secret"} to the sender, and
                    try the example request listed under the webhook. Each call shows under
                    Deliveries.
                  </li>
                </>
              ) : (
                <li>
                  Back on the Schedules tab, the schedule appears once per environment with its next
                  run time. There you can pause it and choose how missed and overlapping runs are
                  handled.
                </li>
              )}
            </ol>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => close(false)}>
              Done
            </Button>
            <Button asChild variant="secondary">
              <Link href={`/${s.ws}/workflows/${done.id}/deployments`}>Deployments</Link>
            </Button>
            <Button asChild variant="primary">
              <Link href={`/${s.ws}/workflows/${done.id}`}>Open the workflow</Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );

  const existing = existingTriggers(detail.data?.draft, kind);
  const workflowChecks: Check[] = !workflowId
    ? []
    : detail.isPending
      ? [{ id: "wf", label: "Reading the workflow", state: "checking" }]
      : detail.isError
        ? [
            {
              id: "wf",
              label: "Could not read the workflow",
              state: "blocker",
              detail: "Your choices are kept. Try again, or choose another workflow.",
              fix: (
                <Button size="sm" variant="link" onClick={() => void detail.refetch()}>
                  Try again
                </Button>
              ),
            },
          ]
        : [
            detail.data.deployments.length
              ? {
                  id: "live",
                  label: `Deployed to ${detail.data.deployments.map((d) => d.environment).join(", ")}`,
                  state: "ok",
                  detail: "The new trigger joins them only after you publish and deploy again.",
                }
              : {
                  id: "live",
                  label: "Not deployed to any environment yet",
                  state: "info",
                  detail: "That is fine: publishing and deploying come after this.",
                },
            existing.length
              ? {
                  id: "existing",
                  label: `The draft already has ${existing.length === 1 ? `a ${what}` : `${existing.length} ${what}s`}: ${existing.join(", ")}`,
                  state: "info",
                }
              : { id: "existing", label: `No ${what} in the draft yet`, state: "ok" },
          ];

  const chooseStep: FlowStep = {
    id: "workflow",
    title: "Choose the workflow",
    why:
      kind === "webhook"
        ? "The workflow the calls start. The JSON body each call sends becomes the run's input, so pick the workflow whose input matches what the sender posts."
        : "The workflow each tick starts, with the same input every time.",
    done: Boolean(detail.data),
    requirement: "choose a workflow",
    children: (
      <>
        <FieldRow label="Workflow" htmlFor="trg-workflow" required>
          <Select
            id="trg-workflow"
            value={draft.workflowId}
            onValueChange={(v) => setDraft((d) => ({ ...d, workflowId: v, path: null }))}
            placeholder={workflows.isPending ? "Loading…" : "Choose a workflow"}
          >
            {(workflows.data?.items ?? []).map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.name}
              </SelectItem>
            ))}
          </Select>
        </FieldRow>
        {workflows.data && workflows.data.items.length === 0 ? (
          <Notice tone="info">
            No workflows yet.{" "}
            <Link className="underline" href={`/${s.ws}/workflows`}>
              Create one first
            </Link>
            ; this draft is kept in this tab.
          </Notice>
        ) : null}
        {workflowChecks.length ? (
          <CheckList checks={workflowChecks} aria-label="The workflow today" />
        ) : null}
      </>
    ),
  };

  const inputSummary = fields.length ? (
    <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-xs">
      {fields.map((f) => (
        <li key={f.name}>
          <code className="font-mono text-ink">{f.name}</code>{" "}
          <span className="text-ink-3">
            {f.type}
            {f.required ? ", required" : ""}
            {f.description ? ` · ${f.description}` : ""}
          </span>
        </li>
      ))}
    </ul>
  ) : null;

  const webhookSteps: FlowStep[] = [
    {
      id: "path",
      title: "Name the URL",
      why: `The last part of the webhook's address. Each environment gets its own URL: …/hooks/${s.ws}/<environment>/${effectivePath || "<path>"}. No two workflows can use the same path in one environment.`,
      done: Boolean(detail.data) && !(next && "error" in next),
      requirement: "use 3 to 64 lowercase letters, digits and dashes",
      example: (
        <>
          Name it after the event that calls it, such as{" "}
          <code className="font-mono">order-created</code> or{" "}
          <code className="font-mono">support-form</code>. The suggestion comes from the
          workflow&apos;s name.
        </>
      ),
      children: (
        <FieldRow
          label="Path"
          htmlFor="trg-path"
          required
          error={next && "error" in next ? next.error : undefined}
          hint="Lowercase letters, digits and dashes (3 to 64)"
        >
          <Input
            id="trg-path"
            mono
            value={effectivePath}
            maxLength={64}
            onChange={(e) => set("path", e.target.value.toLowerCase())}
          />
        </FieldRow>
      ),
    },
    {
      id: "signature",
      title: "Choose how callers prove who they are",
      why: "Without a check, anyone who finds the URL can start runs. The secret itself is generated per environment after deployment, on the Webhooks tab, and shown once.",
      done: true,
      example:
        "Keep the signature unless the sending service cannot compute one. Many services document this as “signing secret” or “HMAC”.",
      children: (
        <RadioGroup
          aria-label="Caller proves itself with"
          value={draft.signature}
          onValueChange={(v) => set("signature", v as TriggerDraft["signature"])}
        >
          {SIGNATURES.map((o) => (
            <RadioItem key={o.id} value={o.id} label={o.label} description={o.detail} />
          ))}
        </RadioGroup>
      ),
    },
    {
      id: "response",
      title: "Choose what the caller gets back",
      why: "Decides whether the call returns straight away or waits for the workflow's output.",
      done: true,
      children: (
        <RadioGroup
          aria-label="Response"
          value={draft.responseMode}
          onValueChange={(v) => set("responseMode", v as TriggerDraft["responseMode"])}
        >
          {RESPONSES.map((o) => (
            <RadioItem key={o.id} value={o.id} label={o.label} description={o.detail} />
          ))}
        </RadioGroup>
      ),
    },
  ];

  const missingRequired =
    kind === "schedule" && !inputError ? missingInputs(detail.data?.draft.inputs, parsedInput) : [];
  const scheduleSteps: FlowStep[] = [
    {
      id: "when",
      title: "Choose when it runs",
      why: "Pick a common timetable or write a cron expression. Times are read in the time zone you choose, including daylight-saving changes.",
      done: validTimezone(timezone) && !cronProblem(effectiveCron, timezone),
      requirement: "enter a five-field cron and a valid time zone",
      example: (
        <>
          Start slower than you think you need: every run is a real run of the workflow. In a custom
          cron, <code className="font-mono">30 6 * * 1-5</code> means 06:30 on weekdays.
        </>
      ),
      children: (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldRow label="When" htmlFor="trg-preset">
              <Select id="trg-preset" value={draft.preset} onValueChange={(v) => set("preset", v)}>
                {CRON_PRESETS.map((p) => (
                  <SelectItem key={p.cron} value={p.cron} description={p.cron}>
                    {p.label}
                  </SelectItem>
                ))}
                <SelectItem value={CUSTOM}>Custom (cron)</SelectItem>
              </Select>
            </FieldRow>
            <FieldRow
              label="Time zone"
              htmlFor="trg-tz"
              hint="An IANA name, e.g. Europe/Paris. Filled in from this computer."
              error={validTimezone(timezone) ? undefined : `${timezone} is not a time zone`}
            >
              <Input
                id="trg-tz"
                value={draft.timezone}
                onChange={(e) => set("timezone", e.target.value)}
              />
            </FieldRow>
          </div>
          {draft.preset === CUSTOM ? (
            <FieldRow
              label="Cron"
              htmlFor="trg-cron"
              required
              hint="minute hour day-of-month month day-of-week"
              error={
                draft.cron.trim() && validTimezone(timezone)
                  ? (cronProblem(draft.cron, timezone) ?? undefined)
                  : undefined
              }
            >
              <Input
                id="trg-cron"
                mono
                placeholder="30 6 * * 1-5"
                value={draft.cron}
                onChange={(e) => set("cron", e.target.value)}
              />
            </FieldRow>
          ) : null}
          <NextRuns cron={effectiveCron} timezone={timezone} />
        </>
      ),
    },
    {
      id: "input",
      title: "Set the input",
      why: "Every scheduled run starts with this same JSON. Put in what the workflow needs to do its job, such as which report to build, or leave {} if it needs nothing.",
      done: inputError === null,
      requirement: "enter valid JSON",
      example: fields.length
        ? "Use the example below as a starting point: its values are placeholders to replace with what the workflow should work on."
        : "The workflow declares no input fields, so {} is usually right.",
      children: (
        <>
          {fields.length ? (
            <div className="flex flex-col gap-1 rounded-sm border border-border px-3 py-2 text-xs text-ink-2">
              <span>The workflow&apos;s input has these fields:</span>
              {inputSummary}
              <Button
                type="button"
                size="sm"
                variant="link"
                className="self-start"
                onClick={() =>
                  set("input", JSON.stringify(exampleInput(detail.data?.draft.inputs), null, 2))
                }
              >
                Fill in an example to edit
              </Button>
            </div>
          ) : null}
          {!inputError && missingRequired.length ? (
            <p className="m-0 text-xs text-warn-text" role="status">
              Still missing required {missingRequired.length === 1 ? "field" : "fields"}:{" "}
              {missingRequired.join(", ")}. Runs started with this input are likely to fail.
            </p>
          ) : null}
          <FieldRow
            label="Input"
            htmlFor="trg-input"
            error={inputError ?? undefined}
            hint="JSON. Do not put secrets here: the input is stored in the workflow and in each run."
          >
            <Textarea
              id="trg-input"
              mono
              autoGrow
              minRows={3}
              maxRows={10}
              value={draft.input}
              onChange={(e) => set("input", e.target.value)}
            />
          </FieldRow>
        </>
      ),
    },
  ];

  const reviewChecks: Check[] = [
    ...(problem && detail.data
      ? [{ id: "problem", label: problem, state: "blocker" } satisfies Check]
      : detail.data
        ? [
            {
              id: "valid",
              label: notes.some((n) => n.state === "warning")
                ? "Nothing blocks adding it; check the warnings below"
                : "Every setting is filled in",
              state: "ok",
            } satisfies Check,
          ]
        : [{ id: "workflow", label: "Choose a workflow", state: "blocker" } satisfies Check]),
    ...notes.map((n): Check => ({ id: n.id, label: n.message, state: n.state })),
  ];

  const reviewStep: FlowStep = {
    id: "review",
    doneLabel: "Ready to add",
    title: "Review and add",
    why: `Adding writes the ${what} into the workflow's draft. It goes live in an environment only when you publish a version and deploy it there; nothing is published or deployed from here.`,
    done: Boolean(detail.data) && problem === null,
    requirement: "fix the items marked as needed",
    children: (
      <>
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-sm border border-border px-3 py-2 text-sm">
          <dt className="text-ink-3">Workflow</dt>
          <dd className="m-0 text-ink">{name || "—"}</dd>
          {kind === "webhook" ? (
            <>
              <dt className="text-ink-3">Path</dt>
              <dd className="m-0 font-mono text-ink">/{effectivePath || "—"}</dd>
              <dt className="text-ink-3">Callers prove</dt>
              <dd className="m-0 text-ink">
                {SIGNATURES.find((o) => o.id === draft.signature)?.label}
              </dd>
              <dt className="text-ink-3">Response</dt>
              <dd className="m-0 text-ink">
                {RESPONSES.find((o) => o.id === draft.responseMode)?.label}
              </dd>
            </>
          ) : (
            <>
              <dt className="text-ink-3">When</dt>
              <dd className="m-0 text-ink">
                {CRON_PRESETS.find((p) => p.cron === effectiveCron)?.label ?? (
                  <code className="font-mono">{effectiveCron || "—"}</code>
                )}{" "}
                <span className="text-ink-3">({timezone})</span>
              </dd>
              <dt className="text-ink-3">Input</dt>
              <dd className="m-0 truncate font-mono text-xs text-ink">
                {inputError ? "—" : JSON.stringify(parsedInput)}
              </dd>
              <dt className="text-ink-3">After deploy</dt>
              <dd className="m-0 text-ink-2">
                Overlapping runs skipped, missed runs not caught up, no jitter. Change these per
                environment on the Schedules tab.
              </dd>
            </>
          )}
        </dl>
        <CheckList checks={reviewChecks} aria-label="Before you add it" />
        {save.isError ? (
          <Notice tone="danger">
            The {what} was not added: {save.error.message} Your settings are kept; press Add to the
            draft again.
          </Notice>
        ) : null}
        <QualityNote>
          These checks confirm the {what} can be added and deployed. Whether runs do what you want
          shows only when they happen:{" "}
          {kind === "webhook"
            ? "send a test call after deploying and read the run."
            : "after deploying, use Run now once and read the run."}
        </QualityNote>
      </>
    ),
  };

  const steps = [
    ...(fixedWorkflow ? [] : [chooseStep]),
    ...(kind === "webhook" ? webhookSteps : scheduleSteps),
    reviewStep,
  ];

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{kind === "webhook" ? "Add a webhook" : "Add a schedule"}</DialogTitle>
          <DialogDescription>
            {kind === "webhook"
              ? "Another service starts runs by calling a URL; the request body becomes the run's input."
              : "Runs start on a timetable, with the same input every time."}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <GuidedFlow
            steps={steps}
            status={
              <DraftStatus
                dirty={kept.dirty}
                restored={kept.restored}
                onDiscard={() => {
                  kept.discard();
                  save.reset();
                }}
                what={`the ${what}`}
              />
            }
          />
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => close(false)}>
            Close
          </Button>
          <Button
            type="button"
            variant="primary"
            loading={save.isPending}
            disabled={!detail.data || problem !== null}
            onClick={() => save.mutate(undefined)}
          >
            Add to the draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The "Add webhook" / "Add schedule" button with its dialog; nothing without workflows:write. */
export function AddTriggerButton({
  kind,
  workflowId,
  variant = "secondary",
}: {
  kind: "webhook" | "schedule";
  workflowId?: string;
  variant?: "primary" | "secondary";
}) {
  const s = useSession();
  const [open, setOpen] = useState(false);
  if (!s.can("workflows:write")) return null;
  return (
    <>
      <Button
        size="sm"
        variant={variant}
        leadingIcon={<Plus strokeWidth={1.75} />}
        onClick={() => setOpen(true)}
      >
        {kind === "webhook" ? "Add webhook" : "Add schedule"}
      </Button>
      {open ? (
        <AddTriggerDialog
          kind={kind}
          open={open}
          onOpenChange={setOpen}
          {...(workflowId ? { workflowId } : {})}
        />
      ) : null}
    </>
  );
}

/** No live webhook or schedule yet: what they are, how one becomes live, and the first step. */
export function NoTriggers({
  kind,
  workflowId,
}: {
  kind: "webhook" | "schedule";
  workflowId?: string;
}) {
  return (
    <EmptyState
      size="sm"
      icon={
        kind === "webhook" ? <Webhook strokeWidth={1.5} /> : <CalendarClock strokeWidth={1.5} />
      }
      title={kind === "webhook" ? "No webhook is live yet" : "No schedule is live yet"}
      description={
        kind === "webhook"
          ? "Add a webhook to a workflow, then publish and deploy it: its URL, signing secret and an example request appear here for each environment. A webhook that is only in a draft is not listed here."
          : "Add a schedule to a workflow, then publish and deploy it: here you can pause it, run it now and see its next runs. A schedule that is only in a draft is not listed here."
      }
      primaryAction={
        <AddTriggerButton kind={kind} variant="primary" {...(workflowId ? { workflowId } : {})} />
      }
    />
  );
}

/** The next times the schedule fires, so a timetable can be checked before it is added. */
function NextRuns({ cron, timezone }: { cron: string; timezone: string }) {
  const next = validTimezone(timezone) ? nextCronRuns(cron, timezone) : [];
  if (next.length === 0) return null;
  const fmt = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
  });
  return (
    <p className="m-0 text-xs text-ink-3" aria-live="polite">
      Next runs ({timezone}): {next.map((d) => fmt.format(d)).join(" · ")}
    </p>
  );
}
