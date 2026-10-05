"use client";
/**
 * Create or edit an agent preset: model (or failover policy), instructions, tools, bounds. A new
 * agent is built step by step (or all at once, "All fields"); its draft is kept in this browser
 * tab until it is created, and creating it ends on what to do next.
 */
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckCircle2 } from "lucide-react";
import type { ToolDefinition } from "@flowaid/workflow-core";
import { ModelFallbacks } from "@flowaid/ui/forms";
import {
  Button,
  Checkbox,
  Collapsible,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldRow,
  Input,
  Select,
  SelectItem,
  Textarea,
} from "@flowaid/ui/primitives";
import { get, patch, post } from "~/api/client";
import { useMutate } from "~/admin/ui";
import { useModelViews } from "~/builder/models";
import { DraftStatus, GuidedFlow, type FlowStep } from "~/guide/GuidedFlow";
import { CheckList, QualityNote, type Check } from "~/guide/Readiness";
import { generationCheck, useConnections } from "~/guide/useConnections";
import { useKeptDraft } from "~/guide/useKeptDraft";
import { useSession } from "~/session";
import {
  APPROVAL_LABEL,
  EXAMPLE_INSTRUCTIONS,
  advancedLabel,
  boundsOf,
  changesData,
  checkDraft,
  draftOf,
  emptyDraft,
  hasAdvanced,
  missingTools,
  modelLabel,
  reviewNotes,
  type AgentDraft,
  type AgentPreset,
  type ApprovalMode,
  type StreamMode,
} from "./logic";

export function AgentDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null: a new preset */
  editing: AgentPreset | null;
}) {
  const s = useSession();
  // a new agent's draft survives closing the dialog (or a trip to Integrations) in this tab
  const kept = useKeptDraft<AgentDraft>(editing ? null : `flowaid:draft:${s.ws}:agent`, () =>
    editing ? draftOf(editing) : emptyDraft(),
  );
  const { draft, setDraft } = kept;
  const [shown, setShown] = useState(false);
  const [created, setCreated] = useState<AgentPreset | null>(null);
  // editing keeps no draft, so closing with changes asks first instead of dropping them
  const [confirmingClose, setConfirmingClose] = useState(false);
  const keepEditingRef = useRef<HTMLButtonElement>(null);
  // the question takes focus, so Enter keeps the changes rather than dropping them
  useEffect(() => {
    if (confirmingClose) keepEditingRef.current?.focus();
  }, [confirmingClose]);
  const requestClose = (open: boolean) => {
    if (open) return onOpenChange(true);
    if (editing && kept.dirty && !save.isPending) return setConfirmingClose(true);
    onOpenChange(false);
  };
  const connections = useConnections();
  const models = useModelViews();
  const catalog = useQuery({
    queryKey: ["catalog", "tools", s.ws],
    queryFn: () => get<ToolDefinition[]>("/v1/tools/catalog"),
    enabled: open,
  });
  const check = checkDraft(draft);
  const errors = shown ? check.errors : {};
  const save = useMutate(
    (body: NonNullable<typeof check.body>) =>
      editing
        ? patch<AgentPreset>(`/v1/agents/${editing.id}`, body)
        : post<AgentPreset>("/v1/agents", body),
    {
      success: editing ? "Agent saved" : "Agent created",
      invalidate: [["agents", s.ws]],
      onSuccess: (saved) => {
        if (editing) return onOpenChange(false);
        kept.discard();
        setCreated(saved);
      },
      // the draft stays in the form (and in this tab) so nothing typed is lost
      errorTitle: "Could not save the agent",
    },
  );
  const set = <K extends keyof AgentDraft>(k: K, v: AgentDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));
  const toggleTool = (name: string, on: boolean) =>
    set(
      "tools",
      on
        ? [...draft.tools, { name, approval: "irreversible" }]
        : draft.tools.filter((t) => t.name !== name),
    );
  const setApproval = (name: string, approval: ApprovalMode) =>
    set(
      "tools",
      draft.tools.map((t) => (t.name === name ? { ...t, approval } : t)),
    );
  const available = useMemo(() => catalog.data ?? [], [catalog.data]);
  const builtin = useMemo(() => available.filter(isBuiltinTool), [available]);
  const own = useMemo(() => available.filter((t) => !isBuiltinTool(t)), [available]);
  const changes = useMemo(
    () => new Map(available.map((t) => [t.name, changesData(t)])),
    [available],
  );
  // every tool name the workspace offers; undefined until the catalog has loaded
  const known = useMemo(
    () => (catalog.data ? new Set(catalog.data.map((t) => t.name)) : undefined),
    [catalog.data],
  );
  const missing = missingTools(draft.tools, known);
  const notes = reviewNotes(draft, {
    providerReady: connections.ready,
    changes,
    available: known,
  });
  const blocked = notes.some((n) => n.state === "blocker");
  const bounds = boundsOf(check.body?.config ?? {});
  const advanced = hasAdvanced(draft);
  // open when the agent already sets one of them, so nothing it carries is out of sight
  const [advancedOpen, setAdvancedOpen] = useState(advanced);
  const advancedInvalid = ADVANCED_FIELDS.some((f) => Boolean(check.errors[f]));
  const advancedSummary = advancedLabel(check.body?.config ?? {});
  const submit = () => {
    setShown(true);
    if (check.ok && check.body && !blocked) save.mutate(check.body);
  };

  const reviewChecks: Check[] = [
    ...Object.entries(check.errors).map(([field, message]): Check => ({
      id: field,
      label: message,
      state: "blocker",
    })),
    ...(check.ok
      ? [{ id: "valid", label: "Every required setting is filled in", state: "ok" } as Check]
      : []),
    ...notes.map((n): Check => ({ id: n.id, label: n.message, state: n.state })),
  ];

  const steps: FlowStep[] = [
    {
      id: "job",
      title: "Name its job",
      why: "The name is how you pick this agent in a workflow's Agent step, so name it after the job it does. The description reminds you (and others) what it is for.",
      done: draft.name.trim().length > 0,
      requirement: "give the agent a name",
      example: (
        <>
          <strong className="font-medium text-ink">Order helper</strong> — “Answers order questions
          by looking up the order and its shipment.”
        </>
      ),
      children: (
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldRow label="Name" htmlFor="agent-name" error={errors.name} required>
            <Input
              id="agent-name"
              value={draft.name}
              maxLength={100}
              onChange={(e) => set("name", e.target.value)}
              placeholder="e.g. Order helper"
            />
          </FieldRow>
          <FieldRow label="Description" htmlFor="agent-desc" optional>
            <Input
              id="agent-desc"
              value={draft.description}
              maxLength={2000}
              onChange={(e) => set("description", e.target.value)}
              placeholder="What it is for"
            />
          </FieldRow>
        </div>
      ),
    },
    {
      id: "model",
      title: "Choose a model",
      why: "The model reads the instructions, decides which tool to call next, and writes the answer. Agents need a model that supports tool calls; larger models plan better, smaller ones are faster and cheaper.",
      done: !check.errors.model,
      requirement: "choose a model",
      example:
        "Start with one model you have a key for. Add a fallback later if the agent must keep working when that provider is down, or route to the cheapest of several.",
      children: (
        <>
          <CheckList
            checks={[generationCheck(connections, s.ws, { required: true, need: "Agents" })]}
            aria-label="Model keys"
          />
          <FieldRow
            label="Model"
            error={errors.model}
            hint="Add fallbacks to fail over, or route to the cheapest, fastest or healthiest."
          >
            <ModelFallbacks
              models={models}
              kind="generation"
              value={draft.model}
              onValueChange={(v) => set("model", v)}
              invalid={Boolean(errors.model)}
              aria-label="Model"
            />
          </FieldRow>
        </>
      ),
    },
    {
      id: "instructions",
      title: "Write its instructions",
      why: "Instructions are what the agent is told before every run. Say the goal, what to do when it is unsure or a tool fails, and what the answer should look like. The Agent step in a workflow can add or override them.",
      done: draft.system.trim().length > 0,
      optional: true,
      example: (
        <span className="flex flex-wrap items-center gap-x-2">
          <span>Not sure where to start? Load an example and change it to fit.</span>
          <Button
            type="button"
            size="sm"
            variant="link"
            onClick={() => set("system", EXAMPLE_INSTRUCTIONS)}
            disabled={draft.system.trim().length > 0}
          >
            Use the example
          </Button>
        </span>
      ),
      children: (
        <FieldRow
          label="Instructions"
          htmlFor="agent-system"
          optional
          hint="The example is a starting point: replace the order details with your own job."
        >
          <Textarea
            id="agent-system"
            rows={6}
            value={draft.system}
            onChange={(e) => set("system", e.target.value)}
            placeholder="You are a careful assistant. Use the tools when they help, and answer concisely."
          />
        </FieldRow>
      ),
    },
    {
      id: "tools",
      title: "Give it tools",
      why: "Tools are what the agent may call to look things up or act. Pick only what the job needs. For each tool choose when a person must approve the call: approval pauses the run as a human task until someone answers.",
      done: draft.tools.length > 0 && missing.length === 0,
      optional: true,
      example: (
        <>
          <strong className="font-medium text-ink">Ask for irreversible calls</strong> (the default)
          asks only for tools marked as changing data. Choose{" "}
          <strong className="font-medium text-ink">Always ask</strong> while you are still trying
          the agent out, and <strong className="font-medium text-ink">Never ask</strong> only for
          read-only lookups.
        </>
      ),
      children: (
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">Tools</legend>
          {errors.tools ? (
            <p className="text-xs text-danger" role="alert">
              {errors.tools}
            </p>
          ) : null}
          {catalog.isPending ? (
            <p className="text-sm text-ink-3">Loading tools…</p>
          ) : catalog.isError ? (
            <p className="text-sm text-danger-text" role="alert">
              Could not load the tool list.{" "}
              <Button type="button" size="sm" variant="link" onClick={() => void catalog.refetch()}>
                Try again
              </Button>
            </p>
          ) : (
            <>
              {missing.length ? (
                <MissingTools
                  names={missing}
                  onRemove={(name) => toggleTool(name, false)}
                  approvalOf={(name) => draft.tools.find((t) => t.name === name)?.approval}
                />
              ) : null}
              <ToolGroup
                title="Built into FlowAId"
                hint="Ready in every workspace, nothing to connect. Each only reads: none changes data."
                tools={builtin}
                chosen={draft.tools}
                onToggle={toggleTool}
                onApproval={setApproval}
              />
              <ToolGroup
                title="Your tools"
                hint="From connected MCP servers, imported OpenAPI documents and workflows exposed as tools."
                tools={own}
                chosen={draft.tools}
                onToggle={toggleTool}
                onApproval={setApproval}
                empty={
                  editing ? (
                    // an edit is not kept if the page is left, so these open in a new tab
                    <p className="m-0 rounded-sm border border-dashed border-border px-3 py-2.5 text-sm text-ink-3">
                      None yet. Changes to this agent are kept only while this page is open, so
                      these open in a new tab:{" "}
                      <a
                        className="text-accent-text hover:underline"
                        href={`/${s.ws}/integrations`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        connect an MCP server
                      </a>
                      ,{" "}
                      <a
                        className="text-accent-text hover:underline"
                        href={`/${s.ws}/integrations?tab=openapi`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        import an OpenAPI document
                      </a>{" "}
                      or{" "}
                      <a
                        className="text-accent-text hover:underline"
                        href={`/${s.ws}/triggers?tab=mcp`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        expose a workflow as a tool
                      </a>
                      . Then{" "}
                      <Button
                        type="button"
                        size="sm"
                        variant="link"
                        onClick={() => void catalog.refetch()}
                      >
                        refresh this list
                      </Button>
                      .
                    </p>
                  ) : (
                    <p className="m-0 rounded-sm border border-dashed border-border px-3 py-2.5 text-sm text-ink-3">
                      None yet. Your draft is kept while you{" "}
                      <a
                        className="text-accent-text hover:underline"
                        href={`/${s.ws}/integrations`}
                      >
                        connect an MCP server
                      </a>
                      ,{" "}
                      <a
                        className="text-accent-text hover:underline"
                        href={`/${s.ws}/integrations?tab=openapi`}
                      >
                        import an OpenAPI document
                      </a>{" "}
                      or{" "}
                      <a
                        className="text-accent-text hover:underline"
                        href={`/${s.ws}/triggers?tab=mcp`}
                      >
                        expose a workflow as a tool
                      </a>
                      ; come back and it is here.
                    </p>
                  )
                }
              />
            </>
          )}
        </fieldset>
      ),
    },
    {
      id: "limits",
      title: "Set its limits",
      why: "Limits stop an agent that loops or overspends. When a run reaches one, the Agent step fails with a limits error you can see in the trace, rather than carrying on. The defaults suit most jobs; leave a field empty to use the default.",
      done: LIMIT_FIELDS.every((f) => !check.errors[f]),
      requirement: "fix the limits marked in red",
      example:
        "Raise Max steps only when the trace shows the agent stopping mid-task. A run's own budget, when it has one, caps the cost limit too.",
      children: (
        <div className="flex flex-col gap-3">
          <div className="grid gap-4 sm:grid-cols-3">
            <FieldRow
              label="Max steps"
              htmlFor="agent-steps"
              error={check.errors.maxSteps}
              hint="Model turns before it must answer (1–50, default 8)"
            >
              <Input
                id="agent-steps"
                inputMode="numeric"
                value={draft.maxSteps}
                onChange={(e) => set("maxSteps", e.target.value)}
              />
            </FieldRow>
            <FieldRow
              label="Max tool calls"
              htmlFor="agent-calls"
              error={check.errors.maxToolCalls}
              hint="Across all steps (0–200, default 16). 0: it may not call any tool"
            >
              <Input
                id="agent-calls"
                inputMode="numeric"
                value={draft.maxToolCalls}
                onChange={(e) => set("maxToolCalls", e.target.value)}
              />
            </FieldRow>
            <FieldRow
              label="Max cost (USD)"
              htmlFor="agent-cost"
              error={check.errors.maxCostUsd}
              hint="Per run of the Agent step (default 1). 0: only a model without a price can run"
            >
              <Input
                id="agent-cost"
                inputMode="decimal"
                value={draft.maxCostUsd}
                onChange={(e) => set("maxCostUsd", e.target.value)}
              />
            </FieldRow>
          </div>
          <Collapsible
            title="Advanced"
            meta={advanced ? "set" : undefined}
            open={advancedOpen || advancedInvalid}
            onOpenChange={setAdvancedOpen}
            contentClassName="pl-0"
          >
            <div className="grid gap-4 pt-1 sm:grid-cols-2">
              <FieldRow
                label="Temperature"
                htmlFor="agent-temperature"
                error={check.errors.temperature}
                hint="0–2: lower answers more steadily, higher more varied (default 0.2)"
              >
                <Input
                  id="agent-temperature"
                  inputMode="decimal"
                  value={draft.temperature}
                  onChange={(e) => set("temperature", e.target.value)}
                />
              </FieldRow>
              <FieldRow
                label="Max output tokens"
                htmlFor="agent-output"
                error={check.errors.maxOutputTokens}
                hint="The longest reply one model turn may write (default 2048)"
              >
                <Input
                  id="agent-output"
                  inputMode="numeric"
                  value={draft.maxOutputTokens}
                  onChange={(e) => set("maxOutputTokens", e.target.value)}
                />
              </FieldRow>
              <FieldRow
                label="Token cap"
                htmlFor="agent-tokens"
                error={check.errors.maxTokens}
                hint="Input and output tokens across a whole run of the step (empty: no cap)"
              >
                <Input
                  id="agent-tokens"
                  inputMode="numeric"
                  value={draft.maxTokens}
                  onChange={(e) => set("maxTokens", e.target.value)}
                />
              </FieldRow>
              <FieldRow
                label="Streaming"
                htmlFor="agent-stream"
                hint="Shows the answer as it is written. Streamed turns arrive without a price, so the cost limit counts them at list prices."
              >
                <Select
                  id="agent-stream"
                  value={draft.stream}
                  onValueChange={(v) => set("stream", v as StreamMode)}
                >
                  <SelectItem value="default">Default (off)</SelectItem>
                  <SelectItem value="on">On</SelectItem>
                  <SelectItem value="off">Off</SelectItem>
                </Select>
              </FieldRow>
            </div>
          </Collapsible>
        </div>
      ),
    },
    {
      id: "review",
      title: editing ? "Review and save" : "Review and create",
      why: editing
        ? "Check the changes. Workflows that use this agent pick them up on their next run."
        : "Check what the agent will do. Creating it saves the preset only: nothing runs until a workflow uses it.",
      done: check.ok && !notes.some((n) => n.state === "blocker"),
      requirement: "fix the items marked as needed",
      doneLabel: editing ? "Ready to save" : "Ready to create",
      children: (
        <>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-sm border border-border px-3 py-2 text-sm">
            <dt className="text-ink-3">Name</dt>
            <dd className="m-0 text-ink">{draft.name.trim() || "—"}</dd>
            <dt className="text-ink-3">Model</dt>
            <dd className="m-0 font-mono text-ink">{modelLabel(draft.model)}</dd>
            <dt className="text-ink-3">Instructions</dt>
            <dd className="m-0 text-ink">
              {draft.system.trim() ? `${draft.system.trim().split(/\s+/).length} words` : "None"}
            </dd>
            <dt className="text-ink-3">Tools</dt>
            <dd className="m-0 text-ink">
              {draft.tools.length
                ? draft.tools
                    .map(
                      (t) =>
                        `${t.name} (${missing.includes(t.name) ? "no longer available" : APPROVAL_LABEL[t.approval].toLowerCase()})`,
                    )
                    .join(", ")
                : "None"}
            </dd>
            <dt className="text-ink-3">Limits</dt>
            <dd className="m-0 font-mono text-ink">
              {check.ok
                ? `${bounds.maxSteps} steps · ${bounds.maxToolCalls} tool calls · $${bounds.maxCostUsd}`
                : "—"}
            </dd>
            {advancedSummary ? (
              <>
                <dt className="text-ink-3">Advanced</dt>
                <dd className="m-0 font-mono text-ink">{advancedSummary}</dd>
              </>
            ) : null}
          </dl>
          <CheckList checks={reviewChecks} aria-label="Before you save" />
          <QualityNote>
            These checks confirm the agent can be saved. How well it answers shows only when it
            runs: add it to a workflow, run the draft on a few real requests, and read the tool
            calls in the trace.
          </QualityNote>
        </>
      ),
    },
  ];

  if (created)
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 strokeWidth={1.75} className="size-4 text-ok-text" aria-hidden />
              {created.name} is ready to use
            </DialogTitle>
            <DialogDescription>The preset is saved. To put it to work:</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <ol className="m-0 flex list-decimal flex-col gap-1.5 pl-5 text-sm text-ink-2">
              <li>
                Open a workflow, press Add node and pick {created.name}: active agents are listed
                there by name.
              </li>
              <li>
                Press Run draft with a realistic request. The trace lists each model turn and tool
                call, and approvals wait under Human tasks.
              </li>
              <li>Not what you wanted? Edit the agent here; the next run uses the change.</li>
            </ol>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Done
            </Button>
            <Button asChild variant="primary">
              <Link href={`/${s.ws}/workflows`}>Open a workflow</Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );

  return (
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${editing.name}` : "New agent"}</DialogTitle>
          <DialogDescription>
            A preset for Agent steps: they reference it and can override any setting.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <GuidedFlow
            steps={steps}
            status={
              editing ? (
                "Changes are saved when you press Save."
              ) : (
                <DraftStatus
                  dirty={kept.dirty}
                  restored={kept.restored}
                  onDiscard={() => {
                    kept.discard();
                    setShown(false);
                  }}
                  what="the agent"
                />
              )
            }
          />
        </DialogBody>
        <DialogFooter>
          {confirmingClose ? (
            <>
              <p role="alert" className="m-0 mr-auto self-center text-sm text-warn-text">
                Discard your changes to {editing?.name ?? "this agent"}?
              </p>
              <Button
                variant="ghost"
                ref={keepEditingRef}
                onClick={() => setConfirmingClose(false)}
              >
                Keep editing
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  setConfirmingClose(false);
                  onOpenChange(false);
                }}
              >
                Discard changes
              </Button>
            </>
          ) : (
            <>
              {shown && check.ok && blocked ? (
                <p role="alert" className="m-0 mr-auto self-center text-sm text-danger-text">
                  Not saved: remove the tools that are no longer available first.
                </p>
              ) : null}
              <Button variant="ghost" onClick={() => requestClose(false)}>
                {editing ? "Cancel" : "Close"}
              </Button>
              <Button variant="primary" loading={save.isPending} onClick={submit}>
                {editing ? "Save" : "Create agent"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const ADVANCED_FIELDS = ["temperature", "maxOutputTokens", "maxTokens"] as const;
const LIMIT_FIELDS = ["maxSteps", "maxToolCalls", "maxCostUsd", ...ADVANCED_FIELDS] as const;

/** The tools built into FlowAId (calculator, current_time, web_fetch), as the catalog marks them. */
const isBuiltinTool = (t: ToolDefinition) => t.source.kind === "builtin";

const SOURCE_LABEL: Record<string, string> = {
  builtin: "Built in",
  mcp: "MCP server",
  openapi: "OpenAPI",
  workflow: "Workflow",
  http: "HTTP",
};

/** What a person should know before giving an agent a built-in tool. */
const BUILTIN_NOTE: Record<string, string> = {
  web_fetch:
    "Reaches the public internet. A page can contain instructions meant for the agent, and an address can carry data out: choose Always ask for agents that handle private data.",
};

/**
 * Tools the agent lists that the workspace no longer offers. They stay checked (they are still
 * saved on the agent) until unchecked, which removes them.
 */
function MissingTools({
  names,
  onRemove,
  approvalOf,
}: {
  names: readonly string[];
  onRemove: (name: string) => void;
  approvalOf: (name: string) => ApprovalMode | undefined;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1.5">
      <div>
        <h4 id={headingId} className="m-0 text-xs font-semibold text-danger-text">
          No longer available
        </h4>
        <p className="m-0 text-2xs text-ink-3">
          The agent still lists these, but no connected server, import or workflow offers them any
          more, so every run of the agent fails. Uncheck one to remove it.
        </p>
      </div>
      <ul className="m-0 flex list-none flex-col divide-y divide-border rounded-sm border border-danger/40 p-0">
        {names.map((name) => {
          const approval = approvalOf(name);
          return (
            <li key={name} className="flex items-start gap-3 px-3 py-2">
              <Checkbox
                id={`missing-tool-${name}`}
                className="mt-0.5"
                checked
                onCheckedChange={(v) => {
                  if (v !== true) onRemove(name);
                }}
              />
              <label htmlFor={`missing-tool-${name}`} className="min-w-0 flex-1">
                <span className="block font-mono text-sm text-ink">{name}</span>
                <span className="block text-xs text-danger-text">
                  Not in this workspace's tool list
                  {approval ? ` · was set to ${APPROVAL_LABEL[approval].toLowerCase()}` : ""}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ToolGroup({
  title,
  hint,
  tools,
  chosen,
  onToggle,
  onApproval,
  empty,
}: {
  title: string;
  hint: string;
  tools: readonly ToolDefinition[];
  chosen: readonly { name: string; approval: ApprovalMode }[];
  onToggle: (name: string, on: boolean) => void;
  onApproval: (name: string, mode: ApprovalMode) => void;
  empty?: ReactNode;
}) {
  const headingId = useId();
  if (tools.length === 0 && !empty) return null;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1.5">
      <div>
        <h4 id={headingId} className="m-0 text-xs font-semibold text-ink">
          {title}
        </h4>
        <p className="m-0 text-2xs text-ink-3">{hint}</p>
      </div>
      {tools.length === 0 ? (
        empty
      ) : (
        <ul className="m-0 flex list-none flex-col divide-y divide-border rounded-sm border border-border p-0">
          {tools.map((t) => {
            const pick = chosen.find((x) => x.name === t.name);
            const note = t.source.kind === "builtin" ? BUILTIN_NOTE[t.name] : undefined;
            return (
              // the approval choice keeps a fixed width beside the tool, and goes under it on a
              // narrow screen, so the name and description are never squeezed
              <li
                key={`${t.source.kind}:${t.name}`}
                className="flex flex-wrap items-start gap-x-3 gap-y-1.5 px-3 py-2"
              >
                <Checkbox
                  id={`tool-${t.name}`}
                  className="mt-0.5"
                  checked={Boolean(pick)}
                  onCheckedChange={(v) => onToggle(t.name, v === true)}
                />
                <label htmlFor={`tool-${t.name}`} className="min-w-0 flex-1">
                  <span className="block font-mono text-sm text-ink">
                    {t.name}
                    {changesData(t) ? (
                      <span className="ml-1.5 font-sans text-2xs text-warn-text">changes data</span>
                    ) : null}
                  </span>
                  <span className="line-clamp-2 text-xs text-ink-3">
                    <span className="text-ink-2">
                      {SOURCE_LABEL[t.source.kind] ?? t.source.kind}
                    </span>
                    {" · "}
                    {t.description}
                  </span>
                  {pick && pick.approval === "irreversible" && !changesData(t) ? (
                    <span className="mt-0.5 block text-2xs text-ink-3">
                      Only reads, so it runs without asking.
                    </span>
                  ) : null}
                  {note && pick ? (
                    <span className="mt-1 block text-2xs text-warn-text">{note}</span>
                  ) : null}
                </label>
                {pick ? (
                  <div className="w-full pl-7 sm:w-52 sm:shrink-0 sm:pl-0">
                    <Select
                      size="sm"
                      value={pick.approval}
                      onValueChange={(v) => onApproval(t.name, v as ApprovalMode)}
                      aria-label={`Approval for ${t.name}`}
                    >
                      {(Object.keys(APPROVAL_LABEL) as ApprovalMode[]).map((m) => (
                        <SelectItem key={m} value={m}>
                          {APPROVAL_LABEL[m]}
                        </SelectItem>
                      ))}
                    </Select>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
