"use client";
/** Create or edit an agent preset: model (or failover policy), instructions, tools, bounds. */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { ToolDefinition } from "@flowaid/workflow-core";
import { ModelFallbacks } from "@flowaid/ui/forms";
import {
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
  Select,
  SelectItem,
  Textarea,
} from "@flowaid/ui/primitives";
import { get, patch, post } from "~/api/client";
import { useMutate } from "~/admin/ui";
import { useModelViews } from "~/builder/models";
import { useSession } from "~/session";
import {
  APPROVAL_LABEL,
  checkDraft,
  draftOf,
  emptyDraft,
  type AgentDraft,
  type AgentPreset,
  type ApprovalMode,
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
  const [draft, setDraft] = useState<AgentDraft>(() => (editing ? draftOf(editing) : emptyDraft()));
  const [shown, setShown] = useState(false);
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
      editing ? patch(`/v1/agents/${editing.id}`, body) : post("/v1/agents", body),
    {
      success: editing ? "Agent saved" : "Agent created",
      invalidate: [["agents", s.ws]],
      onSuccess: () => onOpenChange(false),
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
  const available = catalog.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${editing.name}` : "New agent"}</DialogTitle>
          <DialogDescription>
            A preset for Agent nodes: they reference it and can override any setting.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldRow label="Name" htmlFor="agent-name" error={errors.name}>
              <Input
                id="agent-name"
                value={draft.name}
                maxLength={100}
                onChange={(e) => set("name", e.target.value)}
              />
            </FieldRow>
            <FieldRow label="Description" htmlFor="agent-desc" optional>
              <Input
                id="agent-desc"
                value={draft.description}
                maxLength={2000}
                onChange={(e) => set("description", e.target.value)}
              />
            </FieldRow>
          </div>
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
          <FieldRow label="Instructions" htmlFor="agent-system" optional>
            <Textarea
              id="agent-system"
              rows={4}
              value={draft.system}
              onChange={(e) => set("system", e.target.value)}
              placeholder="You are a careful assistant. Use the tools when they help, and answer concisely."
            />
          </FieldRow>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-eyebrow mb-1">Tools</legend>
            {errors.tools ? (
              <p className="text-xs text-danger" role="alert">
                {errors.tools}
              </p>
            ) : null}
            {available.length === 0 ? (
              <p className="text-sm text-ink-3">
                {catalog.isPending
                  ? "Loading tools…"
                  : "No tools yet: connect an MCP server, import an OpenAPI document or register a workflow as a tool under Integrations."}
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-border rounded-sm border border-border">
                {available.map((t) => {
                  const chosen = draft.tools.find((x) => x.name === t.name);
                  return (
                    <li
                      key={`${t.source.kind}:${t.name}`}
                      className="flex items-center gap-3 px-3 py-2"
                    >
                      <Checkbox
                        id={`tool-${t.name}`}
                        checked={Boolean(chosen)}
                        onCheckedChange={(v) => toggleTool(t.name, v === true)}
                      />
                      <label htmlFor={`tool-${t.name}`} className="min-w-0 flex-1">
                        <span className="block font-mono text-sm text-ink">{t.name}</span>
                        <span className="block truncate text-xs text-ink-3">
                          {t.source.kind} · {t.description}
                        </span>
                      </label>
                      {chosen ? (
                        <Select
                          size="sm"
                          value={chosen.approval}
                          onValueChange={(v) => setApproval(t.name, v as ApprovalMode)}
                          aria-label={`Approval for ${t.name}`}
                        >
                          {(Object.keys(APPROVAL_LABEL) as ApprovalMode[]).map((m) => (
                            <SelectItem key={m} value={m}>
                              {APPROVAL_LABEL[m]}
                            </SelectItem>
                          ))}
                        </Select>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-3">
            <FieldRow label="Max steps" htmlFor="agent-steps" error={errors.maxSteps}>
              <Input
                id="agent-steps"
                inputMode="numeric"
                value={draft.maxSteps}
                onChange={(e) => set("maxSteps", e.target.value)}
              />
            </FieldRow>
            <FieldRow label="Max tool calls" htmlFor="agent-calls" error={errors.maxToolCalls}>
              <Input
                id="agent-calls"
                inputMode="numeric"
                value={draft.maxToolCalls}
                onChange={(e) => set("maxToolCalls", e.target.value)}
              />
            </FieldRow>
            <FieldRow label="Max cost (USD)" htmlFor="agent-cost" error={errors.maxCostUsd}>
              <Input
                id="agent-cost"
                inputMode="decimal"
                value={draft.maxCostUsd}
                onChange={(e) => set("maxCostUsd", e.target.value)}
              />
            </FieldRow>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            loading={save.isPending}
            onClick={() => {
              setShown(true);
              if (check.ok && check.body) save.mutate(check.body);
            }}
          >
            {editing ? "Save" : "Create agent"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
