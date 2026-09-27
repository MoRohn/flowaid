"use client";
/**
 * Publish (UI.md §3): what changes against the latest version (the compiler's `diff`), the
 * diagnostics that block or warn, release notes, deploy targets and an optional evaluation gate.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { diff } from "@flowaid/workflow-compiler";
import type { Diagnostic, WorkflowDefinition } from "@flowaid/workflow-core";
import { DiagnosticList, WorkflowDiffSummary } from "@flowaid/ui/inspector";
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
import { ApiError, get, post } from "~/api/client";
import type { Environment, Page, VersionDetail, VersionSummary } from "~/api/types";

export interface PublishDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflowId: string;
  latestVersionId: string | null;
  draft: WorkflowDefinition;
  diagnostics: readonly Diagnostic[];
  environments: readonly Environment[];
  /** saves the draft first; resolves when the server has it */
  flush: () => Promise<void>;
  onPublished: (version: VersionSummary) => void;
}

export function PublishDialog(p: PublishDialogProps) {
  const qc = useQueryClient();
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
    queryFn: () =>
      get<Page<{ id: string; name: string }> | { id: string; name: string }[]>(
        "/v1/evaluations/sets",
      ),
    enabled: p.open,
  });
  const setList = Array.isArray(sets.data) ? sets.data : (sets.data?.items ?? []);
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
      );
      void qc.invalidateQueries({ queryKey: ["workflow", p.workflowId] });
      void qc.invalidateQueries({ queryKey: ["versions", p.workflowId] });
      p.onPublished(v);
      p.onOpenChange(false);
    },
  });

  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Publish a new version</DialogTitle>
          <DialogDescription>
            Versions are immutable. Runs from API keys and triggers use the version deployed to
            their environment.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-5">
          {errors.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-danger">
                Fix {errors.length} error{errors.length > 1 ? "s" : ""} before publishing
              </h3>
              <DiagnosticList diagnostics={errors} />
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
              <DiagnosticList diagnostics={warnings} />
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
          {publish.error ? (
            <p className="text-sm text-danger" role="alert">
              {publish.error instanceof ApiError ? publish.error.message : "Publishing failed."}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => p.onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => publish.mutate()}
            loading={publish.isPending}
            disabled={errors.length > 0}
          >
            Publish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
