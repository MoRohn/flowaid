"use client";
/**
 * Adds a webhook or a schedule to a workflow: the trigger is written into the workflow's draft,
 * and becomes live in an environment when a version with it is published and deployed there.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState, type FormEvent } from "react";
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
  Select,
  SelectItem,
  Textarea,
} from "@flowaid/ui/primitives";
import { get, put } from "~/api/client";
import type { WorkflowDetail } from "~/api/types";
import { useSession } from "~/session";
import { useMutate } from "../ui";
import { CRON_PRESETS, cronProblem, webhookPathFrom, withTrigger, type NewTrigger } from "./add";

const CUSTOM = "__custom";

function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

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
  const [workflowId, setWorkflowId] = useState(fixedWorkflow ?? "");
  const [path, setPath] = useState<string | null>(null);
  const [signature, setSignature] = useState<"hmac_sha256" | "token" | "none">("hmac_sha256");
  const [responseMode, setResponseMode] = useState<"async" | "sync">("async");
  const [preset, setPreset] = useState(CRON_PRESETS[2]?.cron ?? "0 9 * * *");
  const [cron, setCron] = useState("");
  const [timezone, setTimezone] = useState(localTimezone);
  const [input, setInput] = useState("{}");
  const [done, setDone] = useState<string | null>(null);

  const workflows = useQuery({
    queryKey: ["workflow-names", s.ws],
    queryFn: () => get<{ items: { id: string; name: string }[] }>("/v1/workflows?limit=200"),
    enabled: open && !fixedWorkflow,
  });
  const detail = useQuery({
    queryKey: ["workflow", s.ws, workflowId],
    queryFn: () => get<WorkflowDetail>(`/v1/workflows/${workflowId}`),
    enabled: open && Boolean(workflowId),
  });
  const name = detail.data?.name ?? "";
  const effectivePath = path ?? (name ? webhookPathFrom(name) : "");
  const effectiveCron = preset === CUSTOM ? cron : preset;
  let parsedInput: unknown = {};
  let inputError: string | null = null;
  if (kind === "schedule") {
    try {
      parsedInput = input.trim() ? JSON.parse(input) : {};
    } catch {
      inputError = "Enter valid JSON, or leave {}";
    }
  }
  const trigger: NewTrigger =
    kind === "webhook"
      ? { type: "webhook", path: effectivePath, signature, responseMode }
      : {
          type: "schedule",
          cron: effectiveCron,
          timezone: timezone.trim() || "UTC",
          input: parsedInput,
        };
  const next = detail.data ? withTrigger(detail.data.draft, trigger) : null;
  const problem = next && "error" in next ? next.error : inputError;

  const save = useMutate(
    async () => {
      const d = detail.data;
      if (!d || !next || "error" in next) throw new Error(problem ?? "Choose a workflow");
      await put(
        `/v1/workflows/${d.id}/draft`,
        { definition: next.definition },
        { headers: { "if-match": `"${d.draftRevision}"` } },
      );
      return d;
    },
    {
      onSuccess: (d) => {
        setDone(d.id);
        void qc.invalidateQueries({ queryKey: ["workflow", s.ws, d.id] });
      },
    },
  );

  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      setDone(null);
      setPath(null);
      if (!fixedWorkflow) setWorkflowId("");
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!problem && next) save.mutate(undefined);
  };
  const what = kind === "webhook" ? "webhook" : "schedule";

  if (done)
    return (
      <Dialog open={open} onOpenChange={close}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 strokeWidth={1.75} className="size-4 text-ok-text" aria-hidden="true" />
              Added to {name}&apos;s draft
            </DialogTitle>
            <DialogDescription>
              The {what} goes live in an environment when you publish a version that has it and
              deploy it there.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <ol className="flex list-decimal flex-col gap-1 pl-4 text-sm text-ink-2">
              <li>Open the workflow and choose Publish (tick an environment to deploy at once).</li>
              <li>
                Come back here: the {what}
                {kind === "webhook" ? "'s URL and signing secret appear" : " appears"} per
                environment.
              </li>
            </ol>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => close(false)}>
              Close
            </Button>
            <Button asChild variant="primary">
              <Link href={`/${s.ws}/workflows/${done}`}>Open the workflow</Link>
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
            <DialogTitle>{kind === "webhook" ? "Add a webhook" : "Add a schedule"}</DialogTitle>
            <DialogDescription>
              {kind === "webhook"
                ? "Another service starts runs by calling a URL; the request body becomes the run's input."
                : "Runs start on a timetable, with the same input every time."}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            {fixedWorkflow ? null : (
              <FieldRow label="Workflow" htmlFor="trg-workflow" required>
                <Select
                  id="trg-workflow"
                  value={workflowId}
                  onValueChange={(v) => {
                    setWorkflowId(v);
                    setPath(null);
                  }}
                  placeholder={workflows.isPending ? "Loading…" : "Choose a workflow"}
                >
                  {(workflows.data?.items ?? []).map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </Select>
              </FieldRow>
            )}
            {kind === "webhook" ? (
              <>
                <FieldRow
                  label="Path"
                  htmlFor="trg-path"
                  required
                  hint="The last part of the URL, unique within the workflow"
                >
                  <Input
                    id="trg-path"
                    mono
                    value={effectivePath}
                    maxLength={64}
                    onChange={(e) => setPath(e.target.value.toLowerCase())}
                  />
                </FieldRow>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FieldRow
                    label="Caller proves itself with"
                    htmlFor="trg-signature"
                    hint={
                      signature === "none"
                        ? "Anyone who knows the URL can start runs"
                        : "You generate the secret here once it is deployed"
                    }
                  >
                    <Select
                      id="trg-signature"
                      value={signature}
                      onValueChange={(v) => setSignature(v as typeof signature)}
                    >
                      <SelectItem value="hmac_sha256" description="Recommended">
                        A signature (HMAC-SHA256)
                      </SelectItem>
                      <SelectItem value="token">A shared token header</SelectItem>
                      <SelectItem value="none">Nothing (unsigned)</SelectItem>
                    </Select>
                  </FieldRow>
                  <FieldRow label="Response" htmlFor="trg-response">
                    <Select
                      id="trg-response"
                      value={responseMode}
                      onValueChange={(v) => setResponseMode(v as typeof responseMode)}
                    >
                      <SelectItem value="async" description="202 with the run id at once">
                        Run in the background
                      </SelectItem>
                      <SelectItem value="sync" description="Waits for the output">
                        Wait for the output
                      </SelectItem>
                    </Select>
                  </FieldRow>
                </div>
              </>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FieldRow label="When" htmlFor="trg-preset">
                    <Select id="trg-preset" value={preset} onValueChange={setPreset}>
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
                    hint="An IANA name, e.g. Europe/Paris"
                  >
                    <Input
                      id="trg-tz"
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                    />
                  </FieldRow>
                </div>
                {preset === CUSTOM ? (
                  <FieldRow
                    label="Cron"
                    htmlFor="trg-cron"
                    required
                    hint={cronProblem(cron) ?? "minute hour day-of-month month day-of-week"}
                  >
                    <Input
                      id="trg-cron"
                      mono
                      placeholder="30 6 * * 1-5"
                      value={cron}
                      onChange={(e) => setCron(e.target.value)}
                    />
                  </FieldRow>
                ) : null}
                <FieldRow
                  label="Input"
                  htmlFor="trg-input"
                  hint={inputError ?? "The JSON input every scheduled run starts with"}
                >
                  <Textarea
                    id="trg-input"
                    mono
                    autoGrow
                    minRows={2}
                    maxRows={8}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                  />
                </FieldRow>
              </>
            )}
            {problem && detail.data ? (
              <p role="alert" className="text-xs text-danger-text">
                {problem}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={save.isPending}
              disabled={!detail.data || problem !== null}
            >
              Add to the draft
            </Button>
          </DialogFooter>
        </form>
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
      <AddTriggerDialog
        kind={kind}
        open={open}
        onOpenChange={setOpen}
        {...(workflowId ? { workflowId } : {})}
      />
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
          ? "Add a webhook to a workflow, then publish and deploy it: its URL, signing secret and an example request appear here for each environment."
          : "Add a schedule to a workflow, then publish and deploy it: here you can pause it, run it now and see its next runs."
      }
      primaryAction={
        <AddTriggerButton kind={kind} variant="primary" {...(workflowId ? { workflowId } : {})} />
      }
    />
  );
}
