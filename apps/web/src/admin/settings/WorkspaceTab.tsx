"use client";
/**
 * Workspace name and `WorkspaceSettingsSchema` (retention, queue limit, budget). Each hint says
 * what the server actually does with the value: the nightly retention sweep reads the retention
 * days, and run start refuses new runs once this month's spend reaches the budget.
 */
import { useQuery } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { Button, FieldRow, Input, NumberInput } from "@flowaid/ui/primitives";
import { get, patch } from "~/api/client";
import { useSession } from "~/session";
import type { Workspace, WorkspaceBudget, WorkspaceSettings } from "../types";
import { usePreservedDraft } from "../drafts";
import { Notice, QueryView, Section, useMutate } from "../ui";

type Draft = {
  name: string;
  runsDays: number | null;
  auditDays: number | null;
  artifactsDays: number | null;
  maxQueuedRuns: number | null;
  monthlyCostUsd: number | null;
};

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

/** "This month (UTC): $12.40 of $100.00 (12%)", or the spend alone without a budget. */
export function spendLine(b: WorkspaceBudget): string {
  if (b.monthlyCostUsd === null)
    return `Spent this month (UTC): ${usd(b.spentUsd)}; no budget set.`;
  const pct = Math.floor((b.spentUsd / b.monthlyCostUsd) * 100);
  return `Spent this month (UTC): ${usd(b.spentUsd)} of ${usd(b.monthlyCostUsd)} (${pct}%)${
    b.reached ? ". New runs are refused until next month." : "."
  }`;
}

const fromWorkspace = (w: Workspace): Draft => {
  const st = w.settings as WorkspaceSettings;
  return {
    name: w.name,
    runsDays: st.retention?.runsDays ?? null,
    auditDays: st.retention?.auditDays ?? null,
    artifactsDays: st.retention?.artifactsDays ?? null,
    maxQueuedRuns: st.maxQueuedRuns ?? null,
    monthlyCostUsd: st.budgets?.monthlyCostUsd ?? null,
  };
};

/** Settings patch: unset numbers are dropped so the server keeps its defaults. */
export function settingsPatch(d: Draft, current: WorkspaceSettings): WorkspaceSettings {
  const retention = {
    ...(d.runsDays !== null ? { runsDays: d.runsDays } : {}),
    ...(d.auditDays !== null ? { auditDays: d.auditDays } : {}),
    ...(d.artifactsDays !== null ? { artifactsDays: d.artifactsDays } : {}),
  };
  const rest = { ...current };
  delete rest.retention;
  delete rest.maxQueuedRuns;
  delete rest.budgets;
  return {
    ...rest,
    ...(Object.keys(retention).length ? { retention } : {}),
    ...(d.maxQueuedRuns !== null ? { maxQueuedRuns: d.maxQueuedRuns } : {}),
    ...(d.monthlyCostUsd !== null ? { budgets: { monthlyCostUsd: d.monthlyCostUsd } } : {}),
  };
}

export function WorkspaceTab() {
  const s = useSession();
  const id = s.me.workspaces.find((w) => w.slug === s.ws)?.id ?? "";
  const ws = useQuery({
    queryKey: ["workspace", s.ws],
    queryFn: () => get<Workspace>(`/v1/workspaces/${id}`),
  });
  return (
    <QueryView query={ws}>
      {(w) => <WorkspaceForm key={JSON.stringify(fromWorkspace(w))} w={w} />}
    </QueryView>
  );
}

function WorkspaceForm({ w }: { w: Workspace }) {
  const s = useSession();
  const canEdit = s.can("admin");
  // kept while another Settings tab is open; leaving the page asks first
  const { draft, setDraft, dirty, reset } = usePreservedDraft<Draft>("workspace", fromWorkspace(w));
  const save = useMutate(
    (d: Draft) =>
      patch<Workspace>(`/v1/workspaces/${w.id}`, {
        name: d.name.trim(),
        settings: settingsPatch(d, w.settings as WorkspaceSettings),
      }),
    {
      success: "Workspace saved",
      invalidate: [
        ["workspace", s.ws],
        ["me", s.ws],
      ],
    },
  );
  const budget = useQuery({
    queryKey: ["workspace-budget", s.ws],
    queryFn: () => get<WorkspaceBudget>(`/v1/workspaces/${w.id}/budget`),
  });
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const auditTooShort = draft.auditDays !== null && draft.auditDays < 90;

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        save.mutate(draft);
      }}
    >
      <Section title="General">
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldRow label="Name" htmlFor="ws-name" required>
            <Input
              id="ws-name"
              value={draft.name}
              maxLength={100}
              disabled={!canEdit}
              onChange={(e) => set("name", e.target.value)}
            />
          </FieldRow>
          <FieldRow
            label="Slug"
            htmlFor="ws-slug"
            hint="Part of every URL and the MCP endpoint; fixed after creation"
          >
            <Input id="ws-slug" value={w.slug} readOnly className="font-mono" />
          </FieldRow>
        </div>
      </Section>
      <Section
        title="Retention"
        description="How long the nightly clean-up keeps old data. Leave a field empty for the server default."
      >
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <FieldRow
              label="Runs"
              htmlFor="ret-runs"
              hint="1–3650 days after a run finishes, then its inputs, outputs, steps and files are cleared (the run stays listed with its cost). Empty: 90. Workflows set to short (7) or long (400) retention keep theirs."
            >
              <NumberInput
                id="ret-runs"
                value={draft.runsDays}
                min={1}
                max={3650}
                unit="days"
                disabled={!canEdit}
                onValueChange={(v) => set("runsDays", v)}
              />
            </FieldRow>
            <FieldRow
              label="Audit log"
              htmlFor="ret-audit"
              hint="90–3650 days, then entries are deleted. Empty: 400."
              error={auditTooShort ? "At least 90 days" : undefined}
            >
              <NumberInput
                id="ret-audit"
                value={draft.auditDays}
                min={90}
                max={3650}
                unit="days"
                invalid={auditTooShort}
                disabled={!canEdit}
                onValueChange={(v) => set("auditDays", v)}
              />
            </FieldRow>
            <FieldRow
              label="Artifacts"
              htmlFor="ret-art"
              hint="1–3650 days, then files runs wrote are deleted even while the run is kept. Empty: files go with their run."
            >
              <NumberInput
                id="ret-art"
                value={draft.artifactsDays}
                min={1}
                max={3650}
                unit="days"
                disabled={!canEdit}
                onValueChange={(v) => set("artifactsDays", v)}
              />
            </FieldRow>
          </div>
        </div>
      </Section>
      <Section title="Limits">
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldRow
            label="Queued runs"
            htmlFor="lim-queue"
            hint="When this many runs are waiting, new ones are turned away (HTTP 429) until the queue shrinks. Empty uses 1,000."
          >
            <NumberInput
              id="lim-queue"
              value={draft.maxQueuedRuns}
              min={1}
              max={1_000_000}
              disabled={!canEdit}
              onValueChange={(v) => set("maxQueuedRuns", v)}
            />
          </FieldRow>
          <FieldRow
            label="Monthly budget"
            htmlFor="lim-budget"
            hint="Once this calendar month's run spend (UTC) reaches it, new runs are refused (HTTP 409) from every source, the builder, the API, webhooks, schedules, MCP and evaluations, until next month or a higher budget. Runs already going finish. Channels subscribed to budget events hear at 80% and 100%, once a month each. The workflow advisor also compares each workflow's cost with it. Empty or 0: no budget."
          >
            <NumberInput
              id="lim-budget"
              value={draft.monthlyCostUsd}
              min={0}
              step={10}
              precision={2}
              unit="USD"
              disabled={!canEdit}
              onValueChange={(v) => set("monthlyCostUsd", v)}
            />
            {budget.data ? (
              <p
                className={budget.data.reached ? "text-xs text-danger-text" : "text-xs text-ink-3"}
                role="status"
              >
                {spendLine(budget.data)}
              </p>
            ) : null}
          </FieldRow>
        </div>
      </Section>
      {canEdit ? (
        <div className="flex items-center justify-end gap-2">
          <p className="mr-auto text-xs text-ink-3" role="status">
            {/* a saved form remounts with the new values; the toast confirms the save */}
            {save.isPending ? "Saving…" : dirty ? "Unsaved changes" : ""}
          </p>
          <Button type="button" variant="ghost" disabled={!dirty} onClick={reset}>
            Discard
          </Button>
          <Button
            type="submit"
            variant="primary"
            loading={save.isPending}
            disabled={!dirty || !draft.name.trim() || auditTooShort}
          >
            Save changes
          </Button>
        </div>
      ) : (
        <Notice tone="info">Only workspace admins can change these settings.</Notice>
      )}
    </form>
  );
}
