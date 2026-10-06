"use client";
/**
 * Publish (UI.md §3): what changes against the latest version (the compiler's `diff`), the
 * diagnostics that block or warn, release notes, deploy targets and an optional evaluation gate.
 * A review at the top says whether it can be published and what pressing Publish will do; it
 * deploys only to the environments ticked here, none by default.
 */
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { diff } from "@flowaid/workflow-compiler";
import type { Diagnostic, WorkflowDefinition } from "@flowaid/workflow-core";
import {
  DiagnosticList,
  WorkflowDiffSummary,
  type DiagnosticPresentation,
} from "@flowaid/ui/inspector";
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
  Label,
  NumberInput,
  Select,
  SelectItem,
  Textarea,
  toast,
} from "@flowaid/ui/primitives";
import { ApiError, get, getAll, post } from "~/api/client";
import type { Environment, VersionDetail, VersionSummary } from "~/api/types";
import { missingRequiredSecrets } from "~/admin/logic";
import { useServerCredentialTypes } from "./useServerKeys";
import { CheckList, QualityNote, blockers } from "~/guide/Readiness";
import { useSession } from "~/session";
import { publishChecks, publishOutcome } from "./publishReview";

export interface PublishDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflowId: string;
  latestVersionId: string | null;
  draft: WorkflowDefinition;
  diagnostics: readonly Diagnostic[];
  /** the builder's plain-language location, hint and "Show node" for each diagnostic */
  describe?: (d: Diagnostic) => DiagnosticPresentation | undefined;
  environments: readonly Environment[];
  /** saves the draft first; resolves when the server has it */
  flush: () => Promise<void>;
  onPublished: (version: VersionSummary) => void;
}

export function PublishDialog(p: PublishDialogProps) {
  const s = useSession();
  const qc = useQueryClient();
  const router = useRouter();
  const [notes, setNotes] = useState("");
  const [label, setLabel] = useState("");
  const [deployTo, setDeployTo] = useState<string[]>([]);
  const [gateSet, setGateSet] = useState<string>("");
  const [minPass, setMinPass] = useState(0.9);
  const latest = useQuery({
    queryKey: ["version", p.latestVersionId],
    queryFn: () => get<VersionDetail>(`/v1/workflow-versions/${p.latestVersionId as string}`),
    enabled: p.open && p.latestVersionId !== null,
  });
  const sets = useQuery({
    queryKey: ["evaluation-sets"],
    queryFn: () => getAll<{ id: string; name: string }>("/v1/evaluations/sets"),
    enabled: p.open,
  });
  const setList = sets.data ?? [];
  const changes = useMemo(() => {
    if (!latest.data) return null;
    try {
      return diff(latest.data.definition, p.draft);
    } catch {
      return null;
    }
  }, [latest.data, p.draft]);
  const errors = p.diagnostics.filter((d) => d.severity === "error");
  const warnings = p.diagnostics.filter((d) => d.severity === "warning");
  // required secrets per ticked environment that no binding or server key answers (publishing
  // with deploy refuses them, like the Deployments page)
  const canSeeSecrets = s.can("secrets:bind");
  const bindings = useQueries({
    queries: deployTo.map((envId) => ({
      queryKey: ["secret-bindings", s.ws, p.workflowId, envId],
      queryFn: () => get<Record<string, string>>(`/v1/workflows/${p.workflowId}/secrets/${envId}`),
      enabled: p.open && canSeeSecrets && (p.draft.secrets ?? []).length > 0,
    })),
  });
  const served = useServerCredentialTypes();
  const needsSecrets = (p.draft.secrets ?? []).some((x) => x.required !== false);
  const targets = deployTo.map((envId, i) => {
    const bound = bindings[i]?.data;
    return {
      name: p.environments.find((e) => e.id === envId)?.name ?? "that environment",
      missingSecrets:
        bound && needsSecrets
          ? missingRequiredSecrets(p.draft.secrets ?? [], bound, served)
          : undefined,
    };
  });
  const latestVersion = p.latestVersionId === null ? null : (latest.data?.version ?? undefined);
  const gate = gateSet
    ? { setName: setList.find((x) => x.id === gateSet)?.name ?? "the set", minPassRate: minPass }
    : null;
  const checks = publishChecks({
    diagnostics: p.diagnostics,
    latestVersion,
    changes,
    comparing: p.latestVersionId !== null && latest.isPending,
    deployTo: targets,
    gate,
  });
  const blocked = blockers(checks).length > 0;

  const publish = useMutation({
    mutationFn: async () => {
      await p.flush();
      return post<VersionSummary>(`/v1/workflows/${p.workflowId}/publish`, {
        ...(notes ? { notes } : {}),
        ...(label ? { label } : {}),
        ...(deployTo.length ? { deployTo } : {}),
        ...(gateSet ? { requireEvaluation: { setId: gateSet, minPassRate: minPass } } : {}),
      });
    },
    onSuccess: (v) => {
      toast.success(
        `Published v${v.version ?? ""}${deployTo.length ? ` and deployed to ${deployTo.length} environment${deployTo.length > 1 ? "s" : ""}` : ""}`,
        // the next step after publishing: put the version live somewhere
        deployTo.length === 0 && s.can("workflows:publish")
          ? {
              action: {
                label: "Deploy",
                onClick: () =>
                  router.push(`/${s.ws}/workflows/${p.workflowId}/deployments?version=${v.id}`),
              },
            }
          : undefined,
      );
      void qc.invalidateQueries({ queryKey: ["workflow", p.workflowId] });
      void qc.invalidateQueries({ queryKey: ["workflow", s.ws, p.workflowId] });
      void qc.invalidateQueries({ queryKey: ["versions", s.ws, p.workflowId] });
      p.onPublished(v);
      setDeployTo([]);
      p.onOpenChange(false);
    },
  });

  return (
    <Dialog
      open={p.open}
      onOpenChange={(open) => {
        // environments are ticked afresh each time: a closed dialog never deploys on reopening
        if (!open) setDeployTo([]);
        p.onOpenChange(open);
      }}
    >
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Publish a new version</DialogTitle>
          <DialogDescription>
            Versions are immutable. Runs from API keys and triggers use the version deployed to
            their environment.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-5">
          <section aria-labelledby="pub-review" className="flex flex-col gap-2">
            <h3 id="pub-review" className="text-eyebrow">
              Ready to publish?
            </h3>
            <CheckList checks={checks} aria-label="Publish checks" />
            {!canSeeSecrets && needsSecrets && deployTo.length > 0 ? (
              <p className="m-0 text-xs text-ink-3">
                Your role cannot see secret bindings, so they are checked when the deploy happens.
              </p>
            ) : null}
            <QualityNote>
              These checks confirm the draft is complete and valid. They cannot tell you whether its
              answers are good: run the draft on a few real examples in the builder, or evaluate it,
              before publishing.
            </QualityNote>
          </section>
          {errors.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-danger">
                Fix {errors.length} error{errors.length > 1 ? "s" : ""} before publishing
              </h3>
              <DiagnosticList
                diagnostics={errors}
                {...(p.describe ? { describe: p.describe } : {})}
              />
            </section>
          ) : null}
          <section className="flex flex-col gap-2">
            <h3 className="text-eyebrow">Changes</h3>
            {p.latestVersionId === null ? (
              <p className="text-sm text-ink-3">This is the first version.</p>
            ) : changes ? (
              <WorkflowDiffSummary
                diff={changes}
                nodeName={(id) => p.draft.nodes.find((n) => n.id === id)?.name}
              />
            ) : (
              <p className="text-sm text-ink-3">
                {latest.isPending
                  ? "Comparing with the latest version…"
                  : "The comparison is unavailable."}
              </p>
            )}
          </section>
          {warnings.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h3 className="text-eyebrow">
                {warnings.length} warning{warnings.length > 1 ? "s" : ""}
              </h3>
              <DiagnosticList
                diagnostics={warnings}
                {...(p.describe ? { describe: p.describe } : {})}
              />
            </section>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
            <FieldRow>
              <Label htmlFor="pub-notes">Release notes</Label>
              <Textarea
                id="pub-notes"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="What changed and why"
              />
            </FieldRow>
            <FieldRow>
              <Label htmlFor="pub-label">Label</Label>
              <Input
                id="pub-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="optional"
                maxLength={100}
              />
            </FieldRow>
          </div>
          {p.environments.length > 0 ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="text-eyebrow mb-1">Deploy to</legend>
              <p className="m-0 text-xs text-ink-3">
                Optional. Leave all unticked to publish only and deploy later from Deployments.
                Ticking one makes the new version live there as soon as it is published.
              </p>
              <div className="flex flex-wrap gap-4">
                {p.environments.map((e) => (
                  <label key={e.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={deployTo.includes(e.id)}
                      onCheckedChange={(v) =>
                        setDeployTo((cur) => (v ? [...cur, e.id] : cur.filter((x) => x !== e.id)))
                      }
                    />
                    {e.name}
                    {e.protected ? <span className="text-2xs text-ink-3">protected</span> : null}
                  </label>
                ))}
              </div>
              {p.environments.some((e) => e.protected && deployTo.includes(e.id)) ? (
                <p className="m-0 text-xs text-warn-text" role="status">
                  {p.environments
                    .filter((e) => e.protected && deployTo.includes(e.id))
                    .map((e) => e.name)
                    .join(", ")}{" "}
                  is protected, which usually means real traffic uses it; only an admin may deploy
                  there. Publishing now makes this version live there straight away; to try it
                  first, tick only a test environment now and deploy the same version here later
                  from Deployments.
                </p>
              ) : null}
            </fieldset>
          ) : null}
          {setList.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
              <FieldRow>
                <Label>Require an evaluation</Label>
                <Select
                  value={gateSet || "none"}
                  onValueChange={(v) => setGateSet(v === "none" ? "" : v)}
                  aria-label="Evaluation set"
                >
                  <SelectItem value="none">No gate</SelectItem>
                  {setList.map((x) => (
                    <SelectItem key={x.id} value={x.id}>
                      {x.name}
                    </SelectItem>
                  ))}
                </Select>
              </FieldRow>
              <FieldRow>
                <Label htmlFor="pub-min">Minimum pass rate</Label>
                <NumberInput
                  id="pub-min"
                  min={0}
                  max={1}
                  step={0.05}
                  value={minPass}
                  disabled={!gateSet}
                  onValueChange={(v) => setMinPass(v ?? 0.9)}
                />
              </FieldRow>
            </div>
          ) : null}
          <section aria-labelledby="pub-outcome" className="flex flex-col gap-1.5">
            <h3 id="pub-outcome" className="text-eyebrow">
              When you press Publish
            </h3>
            <ol className="m-0 flex list-decimal flex-col gap-0.5 pl-5 text-sm text-ink-2">
              {publishOutcome(
                latestVersion,
                targets.map((t) => t.name),
              ).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ol>
          </section>
          {publish.error ? (
            <p className="text-sm text-danger" role="alert">
              {publish.error instanceof ApiError ? publish.error.message : "Publishing failed."}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              setDeployTo([]);
              p.onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={() => publish.mutate()}
            loading={publish.isPending}
            disabled={blocked || (p.latestVersionId !== null && latest.isPending)}
          >
            {deployTo.length ? "Publish and deploy" : "Publish"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
