"use client";
/**
 * Download code (CODE_EXPORT.md §4): the ExportDialog over the package job. Starting it posts the
 * export (a version's, or the current draft's once the builder has saved it), polls the job until
 * the worker finishes, then saves the zip the API serves. Closing the dialog stops waiting.
 */
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ExportDialog,
  type ExportChoice,
  type ExportDialogStatus,
  type ExportTargetOption,
} from "@flowaid/ui/builder";
import { ApiError, api, get, getAll, post, qs } from "~/api/client";
import type { Diag, Page, Run, VersionSummary } from "~/api/types";
import { saveBlob } from "~/admin/ui";
import { useSession } from "~/session";
import { errorMessage } from "~/shell/states";

/** How often the job is asked for progress, and how long before waiting is given up. */
export const EXPORT_POLL_MS = 1000;
export const EXPORT_TIMEOUT_MS = 3 * 60_000;

interface Job {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  artifact_id?: string;
  error?: { code: string; message: string };
}

export interface CodeExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflow: { id: string; name: string; slug: string };
  /** a version id, or "draft"; the newest version when omitted */
  defaultTarget?: string;
  /** offer the current draft (the builder): it is saved first through `saveDraft` */
  draft?: {
    saveDraft: () => Promise<void>;
    /** a draft problem in words ("Boolean: Instructions is required") */
    describe?: (d: Diag) => string;
  };
}

export function CodeExportDialog({
  open,
  onOpenChange,
  workflow,
  defaultTarget,
  draft,
}: CodeExportDialogProps) {
  const s = useSession();
  const versions = useQuery({
    queryKey: ["versions", s.ws, workflow.id],
    queryFn: () => getAll<VersionSummary>(`/v1/workflows/${workflow.id}/versions`),
    enabled: open,
  });
  // the newest successful run supplies the sample input and the recorded test run
  const sample = useQuery({
    queryKey: ["code-export", "sample-run", s.ws, workflow.id],
    queryFn: async () =>
      (
        await get<Page<Run>>(
          `/v1/runs${qs({ workflowId: workflow.id, status: "completed", limit: 1 })}`,
        )
      ).items[0] ?? null,
    enabled: open && s.can("runs:read"),
  });

  const targets = useMemo<ExportTargetOption[]>(() => {
    const published = (versions.data ?? [])
      .filter((v) => v.kind === "published")
      .sort((a, b) => (b.version ?? 0) - (a.version ?? 0));
    return [
      ...(draft
        ? [{ id: "draft", label: "Current draft", detail: "Your latest edits, saved first." }]
        : []),
      ...published.map((v) => ({
        id: v.id,
        label: `v${v.version}${v.label ? ` · ${v.label}` : ""}`,
        detail: `Published ${new Date(v.createdAt).toLocaleString()}${v.notes ? ` · ${v.notes}` : ""}`,
      })),
    ];
  }, [versions.data, draft]);

  const [status, setStatus] = useState<ExportDialogStatus>({ phase: "idle" });
  const [saved, setSaved] = useState<{ artifactId: string; fileName: string } | null>(null);
  // each start gets a number; closing the dialog or starting again retires the one in flight
  const generation = useRef(0);
  const busy =
    status.phase === "queued" || status.phase === "building" || status.phase === "downloading";

  const close = (next: boolean) => {
    if (!next) {
      generation.current += 1;
      setStatus({ phase: "idle" });
    }
    onOpenChange(next);
  };
  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );

  const fallbackName = (target: string) => {
    const v = versions.data?.find((x) => x.id === target);
    return `flowaid-${workflow.slug || "workflow"}-${v?.version ? `v${v.version}` : "draft"}.zip`;
  };

  const download = useCallback(async (artifactId: string, fallback: string) => {
    const res = await api<Response>("GET", `/v1/artifacts/${artifactId}/download`, { raw: true });
    const fileName = fileNameOf(res.headers.get("content-disposition")) ?? fallback;
    saveBlob(await res.blob(), fileName);
    return fileName;
  }, []);

  const start = async (choice: ExportChoice) => {
    if (busy) return;
    const gen = ++generation.current;
    const live = () => gen === generation.current;
    setStatus({ phase: "queued" });
    try {
      const isDraft = choice.target === "draft";
      if (isDraft) await draft?.saveDraft();
      const runId = sample.data?.id;
      const { job_id } = await post<{ job_id: string }>(
        isDraft
          ? `/v1/workflows/${workflow.id}/draft/export/package`
          : `/v1/workflow-versions/${choice.target}/export/package`,
        {
          mode: choice.mode,
          ...(choice.includeSample && runId ? { includeSampleFromRunId: runId } : {}),
          ...(choice.includeRecorded && runId ? { includeRecordedRunId: runId } : {}),
        },
      );
      const until = Date.now() + EXPORT_TIMEOUT_MS;
      let artifactId: string | undefined;
      while (!artifactId) {
        if (!live()) return;
        const job = await get<Job>(`/v1/jobs/${job_id}`);
        if (!live()) return;
        if (job.status === "failed")
          throw new JobFailed(job.error?.message ?? "the worker reported no reason");
        if (job.status === "completed") {
          if (!job.artifact_id) throw new JobFailed("the job finished without a package");
          artifactId = job.artifact_id;
          break;
        }
        if (Date.now() > until)
          throw new Error(
            "The package was not ready after 3 minutes. Check that FlowAId's worker is running, then try again.",
          );
        setStatus({ phase: job.status === "running" ? "building" : "queued" });
        await new Promise((r) => setTimeout(r, EXPORT_POLL_MS));
      }
      if (!live()) return;
      setStatus({ phase: "downloading" });
      const fileName = await download(artifactId, fallbackName(choice.target));
      if (!live()) return;
      setSaved({ artifactId, fileName });
      setStatus({ phase: "done", fileName });
    } catch (e) {
      if (live()) setStatus(failure(e, draft?.describe));
    }
  };

  return (
    <ExportDialog
      open={open}
      onOpenChange={close}
      workflowName={workflow.name}
      targets={targets}
      {...(defaultTarget ? { defaultTarget } : {})}
      vendoredAvailable={s.features.code_export !== false}
      sampleRun={
        sample.data
          ? {
              label: `the last successful run (${new Date(sample.data.endedAt ?? sample.data.createdAt).toLocaleString()})`,
            }
          : null
      }
      status={status}
      onExport={(choice) => void start(choice)}
      {...(saved
        ? {
            onDownloadAgain: () =>
              void download(saved.artifactId, saved.fileName).catch((e: unknown) =>
                setStatus({ phase: "failed", message: errorMessage(e) }),
              ),
          }
        : {})}
    />
  );
}

class JobFailed extends Error {}

/** What stopped the package, in words: the draft's problems, the worker's reason or the API's. */
export function failure(e: unknown, describe?: (d: Diag) => string): ExportDialogStatus {
  if (e instanceof JobFailed)
    return { phase: "failed", message: `The package could not be built: ${e.message}` };
  if (e instanceof ApiError && e.status === 422) {
    const diags = (e.details as { diagnostics?: Diag[] } | undefined)?.diagnostics ?? [];
    const errors = diags.filter((d) => d.severity === "error");
    if (errors.length)
      return {
        phase: "failed",
        message: `The draft has ${errors.length} problem${errors.length === 1 ? "" : "s"} to fix before it can be packaged.`,
        problems: errors.map((d) => describe?.(d) ?? d.message),
      };
  }
  return { phase: "failed", message: errorMessage(e) };
}

/** The file name in a `Content-Disposition: attachment; filename="…"` header. */
export function fileNameOf(header: string | null): string | null {
  const m = /filename="([^"]+)"/.exec(header ?? "") ?? /filename=([^;]+)/.exec(header ?? "");
  return m?.[1]?.trim() || null;
}
