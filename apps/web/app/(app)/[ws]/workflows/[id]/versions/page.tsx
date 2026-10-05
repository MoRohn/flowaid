"use client";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { use, useMemo, useState } from "react";
import { Download, FolderDown, GitCompare, History, Rocket, Undo2 } from "lucide-react";
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  toast,
} from "@flowaid/ui/primitives";
import { RelativeTime } from "@flowaid/ui/data";
import { get, getAll, post } from "~/api/client";
import type { Deployment, VersionSummary } from "~/api/types";
import { WorkflowFrame } from "~/admin/WorkflowFrame";
import { QueryView, downloadFrom, useConfirm, useMutate } from "~/admin/ui";
import { WORKFLOW_VERSIONS } from "~/guide/capabilities/workflow";
import { PageIntro } from "~/guide/PageIntro";
import { publishedCheck } from "~/workflows/readiness";
import { useSession } from "~/session";
import { CodeExportDialog } from "~/workflows/CodeExport";
import { errorMessage } from "~/shell/states";

export default function VersionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const s = useSession();
  const router = useRouter();
  const [picked, setPicked] = useState<string[]>([]);
  const restore = useConfirm<VersionSummary>();
  const versions = useQuery({
    queryKey: ["versions", s.ws, id],
    queryFn: () => getAll<VersionSummary>(`/v1/workflows/${id}/versions`),
  });
  const deployments = useQuery({
    queryKey: ["deployments", s.ws, id],
    queryFn: () => get<Deployment[]>(`/v1/workflows/${id}/deployments`),
  });
  const deployedTo = useMemo(() => {
    const m = new Map<string, Deployment[]>();
    for (const d of deployments.data ?? []) m.set(d.versionId, [...(m.get(d.versionId) ?? []), d]);
    return m;
  }, [deployments.data]);
  const doRestore = useMutate(
    (v: VersionSummary) =>
      post<{ draftRevision: number }>(`/v1/workflow-versions/${v.id}/restore-draft`),
    {
      success: (r, v) => `Draft restored from v${v.version} (revision ${r.draftRevision})`,
      invalidate: [["workflow", s.ws, id]],
      onSuccess: restore.close,
    },
  );
  // the version whose code package is being downloaded (Download code dialog)
  const [packaging, setPackaging] = useState<string | null>(null);
  const exportAs = (v: VersionSummary, format: "json" | "yaml" | "ts") =>
    downloadFrom(
      `/v1/workflow-versions/${v.id}/export?format=${format}`,
      `workflow-v${v.version}.${format}`,
    ).catch((e: unknown) => toast.error("Export failed", { description: errorMessage(e) }));
  const envProtected = (envId: string) =>
    s.environments.find((e) => e.id === envId)?.protected ?? false;
  const toggle = (vid: string, on: boolean) =>
    setPicked((p) =>
      on ? [...p.filter((x) => x !== vid).slice(-1), vid] : p.filter((x) => x !== vid),
    );
  const canWrite = s.can("workflows:write");
  const publishedCount = versions.data?.filter((v) => v.kind === "published").length;

  const compareButton = (
    <Button
      leadingIcon={<GitCompare strokeWidth={1.75} />}
      disabled={picked.length !== 2}
      onClick={() => {
        const list = versions.data ?? [];
        const [a, b] = [...picked].sort(
          (x, y) =>
            (list.find((v) => v.id === x)?.version ?? 0) -
            (list.find((v) => v.id === y)?.version ?? 0),
        );
        router.push(`/${s.ws}/workflows/${id}/versions/compare?a=${a}&b=${b}`);
      }}
    >
      Compare {picked.length === 2 ? "2 versions" : ""}
    </Button>
  );

  return (
    <WorkflowFrame id={id} tab="versions" actions={compareButton}>
      {(w) => (
        <>
          <PageIntro
            guide={WORKFLOW_VERSIONS}
            checks={[publishedCheck(publishedCount, s.ws, id)]}
            defaultCollapsed={(publishedCount ?? 1) > 0}
            className="mb-4"
          />
          <QueryView query={versions}>
            {(rows) => {
              const published = rows
                .filter((v) => v.kind === "published")
                .sort((a, b) => (b.version ?? 0) - (a.version ?? 0));
              return published.length === 0 ? (
                <EmptyState
                  icon={<History strokeWidth={1.5} />}
                  title="Nothing published yet"
                  description="Publishing freezes the draft into an immutable, numbered version you can deploy, compare and roll back to."
                  primaryAction={
                    <Button
                      variant="primary"
                      onClick={() => router.push(`/${s.ws}/workflows/${id}`)}
                    >
                      Open the builder
                    </Button>
                  }
                />
              ) : (
                <ul
                  className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface"
                  role="list"
                  aria-label="Versions"
                >
                  {published.map((v) => {
                    const deps = deployedTo.get(v.id) ?? [];
                    return (
                      <li key={v.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                        <Checkbox
                          aria-label={`Select v${v.version} to compare`}
                          checked={picked.includes(v.id)}
                          onCheckedChange={(c) => toggle(v.id, c === true)}
                        />
                        <span className="w-10 font-mono text-sm font-semibold text-ink">
                          v{v.version}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-1.5 text-sm text-ink">
                            <span className="truncate">{v.label ?? v.notes ?? "No notes"}</span>
                            {deps.map((d) => (
                              <Badge
                                key={d.environmentId}
                                tone={envProtected(d.environmentId) ? "accent" : "ok"}
                                dot
                              >
                                {d.environment}
                              </Badge>
                            ))}
                          </p>
                          <p className="mt-0.5 text-2xs text-ink-3">
                            <RelativeTime date={v.createdAt} />
                            {v.label && v.notes ? ` · ${v.notes}` : ""} · plan{" "}
                            <span className="font-mono">{v.planHash.slice(0, 10)}</span> · compiler{" "}
                            <span className="font-mono">{v.compilerVersion}</span>
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          leadingIcon={<Rocket strokeWidth={1.75} />}
                          onClick={() =>
                            router.push(`/${s.ws}/workflows/${id}/deployments?version=${v.id}`)
                          }
                        >
                          Deploy
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <IconButton size="sm" variant="ghost" label={`Export v${v.version}`}>
                              <Download strokeWidth={1.75} />
                            </IconButton>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              icon={<FolderDown strokeWidth={1.75} />}
                              onSelect={() => setPackaging(v.id)}
                            >
                              Download code…
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => void exportAs(v, "json")}>
                              Download JSON
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => void exportAs(v, "yaml")}>
                              Download YAML
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => void exportAs(v, "ts")}>
                              Download TypeScript (.ts)
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        {canWrite ? (
                          <IconButton
                            size="sm"
                            variant="ghost"
                            label={`Restore v${v.version} to the draft`}
                            onClick={() => restore.ask(v)}
                          >
                            <Undo2 strokeWidth={1.75} />
                          </IconButton>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              );
            }}
          </QueryView>
          <CodeExportDialog
            open={packaging !== null}
            onOpenChange={(o) => (o ? undefined : setPackaging(null))}
            workflow={{ id: w.id, name: w.name, slug: w.slug }}
            {...(packaging ? { defaultTarget: packaging } : {})}
          />
          <ConfirmDialog
            open={restore.target !== null}
            onOpenChange={(o) => (o ? undefined : restore.close())}
            title={`Restore v${restore.target?.version ?? ""} to the draft?`}
            description="The current draft is replaced by this version's definition. Published versions and deployments do not change."
            confirmLabel="Restore draft"
            loading={doRestore.isPending}
            onConfirm={() => {
              if (restore.target) doRestore.mutate(restore.target);
            }}
          />
        </>
      )}
    </WorkflowFrame>
  );
}
