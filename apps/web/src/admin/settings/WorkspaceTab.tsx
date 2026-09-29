"use client";
/**
 * Workspace name and `WorkspaceSettingsSchema` (retention, queue limit, budget). Each hint says
 * what the server actually does with the value today.
 */
import { useQuery } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { Button, FieldRow, Input, NumberInput } from "@flowaid/ui/primitives";
import { get, patch } from "~/api/client";
import { useSession } from "~/session";
import type { Workspace, WorkspaceSettings } from "../types";
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
        description="How long to keep old data. Leave a field empty for the server default."
      >
        <div className="flex flex-col gap-4">
          <Notice tone="info">
            Not applied yet: these values are saved, but the nightly clean-up does not read them.
            Finished runs keep their data for 90 days (7 with short retention, 400 with long).
          </Notice>
          <div className="grid gap-4 sm:grid-cols-3">
            <FieldRow label="Runs" htmlFor="ret-runs" hint="1–3650 days">
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
              hint="90–3650 days"
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
            <FieldRow label="Artifacts" htmlFor="ret-art" hint="1–3650 days">
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
            hint="The workflow advisor uses it to judge whether a workflow's cost per run fits. Runs are not stopped and no alert is sent when spending passes it."
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
